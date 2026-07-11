// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MemberRegistry} from "../src/MemberRegistry.sol";
import {AuctionHouse} from "../src/AuctionHouse.sol";
import {MONIAOracle} from "../src/MONIAOracle.sol";
import {CollateralVault} from "../src/CollateralVault.sol";
import {LoanBook} from "../src/LoanBook.sol";
import {MockVerifier} from "../src/verifiers/MockVerifier.sol";
import {BabyJubJub} from "@eerc/libraries/BabyJubJub.sol";
import {Point, EGCT} from "@eerc/types/Types.sol";

contract LoanBookTest is Test {
    MemberRegistry reg;
    AuctionHouse ah;
    MONIAOracle oracle;
    CollateralVault vault;
    LoanBook book;
    MockVerifier pocd;
    MockVerifier solvency;

    address admin = address(0xA11CE);
    address keeper = address(0xCEE9E9);
    address operator = address(0x09E7A);
    address lender = address(0x1E1);
    address borrower = address(0xB0B);

    uint256 constant EPOCH_LEN = 60;
    uint256 constant TENOR = 10;
    uint256 constant AUDITOR_PRIV = 987654321098765432109876543210;
    Point auditorPub;

    function setUp() public {
        reg = new MemberRegistry(admin);
        vm.startPrank(admin);
        reg.addMember(lender, 1, 0);
        reg.addMember(borrower, 1, 0);
        vm.stopPrank();

        ah = new AuctionHouse(address(reg), EPOCH_LEN, keeper);
        pocd = new MockVerifier();
        solvency = new MockVerifier();
        auditorPub = BabyJubJub.scalarMultiply(BabyJubJub.base8(), AUDITOR_PRIV);
        oracle = new MONIAOracle(address(ah), address(pocd), admin, auditorPub.x, auditorPub.y);
        ah.setOracle(address(oracle));
        vault = new CollateralVault(address(reg), address(solvency), operator);
        book = new LoanBook(address(reg), address(oracle), address(vault), admin, TENOR);
        vault.setLoanBook(address(book));
    }

    function _printEpoch() internal {
        EGCT memory eAsk = BabyJubJub.encrypt(auditorPub, 300);
        EGCT memory eBid = BabyJubJub.encrypt(auditorPub, 300);
        vm.prank(keeper);
        ah.openEpoch();
        vm.prank(lender);
        ah.submitAsk(4, eAsk, "");
        vm.prank(borrower);
        ah.submitBid(10, eBid);
        vm.warp(block.timestamp + EPOCH_LEN);
        vm.prank(keeper);
        ah.closeEpoch();

        MONIAOracle.DepthPoint[] memory d = new MONIAOracle.DepthPoint[](37);
        d[4].askSum = 300;
        d[10].bidSum = 300;
        uint256[2] memory a;
        uint256[2][2] memory b;
        uint256[2] memory c;
        vm.prank(admin);
        oracle.postPrint(1, 4, d, a, b, c);
    }

    function _match() internal returns (uint256 loanId) {
        EGCT memory zero;
        LoanBook.Match[] memory ms = new LoanBook.Match[](1);
        ms[0] = LoanBook.Match({lender: lender, borrower: borrower, rateTick: 4, cSize: zero});
        vm.prank(admin);
        book.postMatches(1, ms);
        return 0;
    }

    function _lockAndFund(uint256 id) internal {
        EGCT memory zc;
        uint256[2] memory pubk;
        uint256[2] memory a;
        uint256[2][2] memory b;
        uint256[2] memory c;
        vm.prank(borrower);
        vault.lockCollateral(id, zc, zc, pubk, a, b, c);
        vm.prank(operator);
        vault.confirmLock(id, bytes32(uint256(0xC0)));
        vm.prank(admin);
        book.confirmFunding(id, bytes32(0));
    }

    function test_RepayPath() public {
        _printEpoch();
        uint256 id = _match();
        assertEq(uint256(book.loanState(id)), uint256(LoanBook.LoanState.Pending));
        _lockAndFund(id);
        assertEq(uint256(book.loanState(id)), uint256(LoanBook.LoanState.Active));
        assertEq(book.activeLoanCount(), 1);
        assertEq(vault.activeLockCount(), 1);

        vm.prank(admin);
        book.repay(id, bytes32(0));
        assertEq(uint256(book.loanState(id)), uint256(LoanBook.LoanState.Repaid));
        assertEq(book.activeLoanCount(), 0);
        assertEq(vault.activeLockCount(), 0);
        (, CollateralVault.LockState st,) = vault.locks(id);
        assertEq(uint256(st), uint256(CollateralVault.LockState.Released));
    }

    function test_SeizePath() public {
        _printEpoch();
        uint256 id = _match();
        _lockAndFund(id);

        // deadline safety: cannot seize before deadline
        vm.expectRevert(LoanBook.DeadlineNotReached.selector);
        book.seize(id);

        vm.roll(block.number + TENOR + 1);
        book.seize(id);
        assertEq(uint256(book.loanState(id)), uint256(LoanBook.LoanState.Defaulted));
        (, CollateralVault.LockState st,) = vault.locks(id);
        assertEq(uint256(st), uint256(CollateralVault.LockState.Seized));

        // no repay after seize
        vm.prank(admin);
        vm.expectRevert(LoanBook.BadState.selector);
        book.repay(id, bytes32(0));
    }

    function test_MatchRateEnforced() public {
        _printEpoch();
        EGCT memory zero;
        LoanBook.Match[] memory ms = new LoanBook.Match[](1);
        ms[0] = LoanBook.Match({lender: lender, borrower: borrower, rateTick: 5, cSize: zero});
        vm.prank(admin);
        vm.expectRevert(LoanBook.BadRate.selector);
        book.postMatches(1, ms);
    }

    function test_ConfirmFundingRequiresLock() public {
        _printEpoch();
        uint256 id = _match();
        vm.prank(admin);
        vm.expectRevert(LoanBook.CollateralNotLocked.selector);
        book.confirmFunding(id, bytes32(0));
    }

    function test_NoDoubleSeize() public {
        _printEpoch();
        uint256 id = _match();
        _lockAndFund(id);
        vm.roll(block.number + TENOR + 1);
        book.seize(id);
        vm.expectRevert(LoanBook.BadState.selector);
        book.seize(id);
    }

    function test_PostMatchesRequiresPrint() public {
        EGCT memory zero;
        LoanBook.Match[] memory ms = new LoanBook.Match[](1);
        ms[0] = LoanBook.Match({lender: lender, borrower: borrower, rateTick: 4, cSize: zero});
        vm.prank(admin);
        vm.expectRevert(LoanBook.EpochNotPrinted.selector);
        book.postMatches(1, ms);
    }
}
