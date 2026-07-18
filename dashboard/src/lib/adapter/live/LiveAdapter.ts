import type { WindowAdapter } from '../WindowAdapter';
import type {
  Address, Balances, Bps, Ciphertext, DepthPoint, EpochClock, EpochId, Loan, LoanId,
  LoanStatus, MemberInfo, MoniaPrint, MyBid, OnProof, Profile, SessionState, Side,
  TickIndex, TxResult, Unsubscribe, UsdcMicro, WindowEvent,
} from '../types';
import { PROFILE, INDEXER_URL, CONTROL_URL } from '../../../config';
import { IndexerAPI } from '../../../services/indexer';

// Live adapter — the dashboard as a full control + view surface for the disclosed
// SIMULATED members. Public reads come from the indexer; every WRITE is performed
// server-side by the Control API (services/control) using the proven eerc-node flows
// (real proofs), so the browser holds no keys and needs no eERC SDK / circuit artifacts.
const LOCKED: Ciphertext = { c1: ['0', '1'], c2: ['0', '1'] };

// The indexer/control serialize on-chain uint256 as decimal STRINGS. Normalize to bigint
// at the boundary so the store holds honest UsdcMicro (never "string-as-bigint").
function bi(v: unknown): bigint {
  if (typeof v === 'bigint') return v;
  if (v == null) return 0n;
  try {
    return BigInt(typeof v === 'number' ? Math.trunc(v) : String(v).split('.')[0] || '0');
  } catch {
    return 0n;
  }
}

// UNIT BOUNDARY. The auction world (bid size → per-tick askSum/bidSum depth → aggVolume) is
// carried on-chain as bare BabyJubJub scalars that must stay small so the auditor can
// BSGS-decrypt the summed depth — i.e. WHOLE-USDC integers (1 = 1 USDC). The frontend money
// layer is micro-USDC. Translate at this boundary: ×1e6 on the way in, ÷1e6 on the way out.
// (The eERC token world — usdcErc20 / eercClear — is a real 6-dp ERC-20 and is NOT scaled.)
export const EERC_UNIT_MICRO = 1_000_000n;
export const eercToMicro = (v: unknown): bigint => bi(v) * EERC_UNIT_MICRO;
export const microToEercUnit = (micro: bigint): string => (micro / EERC_UNIT_MICRO).toString();

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapDepth(d: any): DepthPoint[] {
  return Array.isArray(d) ? d.map((p) => ({ tick: p.tick, bps: p.bps, supply: eercToMicro(p.supply), demand: eercToMicro(p.demand) })) : [];
}
export function mapPrint(p: any): MoniaPrint | null {
  if (!p) return null;
  return {
    epoch: p.epoch,
    rStarBps: p.rStarBps ?? null,
    aggVolume: eercToMicro(p.aggVolume),
    depth: mapDepth(p.depth),
    pocd: p.pocd ?? { verified: false },
    printedAt: p.printedAt ?? 0,
    stale: !!p.stale,
  };
}
function normStatus(s: string): EpochStatusLike {
  return s === 'Open' || s === 'Closed' || s === 'Printed' ? s : 'Open'; // "None" → pre-open
}
type EpochStatusLike = EpochClock['status'];

async function ctrl(path: string, body?: unknown, method: 'POST' | 'GET' = 'POST'): Promise<any> {
  const res = await fetch(`${CONTROL_URL}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({ ok: false, error: `control ${res.status}` }));
  if (json && json.ok === false) throw new Error(json.error || `control ${path} failed`);
  return json;
}

export class LiveAdapter implements WindowAdapter {
  readonly mode = 'live' as const;
  private profile: Profile = PROFILE;
  private actor: Address | null = null; // the selected/connected member address
  private buffer: WindowEvent[] = []; // recent mapped firehose events (for the Explorer feed)
  private lastBlock = 0;

  async init(): Promise<void> {
    try { await fetch(`${INDEXER_URL}/health`); } catch { /* graceful-empty until up */ }
  }

  /** Called by useEercBridge to reflect the connected wallet / selected persona. */
  setActor(a: Address | null) { this.actor = a ? (a.toLowerCase() as Address) : null; }

  getProfile() { return this.profile; }
  setProfile(p: Profile) { this.profile = p; }

  // ---- clock ----
  async getEpochClock(): Promise<EpochClock> {
    try {
      const c = (await IndexerAPI.epochClock()) as any;
      return { ...c, status: normStatus(c.status), profile: c.profile ?? this.profile } as EpochClock;
    } catch {
      return { epoch: 0, status: 'Open', profile: this.profile, openedAt: 0, closesAt: 0, epochLenMs: 0, tenorMs: 0, now: 0 };
    }
  }
  // MULTICAST poller — one self-scheduling fetch loop feeds every subscriber. The clock is
  // consumed per component instance (every loan row renders a Countdown), so a per-subscriber
  // setInterval scaled O(rendered rows): hundreds of independent 1s pollers, each firing with
  // no inflight guard. Any backend slowdown (e.g. a minutes-long server-side solvency proof)
  // piled those requests up until Chrome refused sockets (net::ERR_INSUFFICIENT_RESOURCES).
  // One loop, next tick scheduled only after the previous fetch settles, paused while hidden.
  private clockSubs = new Set<(c: EpochClock) => void>();
  private clockLoopOn = false;
  private clockLoop = async () => {
    if (!this.clockSubs.size) { this.clockLoopOn = false; return; }
    if (!document.hidden) {
      const c = await this.getEpochClock(); // never throws (zero-shape fallback)
      this.clockSubs.forEach((cb) => cb(c));
    }
    setTimeout(this.clockLoop, 1000);
  };
  subscribeClock(cb: (c: EpochClock) => void): Unsubscribe {
    this.clockSubs.add(cb);
    if (!this.clockLoopOn) { this.clockLoopOn = true; void this.clockLoop(); }
    return () => { this.clockSubs.delete(cb); };
  }

  // ---- public reads (indexer; money normalized to bigint) ----
  async getLatestMonia(): Promise<MoniaPrint | null> { try { return mapPrint(await IndexerAPI.latestMonia()); } catch { return null; } }
  async getMoniaHistory(limit = 40): Promise<MoniaPrint[]> {
    try { return ((await IndexerAPI.moniaHistory(limit)) as any[]).map(mapPrint).filter(Boolean) as MoniaPrint[]; } catch { return []; }
  }
  async getDepthCurve(epoch?: EpochId): Promise<DepthPoint[]> { try { return mapDepth(await IndexerAPI.depth(epoch)); } catch { return []; } }
  async getMembers(): Promise<MemberInfo[]> { try { return (await IndexerAPI.members()) as MemberInfo[]; } catch { return []; } }
  async getLoanBook(filter?: { status?: LoanStatus }): Promise<Loan[]> {
    try {
      const l = ((await IndexerAPI.loans()) as any[]).map((x) => ({ ...x, status: x.status === 'None' ? 'Pending' : x.status })) as Loan[];
      return filter?.status ? l.filter((x) => x.status === filter.status) : l;
    } catch { return []; }
  }
  async getRawCiphertexts(epoch: EpochId): Promise<{ side: Side; tick: TickIndex; agg: Ciphertext }[]> {
    try { return (await IndexerAPI.aggregates(epoch)) as { side: Side; tick: TickIndex; agg: Ciphertext }[]; } catch { return []; }
  }

  // ---- session-scoped ----
  async getSession(): Promise<SessionState> {
    if (!this.actor) return { address: null, registered: false, persona: ['public'] };
    const bal = await ctrl(`/member/balance/${this.actor}`, undefined, 'GET').catch(() => ({ registered: false }));
    return { address: this.actor, registered: !!bal.registered, persona: ['public', 'lender', 'borrower'] };
  }
  async getBalances(a: Address): Promise<Balances> {
    const b = await ctrl(`/member/balance/${a}`, undefined, 'GET').catch(() => ({ usdc: '0', registered: false, eercClear: null, eercEncrypted: null }));
    return {
      usdcErc20: bi(b.usdc),
      registered: !!b.registered,
      eercEncrypted: b.eercEncrypted ?? LOCKED,
      eercClear: b.eercClear != null ? bi(b.eercClear) : undefined,
    };
  }
  async decryptOwnBalance(a: Address): Promise<UsdcMicro> {
    const b = await ctrl(`/member/balance/${a}`, undefined, 'GET');
    return b.eercClear != null ? bi(b.eercClear) : 0n;
  }
  async getMyBids(a: Address): Promise<MyBid[]> { try { return (await IndexerAPI.bids(a)) as MyBid[]; } catch { return []; } }
  async getMyLoans(a: Address): Promise<Loan[]> {
    const al = a.toLowerCase();
    return (await this.getLoanBook()).filter((l) => l.lender.toLowerCase() === al || l.borrower.toLowerCase() === al);
  }

  // ---- writes (Control API, real server-side proofs) ----
  private async tx(onP: OnProof | undefined, run: () => Promise<any>): Promise<TxResult> {
    onP?.({ phase: 'proving', label: 'proving (server-side)…' });
    try {
      const r = await run();
      onP?.({ phase: 'done', label: 'confirmed ✓', ms: r.proofMs });
      return { ok: true, txHash: r.txHash, proofMs: r.proofMs, gasUsed: r.gasUsed != null ? Number(r.gasUsed) : undefined };
    } catch (e) {
      const error = e instanceof Error ? e.message : 'failed';
      onP?.({ phase: 'error', label: error });
      return { ok: false, error };
    }
  }
  register(a: Address, onP?: OnProof) { return this.tx(onP, () => ctrl('/member/register', { address: a })); }
  faucet(a: Address, amt: UsdcMicro) { return this.tx(undefined, () => ctrl('/member/faucet', { address: a, amount: amt.toString() })); }
  wrap(a: Address, amt: UsdcMicro, onP?: OnProof) { return this.tx(onP, () => ctrl('/member/wrap', { address: a, amount: amt.toString() })); }
  unwrap(a: Address, amt: UsdcMicro, onP?: OnProof) { return this.tx(onP, () => ctrl('/member/unwrap', { address: a, amount: amt.toString() })); }
  // Bid sizes ride the auction scalar world (whole-USDC, BSGS-decryptable) — convert down from
  // the micro-USDC the UI uses so the on-chain scalar stays in range and matches the depth unit.
  submitAsk(a: Address, tick: TickIndex, size: UsdcMicro, onP?: OnProof) { return this.tx(onP, () => ctrl('/member/bid', { address: a, side: 0, tick, size: microToEercUnit(size) })); }
  submitBid(a: Address, tick: TickIndex, size: UsdcMicro, onP?: OnProof) { return this.tx(onP, () => ctrl('/member/bid', { address: a, side: 1, tick, size: microToEercUnit(size) })); }
  // Send the UI's real required collateral (micro-USDC) so the server's solvency proof reflects
  // the actual loan (control converts to the whole-USDC scalar the circuit needs). On the keyless
  // LIVE browser the plaintext loan size isn't available, so amt is 0 — omit it and let control
  // use its representative default rather than locking ZERO (the loan-value layer is auditor-
  // attested anyway; the real per-loan size isn't on-chain — cSize:zero). Mock sends the true amt.
  lockCollateral(id: LoanId, amt: UsdcMicro, onP?: OnProof) {
    const body = amt > 0n ? { loanId: Number(id), collMicro: amt.toString() } : { loanId: Number(id) };
    return this.tx(onP, () => ctrl('/member/lock', body));
  }
  fund(id: LoanId, onP?: OnProof) { return this.tx(onP, () => ctrl('/member/fund', { loanId: Number(id) })); }
  repay(id: LoanId, onP?: OnProof) { return this.tx(onP, () => ctrl('/member/repay', { loanId: Number(id) })); }

  // ---- keeper ----
  closeEpoch(_e: EpochId) { return this.tx(undefined, () => ctrl('/keeper/close', {})); }
  seize(id: LoanId) { return this.tx(undefined, () => ctrl('/keeper/seize', { loanId: Number(id) })); }

  // ---- admin (auditor key stays in services/control) ----
  // the auditor PUBLIC key, served by control /auditor (Diagnostics card)
  async auditorKey(): Promise<[string, string] | null> {
    try { const r = await ctrl('/auditor', undefined, 'GET'); return [String(r.x), String(r.y)]; } catch { return null; }
  }
  async adminDecryptAggregates(e: EpochId): Promise<DepthPoint[]> { return mapDepth((await ctrl(`/admin/decrypt/${e}`, undefined, 'GET')).depth); }
  async adminComputeClearing(e: EpochId): Promise<{ rStarBps: Bps | null; depth: DepthPoint[] }> {
    const c = await ctrl(`/admin/clearing/${e}`, undefined, 'GET');
    return { rStarBps: c.rStarBps ?? null, depth: await this.adminDecryptAggregates(e).catch(() => []) };
  }
  async adminPostPrint(e: EpochId, onP?: OnProof): Promise<TxResult & { print: MoniaPrint }> {
    onP?.({ phase: 'proving', label: 'admin proving 37-tick PoCD…' });
    const r = await ctrl(`/admin/print/${e}`, {});
    onP?.({ phase: 'done', label: 'M-ONIA printed', ms: r.proofMs });
    // synthesize from the Control response + decrypted depth (avoid racing the 3s indexer rebuild)
    let depth: DepthPoint[] = [];
    try { depth = await this.adminDecryptAggregates(e); } catch { /* attested */ }
    const print: MoniaPrint = {
      epoch: e,
      rStarBps: r.rStarBps ?? null,
      aggVolume: eercToMicro(r.matched),
      depth,
      pocd: { verified: true, proveMs: r.proofMs },
      printedAt: Date.now(),
      stale: r.trade === false,
    };
    return { ok: true, proofMs: r.proofMs, txHash: r.txHash, print };
  }
  async adminPostMatches(e: EpochId): Promise<TxResult & { loans: Loan[] }> {
    await ctrl(`/admin/matches/${e}`, {});
    return { ok: true, loans: (await this.getLoanBook()).filter((l) => l.epoch === e) };
  }

  // ---- firehose (poll indexer /events, map to WindowEvents, buffer for the Explorer) ----
  private mapEvent(e: any): WindowEvent | null {
    // every on-chain event carries the Fuji tx hash + block for Snowtrace linking
    const meta = { txHash: e.txHash as (`0x${string}` | undefined), block: e.block as (number | undefined) };
    switch (e.type) {
      case 'BidSubmitted':
        return { type: 'BidSubmitted', side: (e.side === 'ask' ? 'ask' : 'bid') as Side, tick: Number(e.tick), by: e.who, simulated: true, cipher: LOCKED, ...meta };
      case 'EpochOpened': return { type: 'EpochOpened', epoch: Number(e.epoch ?? 0), ...meta };
      case 'EpochClosed': return { type: 'EpochClosed', epoch: Number(e.epoch ?? 0), ...meta };
      case 'RatePrinted': { const p = mapPrint(e.print); return p ? { type: 'RatePrinted', print: p, ...meta } : null; }
      case 'LoanCreated': return { type: 'MatchesPosted', epoch: Number(e.epoch ?? 0), count: 1, ...meta };
      case 'Funded': return { type: 'LoanFunded', loanId: String(e.loanId), ...meta };
      case 'Repaid': return { type: 'LoanRepaid', loanId: String(e.loanId), ...meta };
      case 'Seized':
      case 'CollateralSeized': return { type: 'LoanSeized', loanId: String(e.loanId), ...meta };
      default: return null; // NoTrade / CollateralLocked / Released — reflected via reads
    }
  }
  // Multicast for the same reasons as the clock — and it also fixes a fairness bug: with a
  // fetch loop PER subscriber, each advanced the shared lastBlock cursor independently, so
  // events were split between subscribers instead of every subscriber seeing every event.
  private eventSubs = new Set<(e: WindowEvent) => void>();
  private eventLoopOn = false;
  private eventLoop = async () => {
    if (!this.eventSubs.size) { this.eventLoopOn = false; return; }
    if (!document.hidden) {
      try {
        const evs = (await IndexerAPI.events(this.lastBlock)) as any[];
        for (const e of evs) {
          this.lastBlock = Math.max(this.lastBlock, (e.block ?? 0) + 1);
          const w = this.mapEvent(e);
          if (!w) continue;
          this.buffer.push(w);
          if (this.buffer.length > 60) this.buffer.shift();
          this.eventSubs.forEach((cb) => cb(w));
        }
      } catch { /* indexer down — next tick retries */ }
    }
    setTimeout(this.eventLoop, 2000);
  };
  subscribe(cb: (e: WindowEvent) => void): Unsubscribe {
    this.eventSubs.add(cb);
    if (!this.eventLoopOn) { this.eventLoopOn = true; void this.eventLoop(); }
    return () => { this.eventSubs.delete(cb); };
  }
  recentEvents(): WindowEvent[] { return this.buffer.slice(); }
}
