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

async function ctrl(path: string, body?: unknown, method: 'POST' | 'GET' = 'POST'): Promise<any> {
  const res = await fetch(`${CONTROL_URL}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({ ok: false, error: `control ${res.status}` }));
  if (!json.ok) throw new Error(json.error || `control ${path} failed`);
  return json;
}

export class LiveAdapter implements WindowAdapter {
  readonly mode = 'live' as const;
  private profile: Profile = PROFILE;
  private actor: Address | null = null; // the selected/connected member address

  async init(): Promise<void> {
    try { await fetch(`${INDEXER_URL}/health`); } catch { /* graceful-empty until up */ }
  }

  /** Called by useControlBridge to reflect the connected wallet / selected persona. */
  setActor(a: Address | null) { this.actor = a ? (a.toLowerCase() as Address) : null; }

  getProfile() { return this.profile; }
  setProfile(p: Profile) { this.profile = p; }

  // ---- clock ----
  async getEpochClock(): Promise<EpochClock> {
    try { return (await IndexerAPI.epochClock()) as EpochClock; }
    catch { return { epoch: 0, status: 'Open', profile: this.profile, openedAt: 0, closesAt: 0, epochLenMs: 0, tenorMs: 0, now: 0 }; }
  }
  subscribeClock(cb: (c: EpochClock) => void): Unsubscribe {
    const id = setInterval(() => { void this.getEpochClock().then(cb); }, 1000);
    return () => clearInterval(id);
  }

  // ---- public reads (indexer) ----
  async getLatestMonia(): Promise<MoniaPrint | null> { try { return (await IndexerAPI.latestMonia()) as MoniaPrint; } catch { return null; } }
  async getMoniaHistory(limit = 40): Promise<MoniaPrint[]> { try { return (await IndexerAPI.moniaHistory(limit)) as MoniaPrint[]; } catch { return []; } }
  async getDepthCurve(epoch?: EpochId): Promise<DepthPoint[]> { try { return (await IndexerAPI.depth(epoch)) as DepthPoint[]; } catch { return []; } }
  async getMembers(): Promise<MemberInfo[]> { try { return (await IndexerAPI.members()) as MemberInfo[]; } catch { return []; } }
  async getLoanBook(filter?: { status?: LoanStatus }): Promise<Loan[]> {
    try { const l = (await IndexerAPI.loans()) as Loan[]; return filter?.status ? l.filter((x) => x.status === filter.status) : l; }
    catch { return []; }
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
      usdcErc20: BigInt(b.usdc ?? '0'),
      registered: !!b.registered,
      eercEncrypted: b.eercEncrypted ?? LOCKED,
      eercClear: b.eercClear != null ? BigInt(b.eercClear) : undefined,
    };
  }
  async decryptOwnBalance(a: Address): Promise<UsdcMicro> {
    const b = await ctrl(`/member/balance/${a}`, undefined, 'GET');
    return b.eercClear != null ? BigInt(b.eercClear) : 0n;
  }
  async getMyBids(a: Address): Promise<MyBid[]> { try { return (await IndexerAPI.bids(a)) as MyBid[]; } catch { return []; } }
  async getMyLoans(a: Address): Promise<Loan[]> {
    const al = a.toLowerCase();
    return (await this.getLoanBook()).filter((l) => l.lender.toLowerCase() === al || l.borrower.toLowerCase() === al);
  }

  // ---- writes (Control API, real server-side proofs) ----
  private async tx(onP: OnProof | undefined, run: () => Promise<any>): Promise<TxResult> {
    onP?.({ phase: 'proving', label: 'proving (server-side)…' });
    const r = await run();
    onP?.({ phase: 'done', label: 'done' });
    return { ok: true, txHash: r.txHash, proofMs: r.proofMs, gasUsed: r.gasUsed };
  }
  register(a: Address, onP?: OnProof) { return this.tx(onP, () => ctrl('/member/register', { address: a })); }
  faucet(a: Address, amt: UsdcMicro) { return this.tx(undefined, () => ctrl('/member/faucet', { address: a, amount: amt.toString() })); }
  wrap(a: Address, amt: UsdcMicro, onP?: OnProof) { return this.tx(onP, () => ctrl('/member/wrap', { address: a, amount: amt.toString() })); }
  unwrap(a: Address, amt: UsdcMicro, onP?: OnProof) { return this.tx(onP, () => ctrl('/member/unwrap', { address: a, amount: amt.toString() })); }
  submitAsk(a: Address, tick: TickIndex, size: UsdcMicro, onP?: OnProof) { return this.tx(onP, () => ctrl('/member/bid', { address: a, side: 0, tick, size: size.toString() })); }
  submitBid(a: Address, tick: TickIndex, size: UsdcMicro, onP?: OnProof) { return this.tx(onP, () => ctrl('/member/bid', { address: a, side: 1, tick, size: size.toString() })); }
  lockCollateral(id: LoanId, _amt: UsdcMicro, onP?: OnProof) { return this.tx(onP, () => ctrl('/member/lock', { loanId: Number(id) })); }
  fund(id: LoanId, onP?: OnProof) { return this.tx(onP, () => ctrl('/member/fund', { loanId: Number(id) })); }
  repay(id: LoanId, onP?: OnProof) { return this.tx(onP, () => ctrl('/member/repay', { loanId: Number(id) })); }

  // ---- keeper ----
  closeEpoch(_e: EpochId) { return this.tx(undefined, () => ctrl('/keeper/close', {})); }
  seize(id: LoanId) { return this.tx(undefined, () => ctrl('/keeper/seize', { loanId: Number(id) })); }

  // ---- admin (auditor key stays in services/control) ----
  async adminDecryptAggregates(e: EpochId): Promise<DepthPoint[]> { return (await ctrl(`/admin/decrypt/${e}`, undefined, 'GET')).depth; }
  async adminComputeClearing(e: EpochId): Promise<{ rStarBps: Bps | null; depth: DepthPoint[] }> {
    const c = await ctrl(`/admin/clearing/${e}`, undefined, 'GET');
    return { rStarBps: c.rStarBps, depth: await this.getDepthCurve(e) };
  }
  async adminPostPrint(e: EpochId, onP?: OnProof): Promise<TxResult & { print: MoniaPrint }> {
    onP?.({ phase: 'proving', label: 'admin proving 37-tick PoCD…' });
    const r = await ctrl(`/admin/print/${e}`, {});
    onP?.({ phase: 'done', label: 'M-ONIA printed' });
    const print = (await this.getLatestMonia()) as MoniaPrint;
    return { ok: true, proofMs: r.proofMs, print };
  }
  async adminPostMatches(e: EpochId): Promise<TxResult & { loans: Loan[] }> {
    await ctrl(`/admin/matches/${e}`, {});
    return { ok: true, loans: await this.getLoanBook() };
  }

  // ---- firehose (poll indexer /events) ----
  private lastBlock = 0;
  subscribe(cb: (e: WindowEvent) => void): Unsubscribe {
    const id = setInterval(async () => {
      try {
        const evs = await IndexerAPI.events(this.lastBlock);
        for (const e of evs as any[]) {
          this.lastBlock = Math.max(this.lastBlock, (e.block ?? 0) + 1);
          if (e.type === 'RatePrinted') cb({ type: 'RatePrinted', print: e.print });
          else if (e.type === 'Funded') cb({ type: 'LoanFunded', loanId: e.loanId });
          else cb({ type: 'clock', clock: await this.getEpochClock() } as WindowEvent);
        }
      } catch { /* indexer down */ }
    }, 2000);
    return () => clearInterval(id);
  }
  recentEvents(): WindowEvent[] { return []; }
}
