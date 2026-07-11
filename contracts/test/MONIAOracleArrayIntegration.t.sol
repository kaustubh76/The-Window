// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MemberRegistry} from "../src/MemberRegistry.sol";
import {AuctionHouse} from "../src/AuctionHouse.sol";
import {MONIAOracle} from "../src/MONIAOracle.sol";
import {DepthPoCDArrayVerifier} from "../src/verifiers/DepthPoCDArrayVerifier.sol";
import {PoCDVerifierAdapter} from "../src/verifiers/PoCDVerifierAdapter.sol";
import {BabyJubJub} from "@eerc/libraries/BabyJubJub.sol";
import {Point, EGCT} from "@eerc/types/Types.sol";

/// @notice Capstone — the REAL chunked PoCD (4 x 10-tick proofs), bound to on-chain
/// accumulators. The scenario (ask 300 @ tick4, bid 300 @ tick10, auditorPriv from the
/// fixture) is submitted on-chain; each chunk's accumulator slice must EXACTLY equal
/// that chunk proof's 102 public signals, so MONIAOracle.postPrint with the real
/// verifier prints r* = tick 4.
contract MONIAOracleArrayIntegrationTest is Test {
    // Must equal the auditorPriv used by emit_array_fixture.mjs.
    uint256 constant FIXTURE_PRIV = 2748579834902348905823409582340958234;
    uint256 constant EPOCH_LEN = 60;

    MemberRegistry reg;
    AuctionHouse ah;
    MONIAOracle oracle;
    PoCDVerifierAdapter adapter;
    Point auditorPub;

    MONIAOracle.Groth16Proof[4] PROOFS;

    function setUp() public {
        auditorPub = BabyJubJub.scalarMultiply(BabyJubJub.base8(), FIXTURE_PRIV);

        reg = new MemberRegistry(address(this));
        reg.addMember(address(this), 1, 0);
        ah = new AuctionHouse(address(reg), EPOCH_LEN, address(this));
        adapter = new PoCDVerifierAdapter(address(new DepthPoCDArrayVerifier()));
        oracle = new MONIAOracle(address(ah), address(adapter), address(this), auditorPub.x, auditorPub.y);
        ah.setOracle(address(oracle));

        string memory j = vm.readFile("test/fixtures/depth_chunks.json");
        for (uint256 k = 0; k < 4; k++) {
            string memory p = string.concat(".chunks[", vm.toString(k), "]");
            uint256[] memory a = vm.parseJsonUintArray(j, string.concat(p, ".a"));
            uint256[] memory b0 = vm.parseJsonUintArray(j, string.concat(p, ".b0"));
            uint256[] memory b1 = vm.parseJsonUintArray(j, string.concat(p, ".b1"));
            uint256[] memory c = vm.parseJsonUintArray(j, string.concat(p, ".c"));
            PROOFS[k].a = [a[0], a[1]];
            PROOFS[k].b = [[b0[0], b0[1]], [b1[0], b1[1]]];
            PROOFS[k].c = [c[0], c[1]];
        }
    }

    function test_RealPoCDBoundToOnChainAccumulators() public {
        EGCT memory eAsk = BabyJubJub.encrypt(auditorPub, 300);
        EGCT memory eBid = BabyJubJub.encrypt(auditorPub, 300);

        ah.openEpoch();
        ah.submitAsk(4, eAsk, "");
        ah.submitBid(10, eBid);
        vm.warp(block.timestamp + EPOCH_LEN);
        ah.closeEpoch();

        MONIAOracle.DepthPoint[] memory d = new MONIAOracle.DepthPoint[](37);
        d[4].askSum = 300;
        d[10].bidSum = 300;

        // The real chunk verifier checks each 102-signal slice built from the ON-CHAIN
        // accumulators — this only passes if the circuit's ciphertexts match the
        // homomorphic accumulator bit-for-bit, chunk by chunk.
        oracle.postPrint(1, 4, d, PROOFS);

        (uint16 tick, uint256 vol,, bool exists) = oracle.prints(1);
        assertTrue(exists, "printed");
        assertEq(tick, 4, "r* = tick 4");
        assertEq(vol, 300, "matched volume");
        assertEq(uint256(ah.epochStatus(1)), uint256(AuctionHouse.Status.Printed));
    }

    function test_SwappedChunkProofsRevert() public {
        EGCT memory eAsk = BabyJubJub.encrypt(auditorPub, 300);
        EGCT memory eBid = BabyJubJub.encrypt(auditorPub, 300);

        ah.openEpoch();
        ah.submitAsk(4, eAsk, "");
        ah.submitBid(10, eBid);
        vm.warp(block.timestamp + EPOCH_LEN);
        ah.closeEpoch();

        MONIAOracle.DepthPoint[] memory d = new MONIAOracle.DepthPoint[](37);
        d[4].askSum = 300;
        d[10].bidSum = 300;

        // Swap chunk 0 and 1 proofs: each is valid for its own slice but must fail
        // against the other's on-chain-built public signals.
        MONIAOracle.Groth16Proof[4] memory swapped = PROOFS;
        (swapped[0], swapped[1]) = (swapped[1], swapped[0]);
        vm.expectRevert(MONIAOracle.BadProof.selector);
        oracle.postPrint(1, 4, d, swapped);
    }
}
