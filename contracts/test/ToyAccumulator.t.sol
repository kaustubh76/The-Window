// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {ToyAccumulator} from "../src/spike/ToyAccumulator.sol";
import {BabyJubJub} from "@eerc/libraries/BabyJubJub.sol";
import {Point, EGCT} from "@eerc/types/Types.sol";

/// @notice D2 GATE test — homomorphic accumulation of eERC ciphertexts + correct
///         decryption of the on-chain sum, with per-add gas measurement.
contract ToyAccumulatorTest is Test {
    ToyAccumulator internal toy;

    // Auditor keypair (test scalar): pub = priv · G
    uint256 internal constant AUDITOR_PRIV = 2748579834902348905823409582340958234;
    Point internal auditorPub;

    function setUp() public {
        toy = new ToyAccumulator();
        auditorPub = BabyJubJub.scalarMultiply(BabyJubJub.base8(), AUDITOR_PRIV);
    }

    /// @dev Enc(m1) ⊕ Enc(m2) accumulated on-chain must decrypt to (m1+m2)·G.
    function test_HomomorphicSumDecryptsCorrectly() public {
        uint256 m1 = 100;
        uint256 m2 = 250;

        EGCT memory e1 = toy.encryptTo(auditorPub, m1);
        EGCT memory e2 = toy.encryptTo(auditorPub, m2);

        toy.accumulate(e1);
        toy.accumulate(e2);

        (Point memory c1, Point memory c2) = toy.acc();
        Point memory recovered = toy.decryptToPoint(EGCT({c1: c1, c2: c2}), AUDITOR_PRIV);
        Point memory expected = toy.messagePoint(m1 + m2);

        assertEq(recovered.x, expected.x, "decrypted x != (m1+m2)G x");
        assertEq(recovered.y, expected.y, "decrypted y != (m1+m2)G y");
        assertEq(toy.count(), 2, "count");
    }

    /// @dev Accumulate many ciphertexts; sum must still decrypt correctly.
    function test_ManyAccumulate() public {
        uint256 total;
        for (uint256 i = 1; i <= 10; i++) {
            uint256 m = i * 7;
            total += m;
            toy.accumulate(toy.encryptTo(auditorPub, m));
        }
        (Point memory c1, Point memory c2) = toy.acc();
        Point memory recovered = toy.decryptToPoint(EGCT({c1: c1, c2: c2}), AUDITOR_PRIV);
        Point memory expected = toy.messagePoint(total);
        assertEq(recovered.x, expected.x, "x");
        assertEq(recovered.y, expected.y, "y");
    }

    /// @dev Measure the gas of a single homomorphic add (the accumulator step).
    function test_MeasurePerAddGas() public {
        EGCT memory e1 = toy.encryptTo(auditorPub, 500);
        EGCT memory e2 = toy.encryptTo(auditorPub, 900);
        toy.accumulate(e1); // first call = init (cheap store)

        uint256 g0 = gasleft();
        toy.accumulate(e2); // second call = two BabyJubJub._add (the real cost)
        uint256 used = g0 - gasleft();

        console2.log("per-add accumulate() gas (2x point add + SSTORE):", used);
        // GATE target: sane on-chain cost (< ~500k). Two point-adds dominated by
        // modexp precompile for inversion.
        assertLt(used, 500_000, "per-add gas exceeds gate budget");
    }
}
