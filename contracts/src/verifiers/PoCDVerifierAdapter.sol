// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoCDVerifier} from "../interfaces/IPoCDVerifier.sol";

/// @notice The generated Groth16 verifier for one 10-tick DepthCurve PoCD chunk
///         (102 public signals; the 37-tick curve is proven as 4 such chunks).
interface IDepthArrayGroth16 {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[102] calldata input
    ) external view returns (bool);
}

/// @notice Bridges MONIAOracle's dynamic `IPoCDVerifier` seam (uint256[] input)
///         to the snarkjs-generated verifier's fixed `uint[102]` signature.
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
        if (input.length != 102) revert BadInputLength();
        uint256[102] memory fixedInput;
        for (uint256 i = 0; i < 102; i++) {
            fixedInput[i] = input[i];
        }
        return inner.verifyProof(a, b, c, fixedInput);
    }
}
