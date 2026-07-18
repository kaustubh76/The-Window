// Per-record derivations shared by the indexer's rebuild() (services/indexer/index.mjs) and the
// snapshot generator (scripts/gen_indexer_snapshot.mjs). Both go through THIS module so a baked
// printCache/sizeCache is byte-identical to what a live rebuild computes — no drift, no double copy
// of the postPrint-calldata decode. These are the two per-record CHAIN READS that dominate a cold
// rebuild (getTransaction + prints() per RatePrinted, loans() per LoanCreated); baking them is what
// turns a ~7-minute cold start into seconds.
import { provider } from "../lib/chain.mjs";

export const NO_TRADE = 65535;
export const bps = (tick) => 100 + 25 * Number(tick);
export const cipher = (egct) => ({
  c1: [egct.c1.x.toString(), egct.c1.y.toString()],
  c2: [egct.c2.x.toString(), egct.c2.y.toString()],
});

// Decode a RatePrinted event into the served M-ONIA print: the 37-tick depth curve from the
// postPrint calldata + aggVolume/printedAt from prints(). Returns { print, hasTx } — hasTx=false
// means the RPC hasn't indexed the tx yet, so the caller must NOT cache it (retry next rebuild).
export async function decodeRatePrint(H, ev) {
  const epoch = Number(ev.args.epoch);
  const rTick = Number(ev.args.rStarTick);
  const tx = await provider.getTransaction(ev.transactionHash);
  let depth = [];
  try {
    const parsed = H.oracle.interface.parseTransaction({ data: tx.data });
    depth = parsed.args.depth.map((p, tick) => ({ // (askSum,bidSum)[]
      tick,
      bps: bps(tick),
      supply: p.askSum.toString(),
      demand: p.bidSum.toString(),
    }));
  } catch { /* attested / non-decodable */ }
  const pr = await H.oracle.prints(epoch);
  return {
    print: {
      epoch,
      rStarBps: rTick === NO_TRADE ? null : bps(rTick),
      aggVolume: pr.aggVolume.toString(),
      depth,
      pocd: { verified: true, txHash: ev.transactionHash },
      printedAt: Number(pr.printedAt) * 1000,
      stale: false,
    },
    hasTx: !!tx,
  };
}

// The loan's encrypted size ciphertext — the one per-loan contract read (memoized in sizeCache).
export async function loanSizeCipher(H, loanId) {
  return cipher((await H.book.loans(loanId)).cSize);
}
