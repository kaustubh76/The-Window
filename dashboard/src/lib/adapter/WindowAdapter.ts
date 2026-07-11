import type {
  Address,
  Balances,
  Bps,
  DepthPoint,
  EpochClock,
  EpochId,
  Loan,
  LoanId,
  LoanStatus,
  MemberInfo,
  MoniaPrint,
  MyBid,
  OnProof,
  Profile,
  Side,
  SessionState,
  TickIndex,
  TxResult,
  UsdcMicro,
  Unsubscribe,
  WindowEvent,
} from './types';

// The single interface every page talks to. Mock and live implementations are
// interchangeable — pages never know which is behind it.
export interface WindowAdapter {
  readonly mode: 'mock' | 'live';
  init(): Promise<void>;

  // clock / profile
  getProfile(): Profile;
  setProfile(p: Profile): void;
  getEpochClock(): Promise<EpochClock>;
  subscribeClock(cb: (c: EpochClock) => void): Unsubscribe;

  // public reads
  getLatestMonia(): Promise<MoniaPrint | null>;
  getMoniaHistory(limit?: number): Promise<MoniaPrint[]>;
  getDepthCurve(epoch?: EpochId): Promise<DepthPoint[]>;
  getMembers(): Promise<MemberInfo[]>;
  getLoanBook(filter?: { status?: LoanStatus }): Promise<Loan[]>;
  getRawCiphertexts(epoch: EpochId): Promise<{ side: Side; tick: TickIndex; agg: import('./types').Ciphertext }[]>;

  // session-scoped reads
  getSession(): Promise<SessionState>;
  getBalances(a: Address): Promise<Balances>;
  decryptOwnBalance(a: Address): Promise<UsdcMicro>; // client-side, owner entitlement only
  getMyBids(a: Address): Promise<MyBid[]>;
  getMyLoans(a: Address): Promise<Loan[]>;

  // member writes (proof-bearing)
  register(a: Address, onP?: OnProof): Promise<TxResult>;
  faucet(a: Address, amt: UsdcMicro): Promise<TxResult>;
  wrap(a: Address, amt: UsdcMicro, onP?: OnProof): Promise<TxResult>;
  unwrap(a: Address, amt: UsdcMicro, onP?: OnProof): Promise<TxResult>;
  submitAsk(a: Address, tick: TickIndex, size: UsdcMicro, onP?: OnProof): Promise<TxResult>;
  submitBid(a: Address, tick: TickIndex, size: UsdcMicro, onP?: OnProof): Promise<TxResult>;
  lockCollateral(id: LoanId, amt: UsdcMicro, onP?: OnProof): Promise<TxResult>;
  fund(id: LoanId, onP?: OnProof): Promise<TxResult>;
  repay(id: LoanId, onP?: OnProof): Promise<TxResult>;

  // keeper
  closeEpoch(e: EpochId): Promise<TxResult>;
  seize(id: LoanId): Promise<TxResult>;

  // admin (auditor-key holder; browser never holds the key in live mode)
  adminDecryptAggregates(e: EpochId): Promise<DepthPoint[]>;
  adminComputeClearing(e: EpochId): Promise<{ rStarBps: Bps | null; depth: DepthPoint[] }>;
  adminPostPrint(e: EpochId, onP?: OnProof): Promise<TxResult & { print: MoniaPrint }>;
  adminPostMatches(e: EpochId): Promise<TxResult & { loans: Loan[] }>;

  // firehose
  subscribe(cb: (e: WindowEvent) => void): Unsubscribe;
  /** Recent event log snapshot (reflects scrub/replay state, unlike the live-only subscribe). */
  recentEvents(): WindowEvent[];
}

// Optional demo controls exposed only by the mock adapter (see MockAdapter).
export interface DemoControls {
  play(): void;
  pause(): void;
  setSpeed(mult: number): void;
  seek(ms: number): void;
  reseed(seed: number): void;
  loadScenario(name: string): void;
  stepEpoch(): void;
}

export function hasDemoControls(a: WindowAdapter): a is WindowAdapter & DemoControls {
  return a.mode === 'mock' && typeof (a as unknown as DemoControls).play === 'function';
}
