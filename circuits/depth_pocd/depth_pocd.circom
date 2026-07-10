pragma circom 2.1.9;

// Reuse eERC's own audited BabyJubJub/ElGamal templates (verify-first: do not
// reinvent curve arithmetic). Included from the vendored ava-labs/EncryptedERC
// submodule so the in-circuit curve matches the on-chain BabyJubJub library.
include "../../contracts/lib/EncryptedERC/circom/components.circom";

// DepthCurve PoCD — D2 GATE (single-sum version).
//
// Proves, in zero knowledge, that the holder of the auditor private key knows a
// key `auditorPriv` such that:
//   (1) auditorPub == auditorPriv · G                (key binds to the public auditor key)
//   (2) Dec(auditorPriv, Csum) == claimedSum         (the claimed plaintext is the true
//                                                      decryption of the on-chain ciphertext sum)
//
// Csum is a homomorphic accumulation of eERC ElGamal ciphertexts (EGCT) — the exact
// value AuctionHouse stores per tick. This is the D4 array circuit's inner constraint,
// instantiated once for the gate.
template DepthPoCDSingle() {
    // ---- public inputs (bound to on-chain state in MONIAOracle) ----
    signal input Csum_c1[2];    // accumulator EGCT.c1 (x,y)
    signal input Csum_c2[2];    // accumulator EGCT.c2 (x,y)
    signal input claimedSum;    // claimed Σ sizes (plaintext, recovered off-chain via BSGS)
    signal input auditorPub[2]; // auditor public key (x,y)

    // ---- private witness ----
    signal input auditorPriv;   // auditor private key (scalar)

    // (1) auditorPub == auditorPriv · G
    component checkPk = CheckPublicKey();
    checkPk.privKey <== auditorPriv;
    checkPk.pubKey[0] <== auditorPub[0];
    checkPk.pubKey[1] <== auditorPub[1];

    // (2) Dec(auditorPriv, Csum) == claimedSum  (reuses eERC ElGamalDecrypt inside)
    component checkVal = CheckValue();
    checkVal.value <== claimedSum;
    checkVal.privKey <== auditorPriv;
    checkVal.valueC1[0] <== Csum_c1[0];
    checkVal.valueC1[1] <== Csum_c1[1];
    checkVal.valueC2[0] <== Csum_c2[0];
    checkVal.valueC2[1] <== Csum_c2[1];
}

component main { public [ Csum_c1, Csum_c2, claimedSum, auditorPub ] } = DepthPoCDSingle();
