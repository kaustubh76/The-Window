// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CollateralSolvencyVerifier} from "../src/verifiers/CollateralSolvencyVerifier.sol";

/// @notice D4 — on-chain verification of a CollateralSolvency (Circuit 1) proof.
/// Witness: collateral 6000 vs loan 5000 (exactly 120% haircut). Public signals:
/// [Ccoll_c1(2), Ccoll_c2(2), Cloan_c1(2), Cloan_c2(2), h=12000, ownerPub(2)].
contract CollateralSolvencyGateTest is Test {
    CollateralSolvencyVerifier internal verifier;

    uint256[2] A = [
        0x2d993a5bfba3099f4f564b513a5d74d5a9082bee68e329d5e01811b96b431a4b,
        0x27f75ab2cf3e08eeea428f83bf6f230a84152e7abd0db0dd8d702ac44c1b1f4f
    ];
    uint256[2][2] B = [
        [
            0x122393ddbb15d2ad003c4725f3789cb6b1aff408fd254bd3530c706fd4d4dcef,
            0x07f492310063b839aa5e4f69a0112e6d5f280eb7e4dd5ff046ef00d7d1599a65
        ],
        [
            0x27f2a567f84888afcee5513ec43f34f5e0401c7cbdc67e050f7ad14492526be3,
            0x0c1367b10aef10cabf0b739ffb024420a12144a8512b98964e4166f2052a07d2
        ]
    ];
    uint256[2] C = [
        0x265fbe53cce520f609b4796c5ca18d14ce3805ec860e20a277299fab42676f53,
        0x28e0632a921fda506b64c8c056378ec19e4d680ac93026c98a3bda9a9ab300cf
    ];
    uint256[11] PUB = [
        0x0e62088f9af1dc7ef78521d349e7e2b0ea113d8dc3c2121165875627c913e485,
        0x13edccf6b4e446b664ae35e17916a8b3c8a7cb843bf9b9912eaa9c7dc4ba9693,
        0x01341b5942f988173ce3b353e5dc2d57088e96241ef745e548e05343f53acc77,
        0x2983c4a34b51eaf3ba132fcf5dbf6087d1ce1098ed4745e9082972cd8edf08ef,
        0x1f0ecb33e80259012b75586f20d396cb4d8a0e770c62f97f56c3756ff38cd1d4,
        0x200f7d3d33808b24623dbfa37017bc11d94dbeb3d8a7c0a590363986ab1c81bf,
        0x176891cc7b174ebaa42a4c08c1deba9489716d1582f944948578e42f0bc50a68,
        0x050f553c7ee5fb3f01aea57e8079ad3f86f4be25644ee4189e31c83f4d70c779,
        0x0000000000000000000000000000000000000000000000000000000000002ee0, // h = 12000
        0x17d6f6c6638e203f8344a4d5741e73b85c4b2c66d84e46a20210feb4c385a553,
        0x0386861114cca4bda08a9f8334332887566d75a6ca1360fa8364ea4e1e13b096
    ];

    function setUp() public {
        verifier = new CollateralSolvencyVerifier();
    }

    function test_ValidSolvencyProofVerifies() public view {
        assertTrue(verifier.verifyProof(A, B, C, PUB), "valid solvency proof must verify");
    }

    function test_TamperedHaircutFails() public view {
        uint256[11] memory bad = PUB;
        bad[8] = 11000; // claim a lower haircut than proven
        assertFalse(verifier.verifyProof(A, B, C, bad), "tampered h must not verify");
    }

    function test_TamperedCiphertextFails() public view {
        uint256[11] memory bad = PUB;
        bad[0] = PUB[0] ^ 1;
        assertFalse(verifier.verifyProof(A, B, C, bad), "tampered ciphertext must not verify");
    }
}
