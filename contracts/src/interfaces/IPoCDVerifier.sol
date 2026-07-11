// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Groth16 PoCD verifier seam. MockVerifier (Anvil) and the generated
///         DepthCurve array verifier (Fuji) both implement this. `input` is the
///         public-signal vector MONIAOracle builds from on-chain accumulators.
interface IPoCDVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata input
    ) external returns (bool);
}
