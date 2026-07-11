pragma circom 2.1.9;

include "../../contracts/lib/EncryptedERC/circom/components.circom";

// DepthCurve PoCD — 37-tick ARRAY version (production).
//
// Proves the WHOLE published depth curve (both sides, all 37 ticks) is the true
// decryption of AuctionHouse's on-chain EGCT accumulators under the auditor key:
//   (1) auditorPub == auditorPriv · G                          (once)
//   (2) for every tick t and side s: Dec(auditorPriv, C[s][t]) == claimed[s][t]
//
// So the administrator cannot reshape the curve — the SHAPE is proven, not just
// the totals. Empty ticks read as the identity point (0,1) on-chain and claim 0,
// which verifies trivially (Dec(identity)=identity=0·G).
//
// Public-signal order MUST match MONIAOracle._buildPublicSignals (grouped):
//   auditorPub[2], askC1[37][2], askC2[37][2], askSum[37],
//                  bidC1[37][2], bidC2[37][2], bidSum[37]   => 2 + 37*10 = 372.
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

component main { public [ auditorPub, askC1, askC2, askSum, bidC1, bidC2, bidSum ] } = DepthPoCDArray(37);
