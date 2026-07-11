pragma circom 2.1.9;

include "../../contracts/lib/EncryptedERC/circom/components.circom";

// DepthCurve PoCD — CHUNKED array version (production).
//
// Proves a 10-tick CHUNK of the published depth curve (both sides) is the true
// decryption of AuctionHouse's on-chain EGCT accumulators under the auditor key:
//   (1) auditorPub == auditorPriv · G                          (once per chunk)
//   (2) for every tick t and side s: Dec(auditorPriv, C[s][t]) == claimed[s][t]
//
// The full 37-tick curve is proven as K=4 chunks over tick ranges
// [0..9], [10..19], [20..29], [30..36] — the last chunk pads virtual ticks
// 37-39 with the identity point (0,1) and claim 0, which verifies trivially
// (Dec(identity)=identity=0·G), exactly like empty on-chain ticks.
// Chunking keeps the generated Groth16 verifier under EIP-170's 24,576-byte
// deployed-code limit (372-signal monolith was 62,708 bytes; 102-signal chunk
// verifier is ~18KB) so it deploys on real chains (Fuji/mainnet).
//
// So the administrator cannot reshape the curve — the SHAPE is proven, not just
// the totals. Cross-chunk swaps fail because each chunk's public signals embed
// its own accumulator slice.
//
// Public-signal order MUST match MONIAOracle._buildChunkSignals (grouped):
//   auditorPub[2], askC1[10][2], askC2[10][2], askSum[10],
//                  bidC1[10][2], bidC2[10][2], bidSum[10]   => 2 + 10*10 = 102.
template DepthPoCDArray(N) {
    signal input auditorPub[2];
    signal input askC1[N][2];
    signal input askC2[N][2];
    signal input askSum[N];
    signal input bidC1[N][2];
    signal input bidC2[N][2];
    signal input bidSum[N];

    signal input auditorPriv; // private

    // (1) key binds once
    component checkPk = CheckPublicKey();
    checkPk.privKey <== auditorPriv;
    checkPk.pubKey[0] <== auditorPub[0];
    checkPk.pubKey[1] <== auditorPub[1];

    // (2) per-tick correct decryption, both sides
    component ask[N];
    component bid[N];
    for (var t = 0; t < N; t++) {
        ask[t] = CheckValue();
        ask[t].value <== askSum[t];
        ask[t].privKey <== auditorPriv;
        ask[t].valueC1[0] <== askC1[t][0];
        ask[t].valueC1[1] <== askC1[t][1];
        ask[t].valueC2[0] <== askC2[t][0];
        ask[t].valueC2[1] <== askC2[t][1];

        bid[t] = CheckValue();
        bid[t].value <== bidSum[t];
        bid[t].privKey <== auditorPriv;
        bid[t].valueC1[0] <== bidC1[t][0];
        bid[t].valueC1[1] <== bidC1[t][1];
        bid[t].valueC2[0] <== bidC2[t][0];
        bid[t].valueC2[1] <== bidC2[t][1];
    }
}

component main { public [ auditorPub, askC1, askC2, askSum, bidC1, bidC2, bidSum ] } = DepthPoCDArray(10);
