// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoCDVerifier} from "../interfaces/IPoCDVerifier.sol";

/// @notice The generated Groth16 verifier for CollateralSolvency (11 public signals).
interface ISolvencyGroth16 {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[11] calldata input
    ) external view returns (bool);
}

/// @notice Bridges CollateralVault's dynamic `IPoCDVerifier` seam to the generated
///         CollateralSolvency verifier's fixed `uint[11]` signature.
contract SolvencyVerifierAdapter is IPoCDVerifier {
    ISolvencyGroth16 public immutable inner;

    error BadInputLength();

    constructor(address inner_) {
        inner = ISolvencyGroth16(inner_);
    }

    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata input
    ) external view returns (bool) {
        if (input.length != 11) revert BadInputLength();
        uint256[11] memory fixedInput;
        for (uint256 i = 0; i < 11; i++) {
            fixedInput[i] = input[i];
        }
        return inner.verifyProof(a, b, c, fixedInput);
    }
}
