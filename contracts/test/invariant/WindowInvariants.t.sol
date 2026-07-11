// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {WindowHandler} from "./WindowHandler.sol";
import {LoanBook} from "../../src/LoanBook.sol";
import {CollateralVault} from "../../src/CollateralVault.sol";
import {AuctionHouse} from "../../src/AuctionHouse.sol";
import {MONIAOracle} from "../../src/MONIAOracle.sol";

/// @notice The 5 invariants from README §11, fuzzed against WindowHandler.
contract WindowInvariantsTest is Test {
    WindowHandler handler;
    LoanBook book;
    CollateralVault vault;
    AuctionHouse ah;
    MONIAOracle oracle;

    function setUp() public {
        handler = new WindowHandler();
        book = handler.book();
        vault = handler.vault();
        ah = handler.ah();
        oracle = handler.oracle();
        targetContract(address(handler));
    }

    /// Invariant 1: encrypted-collateral conservation — every Active loan has a
    /// locked collateral, and there are never more active loans than locks.
    function invariant_collateralConservation() public view {
        assertLe(book.activeLoanCount(), vault.activeLockCount(), "active loans exceed locks");
        uint256 n = handler.loanIdsLength();
        for (uint256 i = 0; i < n; i++) {
            uint256 id = handler.loanIds(i);
            if (book.loanState(id) == LoanBook.LoanState.Active) {
                assertTrue(vault.isLocked(id), "active loan without lock");
            }
        }
    }

    /// Invariant 2: epoch monotonicity — a printed epoch stays Printed; the
    /// current epoch is never in the None state once started.
    function invariant_epochMonotonicity() public view {
        uint64 e = ah.currentEpoch();
        if (e > 0) {
            assertTrue(ah.epochStatus(e) != AuctionHouse.Status.None, "current epoch None");
        }
        for (uint64 ep = 1; ep <= e; ep++) {
            (, bool printed) = oracle.rateAt(ep);
            if (printed) {
                assertEq(uint256(ah.epochStatus(ep)), uint256(AuctionHouse.Status.Printed), "printed epoch not Printed");
            }
        }
    }

    /// Invariant 3: no double terminal — a Repaid loan's collateral is Released,
    /// a Defaulted loan's collateral is Seized (terminal, never Locked).
    function invariant_noDoubleTerminal() public view {
        uint256 n = handler.loanIdsLength();
        for (uint256 i = 0; i < n; i++) {
            uint256 id = handler.loanIds(i);
            LoanBook.LoanState ls = book.loanState(id);
            (, CollateralVault.LockState vs,) = vault.locks(id);
            if (ls == LoanBook.LoanState.Repaid) {
                assertEq(uint256(vs), uint256(CollateralVault.LockState.Released), "repaid loan collateral not released");
            } else if (ls == LoanBook.LoanState.Defaulted) {
                assertEq(uint256(vs), uint256(CollateralVault.LockState.Seized), "defaulted loan collateral not seized");
            }
        }
    }

    /// Invariant 4: match integrity — every loan clears at its epoch's printed r*.
    function invariant_matchRate() public view {
        uint256 n = handler.loanIdsLength();
        for (uint256 i = 0; i < n; i++) {
            uint256 id = handler.loanIds(i);
            (, , uint64 epoch, uint16 rateTick, , , ) = book.loans(id);
            (uint16 rStar, bool exists) = oracle.rateAt(epoch);
            assertTrue(exists, "loan epoch not printed");
            assertEq(rateTick, rStar, "loan rateTick != epoch r*");
        }
    }

    /// Invariant 5: deadline safety — seize never succeeds at block <= deadline.
    function invariant_deadlineSafety() public view {
        assertFalse(handler.ghost_seizeBeforeDeadlineSucceeded(), "seize succeeded before deadline");
    }

    /// Coverage guard: the handler actions actually compose into the full loan
    /// lifecycle (funded→repaid and funded→seized), so the invariants above are
    /// not vacuously true.
    function test_FullLifecycleReachable() public {
        // Loan A: repay path (epoch 1 opens at t=1, close after its 60s window)
        handler.act_openAndBid();
        vm.warp(100);
        handler.act_closeAndPrint();
        handler.act_postMatch();
        handler.act_lock(0);
        handler.act_fund(0);
        assertEq(uint256(book.loanState(0)), uint256(LoanBook.LoanState.Active), "A active");
        assertTrue(vault.isLocked(0));
        assertEq(book.activeLoanCount(), 1);
        assertEq(vault.activeLockCount(), 1);
        handler.act_repay(0);
        assertEq(uint256(book.loanState(0)), uint256(LoanBook.LoanState.Repaid), "A repaid");

        // Loan B: seize path (epoch 2 opens at t=100, close after its window)
        handler.act_openAndBid();
        vm.warp(300);
        handler.act_closeAndPrint();
        handler.act_postMatch();
        handler.act_lock(1);
        handler.act_fund(1);
        assertEq(uint256(book.loanState(1)), uint256(LoanBook.LoanState.Active), "B active");
        vm.roll(block.number + 10);
        handler.act_seize(1);
        assertEq(uint256(book.loanState(1)), uint256(LoanBook.LoanState.Defaulted), "B defaulted");
        (, CollateralVault.LockState vs,) = vault.locks(1);
        assertEq(uint256(vs), uint256(CollateralVault.LockState.Seized), "B collateral seized");
    }
}
