// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DepthPoCDArrayVerifier} from "../src/verifiers/DepthPoCDArrayVerifier.sol";
import {PoCDVerifierAdapter} from "../src/verifiers/PoCDVerifierAdapter.sol";

/// @notice On-chain (EVM) verification of the CHUNKED DepthCurve PoCD (4 x 10-tick
///         proofs, 102 public signals each), through the dynamic PoCDVerifierAdapter
///         seam (as MONIAOracle uses it). Proofs + signals loaded from
///         test/fixtures/depth_chunks.json (packages/eerc-node/src/emit_array_fixture.mjs).
contract DepthPoCDArrayGateTest is Test {
    uint256 constant CHUNKS = 4;

    DepthPoCDArrayVerifier verifier;
    PoCDVerifierAdapter adapter;

    uint256[2][CHUNKS] A;
    uint256[2][2][CHUNKS] B;
    uint256[2][CHUNKS] C;
    uint256[][] PUB;

    function setUp() public {
        verifier = new DepthPoCDArrayVerifier();
        adapter = new PoCDVerifierAdapter(address(verifier));

        string memory j = vm.readFile("test/fixtures/depth_chunks.json");
        PUB = new uint256[][](CHUNKS);
        for (uint256 k = 0; k < CHUNKS; k++) {
            string memory p = string.concat(".chunks[", vm.toString(k), "]");
            uint256[] memory a = vm.parseJsonUintArray(j, string.concat(p, ".a"));
            uint256[] memory b0 = vm.parseJsonUintArray(j, string.concat(p, ".b0"));
            uint256[] memory b1 = vm.parseJsonUintArray(j, string.concat(p, ".b1"));
            uint256[] memory c = vm.parseJsonUintArray(j, string.concat(p, ".c"));
            PUB[k] = vm.parseJsonUintArray(j, string.concat(p, ".pub"));
            A[k] = [a[0], a[1]];
            B[k] = [[b0[0], b0[1]], [b1[0], b1[1]]];
            C[k] = [c[0], c[1]];
        }
    }

    function test_AllChunkProofsVerifyThroughAdapter() public view {
        for (uint256 k = 0; k < CHUNKS; k++) {
            assertEq(PUB[k].length, 102, "102 public signals per chunk");
            assertTrue(adapter.verifyProof(A[k], B[k], C[k], PUB[k]), "valid chunk PoCD must verify");
        }
    }

    function test_TamperedSignalFails() public view {
        // chunk 0 contains the ask 300 @ tick 4; tamper its askSum signal
        // (layout: 2 auditor + 20 askC1 + 20 askC2 + 10 askSum => askSum[4] at index 46)
        uint256[] memory bad = PUB[0];
        bad[46] = bad[46] ^ 1;
        assertFalse(adapter.verifyProof(A[0], B[0], C[0], bad), "tampered signal must not verify");
    }

    function test_CrossChunkProofFails() public view {
        // chunk 1's proof must not verify against chunk 0's public signals
        // (each chunk's signals embed its own accumulator slice)
        assertFalse(adapter.verifyProof(A[1], B[1], C[1], PUB[0]), "cross-chunk swap must not verify");
    }

    function test_WrongLengthReverts() public {
        uint256[] memory short = new uint256[](101);
        vm.expectRevert(PoCDVerifierAdapter.BadInputLength.selector);
        adapter.verifyProof(A[0], B[0], C[0], short);
    }
}
