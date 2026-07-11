// The four README §12 agent archetypes as pure, seeded functions. They produce a
// realistic supply/demand crossing so r* and the sparkline drift epoch-to-epoch.
import type { Address, Side, TickIndex } from '../types';
import { bpsToTick } from '../../rates';
import { SIM_MEMBERS, type Archetype } from './members';
import { Rng } from './rng';

export interface SimBid {
  bidder: Address;
  side: Side;
  tick: TickIndex;
  sizeMicro: bigint;
  r: bigint; // deterministic ElGamal randomness
}

const usdc = (n: number): bigint => BigInt(Math.round(n)) * 1_000000n;

// Each archetype returns a bid (or null to sit out this epoch).
function bidFor(archetype: Archetype, rng: Rng): { side: Side; bps: number; size: number } | null {
  switch (archetype) {
    case 'yield-lender':
      // deep float, moderate minimum rate. asks ~3.5%-5%, large size so supply tends to meet demand.
      return { side: 'ask', bps: 25 * rng.int(10, 16) + 100, size: rng.int(3500, 7000) };
    case 'opportunistic-lender':
      // lends cheaper to win fills; asks ~3%-4.25%.
      return { side: 'ask', bps: 25 * rng.int(8, 13) + 100, size: rng.int(2000, 5000) };
    case 'desperate-borrower':
      // needs working capital now; bids a high max rate ~5%-7%.
      return { side: 'bid', bps: 25 * rng.int(16, 24) + 100, size: rng.int(2500, 4500) };
    case 'opportunistic-borrower':
      // only borrows if cheap; bids a lower max ~4%-5.25%.
      return { side: 'bid', bps: 25 * rng.int(12, 17) + 100, size: rng.int(1500, 3000) };
    case 'noise':
      // random side, wide band, small-medium — sometimes sits out.
      if (rng.bool(0.35)) return null;
      return { side: rng.bool(0.5) ? 'ask' : 'bid', bps: 25 * rng.int(6, 30) + 100, size: rng.int(800, 2500) };
  }
}

export function generateBids(rng: Rng, epoch: number): SimBid[] {
  const bids: SimBid[] = [];
  for (const m of SIM_MEMBERS) {
    // anchors (yield-lender + desperate-borrower) always participate so the book crosses;
    // opportunists have a small sit-out jitter.
    const isAnchor = m.archetype === 'yield-lender' || m.archetype === 'desperate-borrower';
    if (!isAnchor && m.archetype !== 'noise' && rng.bool(0.12)) continue;
    const spec = bidFor(m.archetype, rng);
    if (!spec) continue;
    const bps = Math.max(100, Math.min(1000, spec.bps));
    bids.push({
      bidder: m.address,
      side: spec.side,
      tick: bpsToTick(bps),
      sizeMicro: usdc(spec.size),
      r: rng.scalar(),
    });
  }
  void epoch;
  return bids;
}
