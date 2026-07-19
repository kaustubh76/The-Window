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
  TickIndex,
  TxResult,
  UsdcMicro,
  Unsubscribe,
  WindowEvent,
} from './types';

// The single interface every page talks to. LiveAdapter is the sole implementation —
// the interface remains the type contract and the documented eERC unit boundary.
export interface WindowAdapter {
  readonly mode: 'live';
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
  /** Recent event log snapshot (buffered from the indexer poll loop). */
  recentEvents(): WindowEvent[];
}
