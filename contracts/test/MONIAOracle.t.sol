// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MemberRegistry} from "../src/MemberRegistry.sol";
import {AuctionHouse} from "../src/AuctionHouse.sol";
import {MONIAOracle} from "../src/MONIAOracle.sol";
import {MockVerifier} from "../src/verifiers/MockVerifier.sol";
import {BabyJubJub} from "@eerc/libraries/BabyJubJub.sol";
import {Point, EGCT} from "@eerc/types/Types.sol";

contract MONIAOracleTest is Test {
    MemberRegistry reg;
    AuctionHouse ah;
    MockVerifier mock;
    MONIAOracle oracle;

    address admin = address(0xA11CE);
    address keeper = address(0xCEE9E9);
    address lender1 = address(0x1E1);
    address lender2 = address(0x1E2);
    address borrower = address(0xB0B);

    uint256 constant EPOCH_LEN = 60;
    uint256 constant AUDITOR_PRIV = 987654321098765432109876543210;
    Point auditorPub;

    function setUp() public {
        reg = new MemberRegistry(admin);
        vm.startPrank(admin);
        reg.addMember(lender1, 1, 0);
        reg.addMember(lender2, 1, 0);
        reg.addMember(borrower, 1, 0);
        vm.stopPrank();

        ah = new AuctionHouse(address(reg), EPOCH_LEN, keeper);
        mock = new MockVerifier();
        auditorPub = BabyJubJub.scalarMultiply(BabyJubJub.base8(), AUDITOR_PRIV);
        oracle = new MONIAOracle(address(ah), address(mock), admin, auditorPub.x, auditorPub.y);
        ah.setOracle(address(oracle));
    }

    function _enc(uint256 size) internal view returns (EGCT memory) {
        return BabyJubJub.encrypt(auditorPub, size);
    }

    // asks 100+250 at tick 4, bid 300 at tick 10 -> crosses at tick 4, matched 300
    function _runEpochAndClose() internal {
        EGCT memory e100 = _enc(100);
        EGCT memory e250 = _enc(250);
        EGCT memory e300 = _enc(300);
        vm.prank(keeper);
        ah.openEpoch();
        vm.prank(lender1);
        ah.submitAsk(4, e100, "");
        vm.prank(lender2);
        ah.submitAsk(4, e250, "");
        vm.prank(borrower);
        ah.submitBid(10, e300);
        vm.warp(block.timestamp + EPOCH_LEN);
        vm.prank(keeper);
        ah.closeEpoch();
    }

    function _depth() internal pure returns (MONIAOracle.DepthPoint[] memory d) {
        d = new MONIAOracle.DepthPoint[](37);
        d[4].askSum = 350;
        d[10].bidSum = 300;
    }

    function _emptyProof()
        internal
        pure
        returns (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c)
    {}

    function test_PostPrintComputesCrossing() public {
        _runEpochAndClose();
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = _emptyProof();

        vm.prank(admin);
        oracle.postPrint(1, 4, _depth(), a, b, c);

        (uint16 tick, uint256 vol, uint64 ts, bool exists) = oracle.prints(1);
        assertEq(tick, 4, "rStarTick");
        assertEq(vol, 300, "matched volume");
        assertTrue(exists);
        assertGt(ts, 0);
        assertEq(uint256(ah.epochStatus(1)), uint256(AuctionHouse.Status.Printed));
        // proof was bound to on-chain accumulators: 2 + 37*10 signals
        assertEq(mock.lastInputLength(), 2 + 37 * 10);
    }

    function test_WrongClearingTickReverts() public {
        _runEpochAndClose();
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = _emptyProof();
        vm.prank(admin);
        vm.expectRevert(MONIAOracle.WrongClearingTick.selector);
        oracle.postPrint(1, 5, _depth(), a, b, c);
    }

    function test_BadProofReverts() public {
        _runEpochAndClose();
        mock.setResult(false);
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = _emptyProof();
        vm.prank(admin);
        vm.expectRevert(MONIAOracle.BadProof.selector);
        oracle.postPrint(1, 4, _depth(), a, b, c);
    }

    function test_NotClosedReverts() public {
        vm.prank(keeper);
        ah.openEpoch();
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = _emptyProof();
        vm.prank(admin);
        vm.expectRevert(MONIAOracle.EpochNotClosed.selector);
        oracle.postPrint(1, 4, _depth(), a, b, c);
    }

    function test_NoDoublePrint() public {
        _runEpochAndClose();
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = _emptyProof();
        vm.startPrank(admin);
        oracle.postPrint(1, 4, _depth(), a, b, c);
        // epoch is now Printed, so the Closed-status guard fires first — double
        // print is prevented either way.
        vm.expectRevert(MONIAOracle.EpochNotClosed.selector);
        oracle.postPrint(1, 4, _depth(), a, b, c);
        vm.stopPrank();
    }

    function test_NoTrade() public {
        // asks at tick 20, bids at tick 4 -> supply only at high tick, demand at low
        // tick: never crosses (lenders want >= 20, borrowers accept <= 4)
        EGCT memory eAsk = _enc(100);
        EGCT memory eBid = _enc(100);
        vm.prank(keeper);
        ah.openEpoch();
        vm.prank(lender1);
        ah.submitAsk(20, eAsk, "");
        vm.prank(borrower);
        ah.submitBid(4, eBid);
        vm.warp(block.timestamp + EPOCH_LEN);
        vm.prank(keeper);
        ah.closeEpoch();

        MONIAOracle.DepthPoint[] memory d = new MONIAOracle.DepthPoint[](37);
        d[20].askSum = 100;
        d[4].bidSum = 100;
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = _emptyProof();
        uint16 noTrade = oracle.NO_TRADE(); // precompute — external call would eat the prank
        vm.prank(admin);
        oracle.postPrint(1, noTrade, d, a, b, c);

        (uint16 tick,,, bool exists) = oracle.prints(1);
        assertEq(tick, noTrade);
        assertTrue(exists);
    }

    function test_OnlyAdmin() public {
        _runEpochAndClose();
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = _emptyProof();
        vm.expectRevert(MONIAOracle.NotAdmin.selector);
        oracle.postPrint(1, 4, _depth(), a, b, c);
    }
}
