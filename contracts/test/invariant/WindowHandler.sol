// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MemberRegistry} from "../../src/MemberRegistry.sol";
import {AuctionHouse} from "../../src/AuctionHouse.sol";
import {MONIAOracle} from "../../src/MONIAOracle.sol";
import {CollateralVault} from "../../src/CollateralVault.sol";
import {LoanBook} from "../../src/LoanBook.sol";
import {MockVerifier} from "../../src/verifiers/MockVerifier.sol";
import {BabyJubJub} from "@eerc/libraries/BabyJubJub.sol";
import {Point, EGCT} from "@eerc/types/Types.sol";

/// @notice Handler for the WINDOW invariant suite. It deploys + wires the full
///         stack with ITSELF as admin/keeper/operator/member, then exposes bounded
///         actions the fuzzer sequences. Ghost state tracks what the on-chain
///         counters cannot (deadline-safety violations, created loan ids).
contract WindowHandler {
    MemberRegistry public reg;
    AuctionHouse public ah;
    MONIAOracle public oracle;
    CollateralVault public vault;
    LoanBook public book;
    MockVerifier public mock;

    uint256 constant EPOCH_LEN = 60;
    uint256 constant TENOR = 5;
    uint256 constant AUDITOR_PRIV = 987654321098765432109876543210;
    Point auditorPub;

    address constant LENDER = address(0x1E11);

    // ghost state
    uint256[] public loanIds;
    bool public ghost_seizeBeforeDeadlineSucceeded;
    uint64 public ghost_maxStatusRegression; // stays 0 if monotonic

    constructor() {
        reg = new MemberRegistry(address(this));
        reg.addMember(address(this), 1, 0); // handler acts as borrower/member
        reg.addMember(LENDER, 1, 0);

        ah = new AuctionHouse(address(reg), EPOCH_LEN, address(this));
        mock = new MockVerifier();
        auditorPub = BabyJubJub.scalarMultiply(BabyJubJub.base8(), AUDITOR_PRIV);
        oracle = new MONIAOracle(address(ah), address(mock), address(this), auditorPub.x, auditorPub.y);
        ah.setOracle(address(oracle));
        vault = new CollateralVault(address(reg), address(mock), address(this));
        book = new LoanBook(address(reg), address(oracle), address(vault), address(this), TENOR);
        vault.setLoanBook(address(book));
    }

    // Open a new epoch and place a crossing pair of bids (ask 300 @ 4, bid 300 @ 10 -> r*=4).
    function act_openAndBid() external {
        uint64 cur = ah.currentEpoch();
        if (cur != 0 && ah.epochStatus(cur) == AuctionHouse.Status.Open) return; // one open at a time
        EGCT memory eAsk = BabyJubJub.encrypt(auditorPub, 300);
        EGCT memory eBid = BabyJubJub.encrypt(auditorPub, 300);
        ah.openEpoch();
        ah.submitAsk(4, eAsk, "");
        ah.submitBid(10, eBid);
    }

    // Close the current open epoch (once its window elapsed) and print M-ONIA at r*=4.
    function act_closeAndPrint() external {
        uint64 e = ah.currentEpoch();
        if (e == 0 || ah.epochStatus(e) != AuctionHouse.Status.Open) return;
        if (block.timestamp < ah.epochStart(e) + EPOCH_LEN) return;
        ah.closeEpoch();

        MONIAOracle.DepthPoint[] memory d = new MONIAOracle.DepthPoint[](37);
        d[4].askSum = 300;
        d[10].bidSum = 300;
        uint256[2] memory a;
        uint256[2][2] memory b;
        uint256[2] memory c;
        oracle.postPrint(e, 4, d, a, b, c);
    }

    function act_postMatch() external {
        uint64 e = ah.currentEpoch();
        (uint16 rStar, bool exists) = oracle.rateAt(e);
        if (!exists || rStar == oracle.NO_TRADE()) return;
        EGCT memory zero;
        LoanBook.Match[] memory ms = new LoanBook.Match[](1);
        ms[0] = LoanBook.Match({lender: LENDER, borrower: address(this), rateTick: rStar, cSize: zero});
        uint256 id = book.nextLoanId();
        book.postMatches(e, ms);
        loanIds.push(id);
    }

    function act_lock(uint256 seed) external {
        if (loanIds.length == 0) return;
        uint256 id = loanIds[seed % loanIds.length];
        (, CollateralVault.LockState st,) = vault.locks(id);
        if (st != CollateralVault.LockState.None) return;
        EGCT memory zc;
        uint256[2] memory pubk;
        uint256[2] memory a;
        uint256[2][2] memory b;
        uint256[2] memory c;
        vault.lockCollateral(id, zc, zc, pubk, a, b, c);
        vault.confirmLock(id, bytes32(uint256(0xC0)));
    }

    function act_fund(uint256 seed) external {
        if (loanIds.length == 0) return;
        uint256 id = loanIds[seed % loanIds.length];
        if (book.loanState(id) != LoanBook.LoanState.Pending) return;
        if (!vault.isLocked(id)) return;
        book.confirmFunding(id, bytes32(0));
    }

    function act_repay(uint256 seed) external {
        if (loanIds.length == 0) return;
        uint256 id = loanIds[seed % loanIds.length];
        if (book.loanState(id) != LoanBook.LoanState.Active) return;
        book.repay(id, bytes32(0));
    }

    function act_warp(uint256 dt) external {
        // bounded time advance to let epochs close
        vm_warp(block.timestamp + (dt % (EPOCH_LEN + 30)));
    }

    function act_roll(uint256 db) external {
        vm_roll(block.number + (db % (TENOR + 3)));
    }

    function act_seize(uint256 seed) external {
        if (loanIds.length == 0) return;
        uint256 id = loanIds[seed % loanIds.length];
        if (book.loanState(id) != LoanBook.LoanState.Active) return;
        (,,,,, uint256 deadline,) = book.loans(id);
        bool beforeDeadline = block.number <= deadline;
        try book.seize(id) {
            if (beforeDeadline) ghost_seizeBeforeDeadlineSucceeded = true; // invariant 5 violated
        } catch {
            // expected when block.number <= deadline
        }
    }

    // ----- cheatcode shims (avoid importing Test into a target contract) -----
    address constant VM = 0x7109709ECfa91a80626fF3989D68f67F5b1DD12D;

    function vm_warp(uint256 ts) internal {
        (bool ok,) = VM.call(abi.encodeWithSignature("warp(uint256)", ts));
        require(ok, "warp");
    }

    function vm_roll(uint256 bn) internal {
        (bool ok,) = VM.call(abi.encodeWithSignature("roll(uint256)", bn));
        require(ok, "roll");
    }

    function loanIdsLength() external view returns (uint256) {
        return loanIds.length;
    }
}
