// DemoEngine — the deterministic heart of the simulation.
//
// A seeded, virtual-clock event timeline drives a full scripted market: agents bid →
// epoch closes → M-ONIA prints with a PoCD → matches → loans cycle borrow→repay→release,
// with occasional defaults→seize. Everything is a pure function of (seed, scenario), so
// every playthrough — and every scrub/replay — is identical. No Date.now / Math.random
// in domain logic.
import type {
  Address,
  Balances,
  Bps,
  Ciphertext,
  DepthPoint,
  EpochClock,
  EpochId,
  EpochStatus,
  Loan,
  LoanId,
  LoanStatus,
  MemberInfo,
  MoniaPrint,
  MyBid,
  Profile,
  Side,
  TickIndex,
  UsdcMicro,
  WindowEvent,
} from '../types';
import { HAIRCUT_BPS, TIME_PROFILES } from '../../../config';
import { selectCrossing, tickToBps } from '../../rates';
import { requiredCollateral } from '../../usdc';
import { Rng, epochSeed } from './rng';
import { generateBids, type SimBid } from './strategies';
import { SIM_MEMBERS, SIM_ADMIN, SIM_KEEPER, memberLabel } from './members';
import { buildElgamal, type Elgamal } from './elgamal.browser';

/* eslint-disable @typescript-eslint/no-explicit-any */
type EGCT = { c1: [any, any]; c2: [any, any] };

// ---- sim timings (watchable; the dashboard is a disclosed simulation) ----
// Derived from the single config table so the mock clock and every UI label stay in lockstep.
interface SimTiming {
  epochLenMs: number;
  tenorMs: number;
}
const TIMINGS: Record<Profile, SimTiming> = {
  DEMO: { epochLenMs: TIME_PROFILES.DEMO.epochLenMs, tenorMs: TIME_PROFILES.DEMO.tenorMs },
  PROD: { epochLenMs: TIME_PROFILES.PROD.epochLenMs, tenorMs: TIME_PROFILES.PROD.tenorMs },
};
const PH = { bidsFrom: 0.06, bidsTo: 0.72, close: 0.8, print: 0.88, match: 0.93 };

export interface ScenarioParams {
  seed: number;
  defaultRate: number; // probability a matched loan defaults
  forceSeizeEpoch?: number; // force a default→seize on this epoch's loan
  noTradeEpoch?: number; // force a "no trade" print on this epoch
}

interface PlannedLoan {
  id: LoanId;
  epoch: EpochId;
  lender: Address;
  borrower: Address;
  rateBps: Bps;
  sizeMicro: UsdcMicro;
  collateralMicro: UsdcMicro;
  outcome: 'repay' | 'default';
  collateralizeAt: number;
  fundAt: number;
  deadlineAt: number;
  settleAt: number;
}

interface EpochPlan {
  epoch: EpochId;
  openAt: number;
  closeAt: number;
  printAt: number;
  matchAt: number;
  bids: SimBid[];
  depthClear: DepthPoint[];
  rStarBps: Bps | null;
  aggVolume: UsdcMicro;
  loans: PlannedLoan[];
  stale: boolean;
}

type Action =
  | { k: 'open'; epoch: EpochId }
  | { k: 'bid'; epoch: EpochId; bid: SimBid }
  | { k: 'close'; epoch: EpochId }
  | { k: 'print'; epoch: EpochId }
  | { k: 'match'; epoch: EpochId }
  | { k: 'collateralize'; loan: PlannedLoan }
  | { k: 'fund'; loan: PlannedLoan }
  | { k: 'settle'; loan: PlannedLoan };

interface TEvent {
  at: number;
  seq: number;
  action: Action;
}

interface EpochRecord {
  epoch: EpochId;
  status: EpochStatus;
  openedAt: number;
  closesAt: number;
  aggClear: { ask: Map<TickIndex, UsdcMicro>; bid: Map<TickIndex, UsdcMicro> };
  aggCipher: { ask: Map<TickIndex, EGCT>; bid: Map<TickIndex, EGCT> };
}

interface UserState {
  usdcErc20: UsdcMicro;
  eercClear: UsdcMicro;
  registered: boolean;
  bjjPub?: [string, string];
  bids: MyBid[];
}

interface World {
  epochs: Map<EpochId, EpochRecord>;
  currentEpoch: EpochId;
  prints: MoniaPrint[];
  loans: Map<LoanId, Loan>;
  loanClear: Map<LoanId, PlannedLoan>;
  log: WindowEvent[];
  users: Map<string, UserState>;
}

const LOG_CAP = 60;
const usdcWhole = (micro: UsdcMicro): bigint => micro / 1_000000n; // for bounded bsgs / ciphertext value

export class DemoEngine {
  private el!: Elgamal;
  private auditorPriv = 0n;
  private auditorPub: [any, any] = [0, 0];
  private auditorPubStr: [string, string] = ['0', '0'];

  private profile: Profile;
  private timing: SimTiming;
  private params: ScenarioParams = { seed: 1, defaultRate: 0.15 };
  private scenarioName = 'happy-path';

  private plans: EpochPlan[] = [];
  private timeline: TEvent[] = [];
  private fired = 0;
  private seq = 0;

  private world: World = DemoEngine.freshWorld();
  now = 0;
  speed = 1;
  paused = false;

  private clockSubs = new Set<(c: EpochClock) => void>();
  private eventSubs = new Set<(e: WindowEvent) => void>();

  constructor(profile: Profile) {
    this.profile = profile;
    this.timing = TIMINGS[profile];
  }

  static freshWorld(): World {
    return {
      epochs: new Map(),
      currentEpoch: 0,
      prints: [],
      loans: new Map(),
      loanClear: new Map(),
      log: [],
      users: new Map(),
    };
  }

  async init(scenario: ScenarioParams, name: string) {
    this.el = await buildElgamal();
    // deterministic auditor keypair
    this.auditorPriv = 2748579834902348905823409582340958234n;
    const kp = this.el.keypair(this.auditorPriv);
    this.auditorPub = kp.pub;
    this.auditorPubStr = this.el.pubToStrings(kp.pub);
    this.load(scenario, name);
  }

  load(scenario: ScenarioParams, name: string) {
    this.params = scenario;
    this.scenarioName = name;
    this.plans = [];
    this.timeline = [];
    this.seq = 0;
    this.rebuildTo(0);
  }

  getProfile(): Profile {
    return this.profile;
  }
  setProfile(p: Profile) {
    this.profile = p;
    this.timing = TIMINGS[p];
    this.load(this.params, this.scenarioName);
  }
  getScenario() {
    return this.scenarioName;
  }
  auditorPublicKey(): [string, string] {
    return this.auditorPubStr;
  }

  // ---------- planning ----------
  private ensureHorizon(untilMs: number) {
    const need = untilMs + 2 * this.timing.epochLenMs;
    while (this.plans.length === 0 || this.plans[this.plans.length - 1].openAt < need) {
      this.planEpoch(this.plans.length);
    }
  }

  private planEpoch(epoch: EpochId) {
    const rng = new Rng(epochSeed(this.params.seed, epoch));
    const openAt = epoch * this.timing.epochLenMs;
    const L = this.timing.epochLenMs;
    const closeAt = openAt + PH.close * L;
    const printAt = openAt + PH.print * L;
    const matchAt = openAt + PH.match * L;

    const bids = generateBids(rng, epoch);

    // per-tick clear aggregates
    const ask = new Map<TickIndex, UsdcMicro>();
    const bid = new Map<TickIndex, UsdcMicro>();
    for (const b of bids) {
      const m = b.side === 'ask' ? ask : bid;
      m.set(b.tick, (m.get(b.tick) ?? 0n) + b.sizeMicro);
    }
    const depthClear: DepthPoint[] = [];
    const ticks = new Set<TickIndex>([...ask.keys(), ...bid.keys()]);
    for (const t of ticks) {
      depthClear.push({ tick: t, bps: tickToBps(t), supply: ask.get(t) ?? 0n, demand: bid.get(t) ?? 0n });
    }

    const forcedNoTrade = this.params.noTradeEpoch === epoch;
    const crossing = forcedNoTrade ? { rStarTick: null, rStarBps: null, clearedVolume: 0n } : selectCrossing(depthClear);

    // loans from the crossing
    const loans: PlannedLoan[] = [];
    if (crossing.rStarTick !== null && crossing.clearedVolume > 0n) {
      const lenders = bids.filter((b) => b.side === 'ask' && b.tick <= crossing.rStarTick!);
      const borrowers = bids.filter((b) => b.side === 'bid' && b.tick >= crossing.rStarTick!);
      const n = Math.min(lenders.length, borrowers.length, 2);
      for (let i = 0; i < n; i++) {
        const lender = lenders[i].bidder;
        const borrower = borrowers[i].bidder;
        const sizeMicro = lenders[i].sizeMicro < borrowers[i].sizeMicro ? lenders[i].sizeMicro : borrowers[i].sizeMicro;
        const collateralMicro = requiredCollateral(sizeMicro, HAIRCUT_BPS) + BigInt(rng.int(0, 400)) * 1_000000n;
        const forcedSeize = this.params.forceSeizeEpoch === epoch && i === 0;
        const outcome: 'repay' | 'default' = forcedSeize ? 'default' : rng.bool(this.params.defaultRate) ? 'default' : 'repay';
        const collateralizeAt = matchAt + 0.01 * L;
        const fundAt = collateralizeAt + 0.015 * L;
        const deadlineAt = fundAt + this.timing.tenorMs;
        const settleAt = outcome === 'repay' ? deadlineAt - 0.18 * this.timing.tenorMs : deadlineAt + 0.06 * this.timing.tenorMs;
        loans.push({
          id: `L${epoch}-${i}`,
          epoch,
          lender,
          borrower,
          rateBps: crossing.rStarBps!,
          sizeMicro,
          collateralMicro,
          outcome,
          collateralizeAt,
          fundAt,
          deadlineAt,
          settleAt,
        });
      }
    }

    const plan: EpochPlan = {
      epoch,
      openAt,
      closeAt,
      printAt,
      matchAt,
      bids,
      depthClear,
      rStarBps: crossing.rStarBps,
      aggVolume: crossing.clearedVolume,
      loans,
      stale: crossing.rStarBps === null,
    };
    this.plans.push(plan);
    this.addEvents(plan);
  }

  private addEvents(plan: EpochPlan) {
    const L = this.timing.epochLenMs;
    const push = (at: number, action: Action) => this.timeline.push({ at, seq: this.seq++, action });
    push(plan.openAt, { k: 'open', epoch: plan.epoch });
    const span = PH.bidsTo - PH.bidsFrom;
    plan.bids.forEach((b, i) => {
      const frac = PH.bidsFrom + (span * (i + 1)) / (plan.bids.length + 1);
      push(plan.openAt + frac * L, { k: 'bid', epoch: plan.epoch, bid: b });
    });
    push(plan.closeAt, { k: 'close', epoch: plan.epoch });
    push(plan.printAt, { k: 'print', epoch: plan.epoch });
    push(plan.matchAt, { k: 'match', epoch: plan.epoch });
    for (const loan of plan.loans) {
      push(loan.collateralizeAt, { k: 'collateralize', loan });
      push(loan.fundAt, { k: 'fund', loan });
      push(loan.settleAt, { k: 'settle', loan });
    }
    this.timeline.sort((a, b) => a.at - b.at || a.seq - b.seq);
  }

  // ---------- clock + stepping ----------
  private clock(): EpochClock {
    const rec = this.world.epochs.get(this.world.currentEpoch);
    const openedAt = rec?.openedAt ?? 0;
    return {
      epoch: this.world.currentEpoch,
      status: rec?.status ?? 'Open',
      profile: this.profile,
      openedAt,
      closesAt: openedAt + PH.close * this.timing.epochLenMs,
      epochLenMs: this.timing.epochLenMs,
      tenorMs: this.timing.tenorMs,
      now: this.now,
    };
  }

  tick(realDeltaMs: number) {
    if (this.paused) return;
    this.advance(this.now + realDeltaMs * this.speed);
  }

  private advance(target: number) {
    this.now = target;
    this.ensureHorizon(target);
    // re-sort defensively in case horizon extended
    while (this.fired < this.timeline.length && this.timeline[this.fired].at <= this.now) {
      this.apply(this.timeline[this.fired].action, true);
      this.fired++;
    }
    this.emitClock();
  }

  seek(targetMs: number) {
    const t = Math.max(0, targetMs);
    if (t < this.now) {
      this.rebuildTo(t);
    } else {
      this.advance(t);
    }
    this.emitClock();
  }

  private rebuildTo(t: number) {
    // preserve any connected users' identity (registration/balance) across scrub
    const preservedUsers = this.world.users;
    this.world = DemoEngine.freshWorld();
    this.world.users = preservedUsers;
    // reset user bids (they belong to epochs we're replaying)
    for (const u of this.world.users.values()) u.bids = [];
    this.fired = 0;
    this.now = t;
    this.ensureHorizon(t);
    while (this.fired < this.timeline.length && this.timeline[this.fired].at <= t) {
      this.apply(this.timeline[this.fired].action, false);
      this.fired++;
    }
  }

  // ---------- apply ----------
  private log(e: WindowEvent, emit: boolean) {
    this.world.log.push(e);
    if (this.world.log.length > LOG_CAP) this.world.log.shift();
    if (emit) for (const cb of this.eventSubs) cb(e);
  }

  private encBid(b: SimBid): EGCT {
    return this.el.encrypt(this.auditorPub, usdcWhole(b.sizeMicro), b.r);
  }

  private apply(action: Action, emit: boolean) {
    const w = this.world;
    switch (action.k) {
      case 'open': {
        const openedAt = action.epoch * this.timing.epochLenMs;
        w.epochs.set(action.epoch, {
          epoch: action.epoch,
          status: 'Open',
          openedAt,
          closesAt: openedAt + PH.close * this.timing.epochLenMs,
          aggClear: { ask: new Map(), bid: new Map() },
          aggCipher: { ask: new Map(), bid: new Map() },
        });
        w.currentEpoch = action.epoch;
        break;
      }
      case 'bid': {
        const rec = w.epochs.get(action.epoch);
        if (!rec) break;
        const { side, tick } = action.bid;
        const clear = side === 'ask' ? rec.aggClear.ask : rec.aggClear.bid;
        const ciph = side === 'ask' ? rec.aggCipher.ask : rec.aggCipher.bid;
        clear.set(tick, (clear.get(tick) ?? 0n) + action.bid.sizeMicro);
        const c = this.encBid(action.bid);
        const prev = ciph.get(tick);
        ciph.set(tick, prev ? this.el.addCipher(prev, c) : c);
        this.log(
          { type: 'BidSubmitted', side, tick, by: action.bid.bidder, simulated: true, cipher: this.strCipher(c) },
          emit,
        );
        break;
      }
      case 'close': {
        const rec = w.epochs.get(action.epoch);
        if (rec) rec.status = 'Closed';
        this.log({ type: 'EpochClosed', epoch: action.epoch }, emit);
        break;
      }
      case 'print': {
        const plan = this.plans[action.epoch];
        const rec = w.epochs.get(action.epoch);
        if (!plan || !rec) break;
        rec.status = 'Printed';
        const rng = new Rng(epochSeed(this.params.seed, action.epoch) ^ 0x50c2);
        const noTrade = plan.rStarBps === null;
        const carried = noTrade ? w.prints[w.prints.length - 1]?.rStarBps ?? null : plan.rStarBps;
        const print: MoniaPrint = {
          epoch: action.epoch,
          rStarBps: carried,
          aggVolume: plan.aggVolume,
          depth: plan.depthClear.map((d) => ({ ...d })),
          pocd: { verified: true, gasUsed: 266_000, proveMs: rng.int(1400, 2600), txHash: this.fakeHash(action.epoch) },
          printedAt: plan.printAt,
          stale: noTrade,
        };
        w.prints.push(print);
        this.log({ type: 'RatePrinted', print }, emit);
        break;
      }
      case 'match': {
        const plan = this.plans[action.epoch];
        if (!plan) break;
        for (const pl of plan.loans) {
          w.loanClear.set(pl.id, pl);
          w.loans.set(pl.id, this.toLoan(pl, 'Pending'));
        }
        this.log({ type: 'MatchesPosted', epoch: action.epoch, count: plan.loans.length }, emit);
        break;
      }
      case 'collateralize': {
        const loan = w.loans.get(action.loan.id);
        if (loan && loan.status === 'Pending' && !loan.collateral) loan.collateral = this.encMicro(action.loan.collateralMicro);
        break;
      }
      case 'fund': {
        const loan = w.loans.get(action.loan.id);
        if (!loan || loan.status !== 'Pending') break; // idempotent w/ manual member action
        loan.status = 'Active';
        loan.fundedAt = action.loan.fundAt;
        this.log({ type: 'LoanFunded', loanId: action.loan.id }, emit);
        this.log(
          { type: 'PrivateTransfer', from: action.loan.lender, to: action.loan.borrower, auditorPCT: this.fakePCT(action.loan.id) },
          emit,
        );
        break;
      }
      case 'settle': {
        const loan = w.loans.get(action.loan.id);
        if (!loan || loan.status !== 'Active') break; // user may have repaid early
        if (action.loan.outcome === 'repay') {
          loan.status = 'Repaid';
          loan.repaidAt = action.loan.settleAt;
          this.log({ type: 'LoanRepaid', loanId: action.loan.id }, emit);
          this.log(
            { type: 'PrivateTransfer', from: action.loan.borrower, to: action.loan.lender, auditorPCT: this.fakePCT(action.loan.id) },
            emit,
          );
        } else {
          loan.status = 'Defaulted';
          this.log({ type: 'LoanSeized', loanId: action.loan.id }, emit);
        }
        break;
      }
    }
  }

  // ---------- helpers ----------
  private strCipher(c: EGCT): Ciphertext {
    return this.el.toStrings(c);
  }
  private encMicro(micro: UsdcMicro): Ciphertext {
    const r = new Rng(Number(micro % 2147483647n) + 7).scalar();
    return this.el.toStrings(this.el.encrypt(this.auditorPub, usdcWhole(micro), r));
  }
  private toLoan(pl: PlannedLoan, status: LoanStatus): Loan {
    return {
      id: pl.id,
      epoch: pl.epoch,
      lender: pl.lender,
      borrower: pl.borrower,
      rateBps: pl.rateBps,
      size: this.encMicro(pl.sizeMicro),
      deadlineAt: pl.deadlineAt,
      status,
    };
  }
  private fakeHash(n: number): `0x${string}` {
    const h = (Math.imul(n + 1, 0x9e3779b1) >>> 0).toString(16).padStart(8, '0');
    return (`0x${h.repeat(8)}`) as `0x${string}`;
  }
  private fakePCT(id: string): string[] {
    let h = 2166136261;
    for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    return Array.from({ length: 7 }, (_, i) => (Math.imul(h + i, 0x85ebca6b) >>> 0).toString());
  }

  // ---------- subscriptions ----------
  subscribeClock(cb: (c: EpochClock) => void) {
    this.clockSubs.add(cb);
    cb(this.clock());
    return () => this.clockSubs.delete(cb);
  }
  subscribe(cb: (e: WindowEvent) => void) {
    this.eventSubs.add(cb);
    return () => this.eventSubs.delete(cb);
  }
  private emitClock() {
    const c = this.clock();
    for (const cb of this.clockSubs) cb(c);
  }

  // ---------- read snapshots ----------
  getEpochClock(): EpochClock {
    return this.clock();
  }
  getLatestMonia(): MoniaPrint | null {
    return this.world.prints[this.world.prints.length - 1] ?? null;
  }
  getMoniaHistory(limit = 40): MoniaPrint[] {
    return this.world.prints.slice(-limit);
  }
  getDepthCurve(epoch?: EpochId): DepthPoint[] {
    const e = epoch ?? this.world.currentEpoch;
    const rec = this.world.epochs.get(e);
    if (!rec) return [];
    const ticks = new Set<TickIndex>([...rec.aggClear.ask.keys(), ...rec.aggClear.bid.keys()]);
    return [...ticks]
      .map((t) => ({ tick: t, bps: tickToBps(t), supply: rec.aggClear.ask.get(t) ?? 0n, demand: rec.aggClear.bid.get(t) ?? 0n }))
      .sort((a, b) => a.tick - b.tick);
  }
  getRawCiphertexts(epoch: EpochId): { side: Side; tick: TickIndex; agg: Ciphertext }[] {
    const rec = this.world.epochs.get(epoch);
    if (!rec) return [];
    const out: { side: Side; tick: TickIndex; agg: Ciphertext }[] = [];
    for (const [tick, c] of rec.aggCipher.ask) out.push({ side: 'ask', tick, agg: this.strCipher(c) });
    for (const [tick, c] of rec.aggCipher.bid) out.push({ side: 'bid', tick, agg: this.strCipher(c) });
    return out.sort((a, b) => a.tick - b.tick);
  }
  getMembers(): MemberInfo[] {
    const roster = [...SIM_MEMBERS, SIM_ADMIN, SIM_KEEPER];
    return roster.map((m) => ({
      address: m.address,
      label: m.label,
      simulated: true,
      active: true,
      joinedEpoch: 0,
      roles: m.roles,
    }));
  }
  getLoanBook(filter?: { status?: LoanStatus }): Loan[] {
    let loans = [...this.world.loans.values()];
    if (filter?.status) loans = loans.filter((l) => l.status === filter.status);
    return loans.sort((a, b) => b.epoch - a.epoch || a.id.localeCompare(b.id));
  }
  recentLog(): WindowEvent[] {
    return this.world.log.slice();
  }

  // ---------- user (connected wallet) ----------
  private user(addr: Address): UserState {
    const key = addr.toLowerCase();
    let u = this.world.users.get(key);
    if (!u) {
      u = { usdcErc20: 0n, eercClear: 0n, registered: false, bids: [] };
      this.world.users.set(key, u);
    }
    return u;
  }
  getBalances(addr: Address): Balances {
    const u = this.user(addr);
    return {
      usdcErc20: u.usdcErc20,
      eercEncrypted: this.encMicro(u.eercClear),
      registered: u.registered,
    };
  }
  decryptOwnBalance(addr: Address): UsdcMicro {
    return this.user(addr).eercClear;
  }
  isRegistered(addr: Address): boolean {
    return this.user(addr).registered;
  }
  setRegistered(addr: Address, bjjPub: [string, string]) {
    const u = this.user(addr);
    u.registered = true;
    u.bjjPub = bjjPub;
  }
  mintFaucet(addr: Address, amt: UsdcMicro) {
    this.user(addr).usdcErc20 += amt;
  }
  wrap(addr: Address, amt: UsdcMicro) {
    const u = this.user(addr);
    if (u.usdcErc20 < amt) throw new Error('Insufficient TestUSDC');
    u.usdcErc20 -= amt;
    u.eercClear += amt;
  }
  unwrap(addr: Address, amt: UsdcMicro) {
    const u = this.user(addr);
    if (u.eercClear < amt) throw new Error('Insufficient encrypted balance');
    u.eercClear -= amt;
    u.usdcErc20 += amt;
  }
  addUserBid(addr: Address, side: Side, tick: TickIndex, sizeMicro: UsdcMicro) {
    const u = this.user(addr);
    const rec = this.world.epochs.get(this.world.currentEpoch);
    const r = new Rng((this.world.currentEpoch + 1) * 7919 + tick).scalar();
    const c = this.el.encrypt(this.auditorPub, usdcWhole(sizeMicro), r);
    if (rec && rec.status === 'Open') {
      const clear = side === 'ask' ? rec.aggClear.ask : rec.aggClear.bid;
      const ciph = side === 'ask' ? rec.aggCipher.ask : rec.aggCipher.bid;
      clear.set(tick, (clear.get(tick) ?? 0n) + sizeMicro);
      const prev = ciph.get(tick);
      ciph.set(tick, prev ? this.el.addCipher(prev, c) : c);
    }
    const bid: MyBid = {
      id: `U${this.world.currentEpoch}-${u.bids.length}`,
      epoch: this.world.currentEpoch,
      side,
      tick,
      bps: tickToBps(tick),
      size: { ...this.strCipher(c), clear: sizeMicro },
      status: 'submitted',
    };
    u.bids.push(bid);
    this.log({ type: 'BidSubmitted', side, tick, by: addr, simulated: false, cipher: this.strCipher(c) }, true);
  }
  getMyBids(addr: Address): MyBid[] {
    return this.user(addr).bids.slice().reverse();
  }
  getMyLoans(addr: Address): Loan[] {
    const key = addr.toLowerCase();
    return [...this.world.loans.values()]
      .filter((l) => l.lender.toLowerCase() === key || l.borrower.toLowerCase() === key)
      .map((l) => this.entitleLoan(l))
      .sort((a, b) => b.epoch - a.epoch);
  }
  /** Attach owner-entitled plaintext (size + health) to a loan the caller is party to. */
  private entitleLoan(l: Loan): Loan {
    const pl = this.world.loanClear.get(l.id);
    if (!pl) return l;
    // collateral as a % of the loan (haircut = 120%). e.g. 133% = comfortably over-collateralized.
    const healthPct = Math.round((Number(pl.collateralMicro) / Number(pl.sizeMicro)) * 100);
    return {
      ...l,
      size: { ...l.size, clear: pl.sizeMicro },
      collateral: l.collateral ? { ...l.collateral, clear: pl.collateralMicro } : undefined,
      healthPct,
    };
  }

  // member-driven loan actions (idempotent with the auto-timeline)
  userCollateralize(id: LoanId, micro: UsdcMicro) {
    const loan = this.world.loans.get(id);
    if (loan && loan.status === 'Pending' && !loan.collateral) loan.collateral = this.encMicro(micro);
  }
  userFund(id: LoanId) {
    const loan = this.world.loans.get(id);
    if (loan && loan.status === 'Pending') {
      loan.status = 'Active';
      loan.fundedAt = this.now;
      this.log({ type: 'LoanFunded', loanId: id }, true);
      this.log({ type: 'PrivateTransfer', from: loan.lender, to: loan.borrower, auditorPCT: this.fakePCT(id) }, true);
    }
  }
  userRepay(id: LoanId) {
    const loan = this.world.loans.get(id);
    if (loan && loan.status === 'Active') {
      loan.status = 'Repaid';
      loan.repaidAt = this.now;
      this.log({ type: 'LoanRepaid', loanId: id }, true);
      this.log({ type: 'PrivateTransfer', from: loan.borrower, to: loan.lender, auditorPCT: this.fakePCT(id) }, true);
    }
  }

  // ---------- admin (auditor entitlement) ----------
  // Post-close decryption: the FINAL epoch book (the plan), not the live partial accumulator,
  // so decrypt/compute/print are consistent.
  adminDepth(epoch: EpochId): DepthPoint[] {
    const plan = this.plans[epoch];
    if (plan) return plan.depthClear.map((d) => ({ ...d }));
    return this.getDepthCurve(epoch);
  }
  // The clearing the print will use — respects forced no-trade — so decrypt→compute→print agree.
  adminClearing(epoch: EpochId): { rStarBps: Bps | null; depth: DepthPoint[] } {
    return { rStarBps: this.plans[epoch]?.rStarBps ?? null, depth: this.adminDepth(epoch) };
  }
  planFor(epoch: EpochId): EpochPlan | undefined {
    return this.plans[epoch];
  }
  findLoan(id: LoanId): Loan | undefined {
    return this.world.loans.get(id);
  }
  memberName(addr: Address) {
    return memberLabel(addr);
  }
}
