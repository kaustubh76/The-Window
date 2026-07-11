// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoCDVerifier} from "../interfaces/IPoCDVerifier.sol";

/// @notice The generated Groth16 verifier for the 37-tick DepthCurve PoCD.
interface IDepthArrayGroth16 {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[372] calldata input
    ) external view returns (bool);
}

/// @notice Bridges MONIAOracle's dynamic `IPoCDVerifier` seam (uint256[] input)
///         to the snarkjs-generated verifier's fixed `uint[372]` signature.
///         Hard length guard so a malformed public-signal vector can't slip through.
contract PoCDVerifierAdapter is IPoCDVerifier {
    IDepthArrayGroth16 public immutable inner;

    error BadInputLength();

    constructor(address inner_) {
        inner = IDepthArrayGroth16(inner_);
    }

    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata input
    ) external view returns (bool) {
        if (input.length != 372) revert BadInputLength();
        uint256[372] memory fixedInput;
        for (uint256 i = 0; i < 372; i++) {
            fixedInput[i] = input[i];
        }
        return inner.verifyProof(a, b, c, fixedInput);
    }
}
