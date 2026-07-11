// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoCDVerifier} from "../interfaces/IPoCDVerifier.sol";

/// @notice Test double for the PoCD verifier — lets Anvil e2e run without proving.
///         Records the last public-input vector so tests can assert the oracle
///         bound the proof to the correct on-chain accumulators.
contract MockVerifier is IPoCDVerifier {
    bool public result = true;
    uint256[] public lastInput;

    function setResult(bool r) external {
        result = r;
    }

    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[] calldata input
    ) external returns (bool) {
        lastInput = input;
        return result;
    }

    function lastInputLength() external view returns (uint256) {
        return lastInput.length;
    }
}
