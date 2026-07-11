import type { WindowAdapter, DemoControls } from '../WindowAdapter';
import type {
  Address,
  Balances,
  Bps,
  Ciphertext,
  DepthPoint,
  EpochClock,
  EpochId,
  Loan,
  LoanId,
  LoanStatus,
  MoniaPrint,
  OnProof,
  Profile,
  Side,
  SessionState,
  TickIndex,
  TxResult,
  UsdcMicro,
  WindowEvent,
} from '../types';
import { PROFILE } from '../../../config';
import { DemoEngine } from './engine';
import { DEFAULT_SCENARIO, scenarioByName } from './scenarios';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Simulate honest proof-gen latency, surfacing phases through onProof. Returns total ms. */
async function simulateProof(
  onP: OnProof | undefined,
  opts: { witnessMs?: number; proveMs?: number; verify?: boolean; verifyLabel?: string } = {},
): Promise<number> {
  const { witnessMs = 300, proveMs = 1200, verify = false, verifyLabel = 'verifying PoCD…' } = opts;
  const t0 = performance.now();
  onP?.({ phase: 'building-witness', label: 'building witness…' });
  await sleep(witnessMs);
  onP?.({ phase: 'proving', label: 'generating proof…' });
  await sleep(proveMs);
  if (verify) {
    onP?.({ phase: 'verifying', label: verifyLabel });
    await sleep(500);
  }
  const ms = Math.round(performance.now() - t0);
  onP?.({ phase: 'done', label: verify ? 'verified ✓' : 'confirmed ✓', ms });
  return ms;
}

export class MockAdapter implements WindowAdapter, DemoControls {
  readonly mode = 'mock' as const;
  private engine: DemoEngine;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastPerf = 0;
  private activeAddress: Address | null = null;

  constructor() {
    this.engine = new DemoEngine(PROFILE);
  }

  async init() {
    await this.engine.init(DEFAULT_SCENARIO.params, DEFAULT_SCENARIO.name);
    this.lastPerf = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      const delta = now - this.lastPerf;
      this.lastPerf = now;
      this.engine.tick(delta);
    }, 120);
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ---------- clock / profile ----------
  getProfile(): Profile {
    return this.engine.getProfile();
  }
  setProfile(p: Profile) {
    this.engine.setProfile(p);
  }
  async getEpochClock() {
    return this.engine.getEpochClock();
  }
  subscribeClock(cb: (c: EpochClock) => void) {
    return this.engine.subscribeClock(cb);
  }

  // ---------- public reads ----------
  async getLatestMonia() {
    return this.engine.getLatestMonia();
  }
  async getMoniaHistory(limit?: number) {
    return this.engine.getMoniaHistory(limit);
  }
  async getDepthCurve(epoch?: EpochId) {
    return this.engine.getDepthCurve(epoch);
  }
  async getMembers() {
    return this.engine.getMembers();
  }
  async getLoanBook(filter?: { status?: LoanStatus }) {
    return this.engine.getLoanBook(filter);
  }
  async getRawCiphertexts(epoch: EpochId): Promise<{ side: Side; tick: TickIndex; agg: Ciphertext }[]> {
    return this.engine.getRawCiphertexts(epoch);
  }

  // ---------- session-scoped ----------
  setActiveAddress(a: Address | null) {
    this.activeAddress = a;
  }
  async getSession(): Promise<SessionState> {
    const address = this.activeAddress;
    if (!address) return { address: null, registered: false, persona: ['public'] };
    return { address, registered: this.engine.isRegistered(address), persona: ['lender', 'borrower'] };
  }
  async getBalances(a: Address): Promise<Balances> {
    return this.engine.getBalances(a);
  }
  async decryptOwnBalance(a: Address): Promise<UsdcMicro> {
    await sleep(250); // client-side self-decrypt (BSGS) — small honest delay
    return this.engine.decryptOwnBalance(a);
  }
  async getMyBids(a: Address) {
    return this.engine.getMyBids(a);
  }
  async getMyLoans(a: Address) {
    return this.engine.getMyLoans(a);
  }

  // ---------- member writes ----------
  async register(a: Address, onP?: OnProof): Promise<TxResult> {
    this.setActiveAddress(a);
    const ms = await simulateProof(onP, { witnessMs: 400, proveMs: 1400 });
    this.engine.setRegistered(a, this.engine.auditorPublicKey());
    return { ok: true, proofMs: ms, txHash: this.hash(a, 'reg') };
  }
  async faucet(a: Address, amt: UsdcMicro): Promise<TxResult> {
    await sleep(300);
    this.engine.mintFaucet(a, amt);
    return { ok: true, txHash: this.hash(a, 'faucet') };
  }
  async wrap(a: Address, amt: UsdcMicro): Promise<TxResult> {
    await sleep(500); // deposit needs no ZK proof — just a tx
    try {
      this.engine.wrap(a, amt);
      return { ok: true, txHash: this.hash(a, 'wrap') };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
  async unwrap(a: Address, amt: UsdcMicro, onP?: OnProof): Promise<TxResult> {
    const ms = await simulateProof(onP, { witnessMs: 400, proveMs: 1600 });
    try {
      this.engine.unwrap(a, amt);
      return { ok: true, proofMs: ms, txHash: this.hash(a, 'unwrap') };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
  async submitAsk(a: Address, tick: TickIndex, size: UsdcMicro, onP?: OnProof): Promise<TxResult> {
    return this.submit(a, 'ask', tick, size, onP);
  }
  async submitBid(a: Address, tick: TickIndex, size: UsdcMicro, onP?: OnProof): Promise<TxResult> {
    return this.submit(a, 'bid', tick, size, onP);
  }
  private async submit(a: Address, side: Side, tick: TickIndex, size: UsdcMicro, onP?: OnProof): Promise<TxResult> {
    this.setActiveAddress(a);
    const ms = await simulateProof(onP, { witnessMs: 350, proveMs: 900 });
    this.engine.addUserBid(a, side, tick, size);
    return { ok: true, proofMs: ms, txHash: this.hash(a, `${side}${tick}`) };
  }
  async lockCollateral(id: LoanId, amt: UsdcMicro, onP?: OnProof): Promise<TxResult> {
    const ms = await simulateProof(onP, { witnessMs: 600, proveMs: 2000, verify: true, verifyLabel: 'verifying solvency proof…' });
    this.engine.userCollateralize(id, amt);
    return { ok: true, proofMs: ms, txHash: this.hash(id, 'coll') };
  }
  async fund(id: LoanId, onP?: OnProof): Promise<TxResult> {
    const ms = await simulateProof(onP, { witnessMs: 400, proveMs: 1500 });
    this.engine.userFund(id);
    return { ok: true, proofMs: ms, txHash: this.hash(id, 'fund') };
  }
  async repay(id: LoanId, onP?: OnProof): Promise<TxResult> {
    const ms = await simulateProof(onP, { witnessMs: 400, proveMs: 1500 });
    this.engine.userRepay(id);
    return { ok: true, proofMs: ms, txHash: this.hash(id, 'repay') };
  }

  // ---------- keeper ----------
  async closeEpoch(e: EpochId): Promise<TxResult> {
    const plan = this.engine.planFor(e);
    if (plan) this.engine.seek(plan.closeAt + 1);
    return { ok: true, txHash: this.hash(String(e), 'close') };
  }
  async seize(id: LoanId): Promise<TxResult> {
    const loan = this.engine.findLoan(id);
    if (loan && loan.status === 'Active') {
      loan.status = 'Defaulted';
    }
    return { ok: true, txHash: this.hash(id, 'seize') };
  }

  // ---------- admin ----------
  async adminDecryptAggregates(e: EpochId): Promise<DepthPoint[]> {
    await sleep(500);
    return this.engine.adminDepth(e);
  }
  async adminComputeClearing(e: EpochId): Promise<{ rStarBps: Bps | null; depth: DepthPoint[] }> {
    return this.engine.adminClearing(e);
  }
  async adminPostPrint(e: EpochId, onP?: OnProof): Promise<TxResult & { print: MoniaPrint }> {
    const ms = await simulateProof(onP, { witnessMs: 700, proveMs: 1800, verify: true });
    const plan = this.engine.planFor(e);
    if (plan) this.engine.seek(plan.printAt + 1);
    const print = this.engine.getMoniaHistory().find((p) => p.epoch === e) ?? this.engine.getLatestMonia()!;
    return { ok: true, proofMs: ms, gasUsed: 266_000, txHash: this.hash(String(e), 'print'), print };
  }
  async adminPostMatches(e: EpochId): Promise<TxResult & { loans: Loan[] }> {
    await sleep(600);
    const plan = this.engine.planFor(e);
    if (plan) this.engine.seek(plan.matchAt + 1);
    const loans = this.engine.getLoanBook().filter((l) => l.epoch === e);
    return { ok: true, txHash: this.hash(String(e), 'match'), loans };
  }

  // ---------- firehose ----------
  subscribe(cb: (e: WindowEvent) => void) {
    return this.engine.subscribe(cb);
  }
  recentEvents(): WindowEvent[] {
    return this.engine.recentLog();
  }

  // ---------- demo controls ----------
  play() {
    this.engine.paused = false;
    this.lastPerf = performance.now();
  }
  pause() {
    this.engine.paused = true;
  }
  setSpeed(mult: number) {
    this.engine.speed = mult;
  }
  seek(ms: number) {
    this.engine.seek(ms);
  }
  reseed(seed: number) {
    const s = scenarioByName(this.engine.getScenario());
    this.engine.load({ ...s.params, seed }, s.name);
  }
  loadScenario(name: string) {
    const s = scenarioByName(name);
    this.engine.load(s.params, name);
    this.play();
  }
  stepEpoch() {
    this.engine.seek(this.engine.now + this.engine.getEpochClock().epochLenMs);
  }

  // expose read-through of the recent event log + auditor key for Explorer/Diagnostics
  recentLog(): WindowEvent[] {
    return this.engine.recentLog();
  }
  auditorKey(): [string, string] {
    return this.engine.auditorPublicKey();
  }
  now(): number {
    return this.engine.now;
  }
  isPaused(): boolean {
    return this.engine.paused;
  }
  speedValue(): number {
    return this.engine.speed;
  }
  scenario(): string {
    return this.engine.getScenario();
  }

  private hash(seed: string, tag: string): `0x${string}` {
    let h = 2166136261;
    const s = seed + tag;
    for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    const hex = (h >>> 0).toString(16).padStart(8, '0');
    return (`0x${hex.repeat(8)}`) as `0x${string}`;
  }
}
