// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BabyJubJub} from "@eerc/libraries/BabyJubJub.sol";
import {Point, EGCT} from "@eerc/types/Types.sol";

/// @title ToyAccumulator — D2 GATE artifact
/// @notice Proves that an external contract can homomorphically accumulate eERC
///         ElGamal ciphertexts (EGCT) on-chain via the eERC BabyJubJub library.
///         This is the exact primitive AuctionHouse needs for `Σ Enc(size)` per tick.
/// @dev BabyJubJub exposes `public` library functions, so this contract links to a
///      deployed BabyJubJub library instance (Foundry links it automatically).
contract ToyAccumulator {
    /// @notice Running homomorphic sum of all accumulated ciphertexts.
    EGCT public acc;
    bool public initialized;
    uint256 public count;

    /// @notice Add one ciphertext into the running accumulator.
    /// @dev Enc(a) ⊕ Enc(b) = Enc(a+b): componentwise BabyJubJub point addition.
    function accumulate(EGCT calldata c) external {
        if (!initialized) {
            acc = c;
            initialized = true;
        } else {
            acc.c1 = BabyJubJub._add(acc.c1, c.c1);
            acc.c2 = BabyJubJub._add(acc.c2, c.c2);
        }
        unchecked {
            ++count;
        }
    }

    /// @notice Pure homomorphic sum of two ciphertexts (view; for gas measurement).
    function sum(EGCT calldata a, EGCT calldata b) external view returns (EGCT memory) {
        return EGCT({c1: BabyJubJub._add(a.c1, b.c1), c2: BabyJubJub._add(a.c2, b.c2)});
    }

    /// @notice Deterministic on-chain ElGamal encryption to a public key (nonce = 1).
    /// @dev Mirrors eERC BabyJubJub.encrypt; used by tests to build ciphertexts.
    function encryptTo(Point calldata pub, uint256 message) external view returns (EGCT memory) {
        return BabyJubJub.encrypt(pub, message);
    }

    /// @notice ElGamal decryption helper: returns M = c2 - priv·c1 = message·G.
    /// @dev The caller recovers `message` from M off-chain via baby-step-giant-step.
    function decryptToPoint(EGCT calldata c, uint256 priv) external view returns (Point memory) {
        return BabyJubJub._sub(c.c2, BabyJubJub.scalarMultiply(c.c1, priv));
    }

    /// @notice message·G, i.e. the expected decryption point for a known plaintext.
    function messagePoint(uint256 message) external view returns (Point memory) {
        return BabyJubJub.scalarMultiply(BabyJubJub.base8(), message);
    }
}
