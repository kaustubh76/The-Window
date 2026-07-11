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

/// @notice Phase B capstone — the REAL 37-tick PoCD, bound to on-chain accumulators.
/// The scenario (ask 300 @ tick4, bid 300 @ tick10, auditorPriv from the fixture) is
/// submitted on-chain; the resulting accumulators must EXACTLY equal the proof's 372
/// public signals, so MONIAOracle.postPrint with the real verifier prints r* = tick 4.
contract MONIAOracleArrayIntegrationTest is Test {
    // Must equal the auditorPriv used by gen_pocd_array_input.mjs.
    uint256 constant FIXTURE_PRIV = 2748579834902348905823409582340958234;
    uint256 constant EPOCH_LEN = 60;

    MemberRegistry reg;
    AuctionHouse ah;
    MONIAOracle oracle;
    PoCDVerifierAdapter adapter;
    Point auditorPub;

    uint256[2] A;
    uint256[2][2] B;
    uint256[2] C;

    function setUp() public {
        auditorPub = BabyJubJub.scalarMultiply(BabyJubJub.base8(), FIXTURE_PRIV);

        reg = new MemberRegistry(address(this));
        reg.addMember(address(this), 1, 0);
        ah = new AuctionHouse(address(reg), EPOCH_LEN, address(this));
        adapter = new PoCDVerifierAdapter(address(new DepthPoCDArrayVerifier()));
        oracle = new MONIAOracle(address(ah), address(adapter), address(this), auditorPub.x, auditorPub.y);
        ah.setOracle(address(oracle));

        string memory j = vm.readFile("test/fixtures/depth_array.json");
        uint256[] memory a = vm.parseJsonUintArray(j, ".a");
        uint256[] memory b0 = vm.parseJsonUintArray(j, ".b0");
        uint256[] memory b1 = vm.parseJsonUintArray(j, ".b1");
        uint256[] memory c = vm.parseJsonUintArray(j, ".c");
        A = [a[0], a[1]];
        B = [[b0[0], b0[1]], [b1[0], b1[1]]];
        C = [c[0], c[1]];
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

        // The real array verifier checks the 372 signals built from the ON-CHAIN
        // accumulators — this only passes if the circuit's ciphertexts match the
        // homomorphic accumulator bit-for-bit.
        oracle.postPrint(1, 4, d, A, B, C);

        (uint16 tick, uint256 vol,, bool exists) = oracle.prints(1);
        assertTrue(exists, "printed");
        assertEq(tick, 4, "r* = tick 4");
        assertEq(vol, 300, "matched volume");
        assertEq(uint256(ah.epochStatus(1)), uint256(AuctionHouse.Status.Printed));
    }
}
