// THE WINDOW — data-adapter types (the keystone contract).
//
// RULES:
//  - Money is ALWAYS bigint micro-USDC (6 decimals). Never `number` for money.
//  - A Ciphertext carries `clear` ONLY when the viewer is entitled to it
//    (own value via self-decrypt, or the admin aggregate). Otherwise it stays encrypted.
//  - `PrivateTransfer` events carry NO amount (honest — mirrors eERC on-chain reality).

export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type UsdcMicro = bigint; // 6dp integer, e.g. 10_000000n = 10 USDC
export type Bps = number; // 100..1000 in steps of 25
export type TickIndex = number; // 0..36
export type EpochId = number;
export type LoanId = string;

export type Profile = 'DEMO' | 'PROD';
export type Side = 'ask' | 'bid'; // ask = lender/supply, bid = borrower/demand
export type EpochStatus = 'Open' | 'Closed' | 'Printed';
export type LoanStatus = 'Pending' | 'Active' | 'Repaid' | 'Defaulted';
export type Persona = 'public' | 'lender' | 'borrower' | 'admin' | 'keeper';

/** An ElGamal ciphertext over BabyJubJub (EGCT = 2 points). `clear` present only if entitled. */
export interface Ciphertext {
  c1: [string, string];
  c2: [string, string];
  clear?: UsdcMicro;
}

export interface EpochClock {
  epoch: EpochId;
  status: EpochStatus;
  profile: Profile;
  openedAt: number; // virtual ms
  closesAt: number; // virtual ms
  epochLenMs: number;
  tenorMs: number;
  now: number; // virtual ms (drives all countdowns — never Date.now())
}

export interface DepthPoint {
  tick: TickIndex;
  bps: Bps;
  supply: UsdcMicro; // aggregate ask size at this tick
  demand: UsdcMicro; // aggregate bid size at this tick
}

export interface PoCD {
  verified: boolean;
  gasUsed?: number;
  proveMs?: number;
  txHash?: Hex;
}

export interface MoniaPrint {
  epoch: EpochId;
  rStarBps: Bps | null; // null => "no trade" (curves didn't cross)
  aggVolume: UsdcMicro;
  depth: DepthPoint[];
  pocd: PoCD;
  printedAt: number;
  stale: boolean; // carrying a prior print because this epoch printed "no trade"
}

export interface MemberInfo {
  address: Address;
  label?: string;
  simulated: boolean; // mandatory self-dealing disclosure
  active: boolean;
  joinedEpoch: EpochId;
  roles: Persona[];
}

export interface Loan {
  id: LoanId;
  epoch: EpochId;
  lender: Address;
  borrower: Address;
  rateBps: Bps;
  size: Ciphertext; // no plaintext on-chain
  collateral?: Ciphertext;
  deadlineAt: number; // virtual ms
  deadlineBlock?: number;
  createdTx?: Hex | null; // LoanCreated tx hash (Snowtrace link)
  status: LoanStatus;
  healthPct?: number; // collateral vs 120% haircut, only when viewer entitled
  fundedAt?: number;
  repaidAt?: number;
}

export interface MyBid {
  id: string;
  epoch: EpochId;
  side: Side;
  tick: TickIndex;
  bps: Bps;
  size: Ciphertext;
  status: 'submitted' | 'matched' | 'unfilled' | 'returned';
}

export interface Balances {
  usdcErc20: UsdcMicro; // public TestUSDC balance
  eercEncrypted: Ciphertext; // encrypted eERC balance (clear only if self-decrypted)
  eercClear?: UsdcMicro;
  registered: boolean;
}

// ---- proof + tx surfacing ----
export type ProofPhase = 'idle' | 'building-witness' | 'proving' | 'verifying' | 'done' | 'error';
export interface ProofProgress {
  phase: ProofPhase;
  label: string;
  ms?: number;
}
export interface TxResult {
  ok: boolean;
  txHash?: Hex;
  error?: string;
  proofMs?: number;
  gasUsed?: number;
}
export type OnProof = (p: ProofProgress) => void;

// ---- event firehose (drives live UI + demo) ----
// On-chain events carry the Fuji tx hash + block so the UI can link to Snowtrace.
export interface TxMeta { txHash?: Hex; block?: number }
export type WindowEvent =
  | { type: 'clock'; clock: EpochClock }
  | ({ type: 'BidSubmitted'; side: Side; tick: TickIndex; by: Address; simulated: boolean; cipher: Ciphertext } & TxMeta)
  | ({ type: 'EpochOpened'; epoch: EpochId } & TxMeta)
  | ({ type: 'EpochClosed'; epoch: EpochId } & TxMeta)
  | ({ type: 'RatePrinted'; print: MoniaPrint } & TxMeta)
  | ({ type: 'MatchesPosted'; epoch: EpochId; count: number } & TxMeta)
  | ({ type: 'LoanFunded'; loanId: LoanId } & TxMeta)
  | ({ type: 'LoanRepaid'; loanId: LoanId } & TxMeta)
  | ({ type: 'LoanSeized'; loanId: LoanId } & TxMeta)
  | ({ type: 'PrivateTransfer'; from: Address; to: Address; auditorPCT: string[] } & TxMeta) // no amount — honest
  | { type: 'ProofProgress'; scope: string; progress: ProofProgress };

export type Unsubscribe = () => void;
