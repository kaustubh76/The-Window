// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MemberRegistry} from "../src/MemberRegistry.sol";
import {AuctionHouse} from "../src/AuctionHouse.sol";
import {MemberGated} from "../src/MemberGated.sol";
import {BabyJubJub} from "@eerc/libraries/BabyJubJub.sol";
import {Point, EGCT} from "@eerc/types/Types.sol";

contract AuctionHouseTest is Test {
    MemberRegistry reg;
    AuctionHouse ah;

    address admin = address(0xA11CE);
    address keeper = address(0xCEE9E9);
    address oracle = address(0x0AAC1E);
    address lender1 = address(0x1E1);
    address lender2 = address(0x1E2);
    address borrower = address(0xB0B);
    address nonMember = address(0xDEAD);

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
        ah.setOracle(oracle);
        auditorPub = BabyJubJub.scalarMultiply(BabyJubJub.base8(), AUDITOR_PRIV);
    }

    function _enc(uint256 size) internal view returns (EGCT memory) {
        return BabyJubJub.encrypt(auditorPub, size);
    }

    function _decrypt(EGCT memory c) internal view returns (Point memory) {
        return BabyJubJub._sub(c.c2, BabyJubJub.scalarMultiply(c.c1, AUDITOR_PRIV));
    }

    function test_OpenBidCloseAndAggregate() public {
        // Precompute ciphertexts BEFORE pranking — BabyJubJub.encrypt is an
        // external library call that would otherwise consume the prank.
        EGCT memory e100 = _enc(100);
        EGCT memory e250 = _enc(250);
        EGCT memory e300 = _enc(300);

        vm.prank(keeper);
        ah.openEpoch();
        assertEq(uint256(ah.currentEpoch()), 1);

        // two lenders ask at tick 4 with sizes 100 and 250
        vm.prank(lender1);
        ah.submitAsk(4, e100, "");
        vm.prank(lender2);
        ah.submitAsk(4, e250, "");
        // one borrower bids at tick 10 size 300
        vm.prank(borrower);
        ah.submitBid(10, e300);

        (EGCT memory askAgg, uint32 askCount, bool askInit) = ah.getAggregate(1, ah.ASK(), 4);
        assertEq(askCount, 2);
        assertTrue(askInit);

        // aggregate decrypts to (100+250)*G
        Point memory got = _decrypt(askAgg);
        Point memory exp = BabyJubJub.scalarMultiply(BabyJubJub.base8(), 350);
        assertEq(got.x, exp.x);
        assertEq(got.y, exp.y);

        (, uint32 bidCount,) = ah.getAggregate(1, ah.BID(), 10);
        assertEq(bidCount, 1);

        // close after window
        vm.warp(block.timestamp + EPOCH_LEN);
        vm.prank(keeper);
        ah.closeEpoch();
        assertEq(uint256(ah.epochStatus(1)), uint256(AuctionHouse.Status.Closed));
    }

    function test_NonMemberCannotBid() public {
        EGCT memory e = _enc(100);
        vm.prank(keeper);
        ah.openEpoch();
        vm.prank(nonMember);
        vm.expectRevert(MemberGated.NotMember.selector);
        ah.submitAsk(4, e, "");
    }

    function test_OneBidPerTick() public {
        EGCT memory e1 = _enc(100);
        EGCT memory e2 = _enc(50);
        vm.prank(keeper);
        ah.openEpoch();
        vm.prank(lender1);
        ah.submitAsk(4, e1, "");
        vm.prank(lender1);
        vm.expectRevert(AuctionHouse.AlreadyBidHere.selector);
        ah.submitAsk(4, e2, "");
    }

    function test_BadTickReverts() public {
        EGCT memory e = _enc(100);
        vm.prank(keeper);
        ah.openEpoch();
        vm.prank(lender1);
        vm.expectRevert(AuctionHouse.BadTick.selector);
        ah.submitAsk(37, e, "");
    }

    function test_CannotBidWhenNotOpen() public {
        EGCT memory e = _enc(100);
        vm.prank(lender1);
        vm.expectRevert(AuctionHouse.NotOpen.selector);
        ah.submitAsk(4, e, "");
    }

    function test_CloseBeforeWindowReverts() public {
        vm.prank(keeper);
        ah.openEpoch();
        vm.prank(keeper);
        vm.expectRevert(AuctionHouse.WindowNotElapsed.selector);
        ah.closeEpoch();
    }

    function test_OnlyKeeperLifecycle() public {
        vm.expectRevert(AuctionHouse.NotKeeper.selector);
        ah.openEpoch();
    }

    function test_MarkPrintedOnlyOracleAndClosed() public {
        vm.prank(keeper);
        ah.openEpoch();
        // not closed yet
        vm.prank(oracle);
        vm.expectRevert(AuctionHouse.EpochNotClosed.selector);
        ah.markPrinted(1);

        vm.warp(block.timestamp + EPOCH_LEN);
        vm.prank(keeper);
        ah.closeEpoch();

        // non-oracle cannot mark
        vm.expectRevert(AuctionHouse.NotOracle.selector);
        ah.markPrinted(1);

        vm.prank(oracle);
        ah.markPrinted(1);
        assertEq(uint256(ah.epochStatus(1)), uint256(AuctionHouse.Status.Printed));
    }

    function test_OracleSetOnce() public {
        vm.expectRevert(AuctionHouse.AlreadySet.selector);
        ah.setOracle(address(0x1234));
    }
}
