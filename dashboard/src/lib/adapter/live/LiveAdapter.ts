import type { WindowAdapter } from '../WindowAdapter';
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
  MemberInfo,
  MoniaPrint,
  MyBid,
  OnProof,
  Profile,
  SessionState,
  Side,
  TickIndex,
  TxResult,
  UsdcMicro,
  WindowEvent,
} from '../types';
import { PROFILE } from '../../../config';
import { readRegistered, readUsdcBalance } from './contracts';
import { IndexerAPI } from '../../../services/indexer';

// Thrown by proof-bearing paths that need the eERC React SDK bridge (not yet attached).
export class EercNotReady extends Error {
  constructor(msg = 'eERC bridge not attached — mount useEercBridge in live mode.') {
    super(msg);
    this.name = 'EercNotReady';
  }
}

// The eERC React SDK is hooks-only, so proof-bearing writes + encrypted-balance decryption
// run inside React (see hooks/useEercBridge). LiveAdapter calls through this attached bridge.
export interface EercBridge {
  register(a: Address, onP?: OnProof): Promise<TxResult>;
  wrap(a: Address, amt: UsdcMicro, onP?: OnProof): Promise<TxResult>;
  unwrap(a: Address, amt: UsdcMicro, onP?: OnProof): Promise<TxResult>;
  transfer(from: Address, to: Address, amt: UsdcMicro, ref?: string, onP?: OnProof): Promise<TxResult>;
  encryptedBalance(a: Address): Promise<Ciphertext>;
  decryptBalance(a: Address): Promise<UsdcMicro>;
}

const LOCKED_CIPHER: Ciphertext = { c1: ['0', '0'], c2: ['0', '0'] };

/**
 * PHASE 8 — live adapter. Wired today: public TestUSDC balance + registration status
 * (viem reads), and M-ONIA/depth/loans/members via the indexer REST (graceful-empty until
 * it's running). Pending: the 5 money-market contract reads (add ABIs to contracts.ts once
 * deployed) and eERC proof-bearing writes / encrypted-balance decryption (attach the bridge).
 * Nothing here fabricates data — unwired paths throw EercNotReady or return empty.
 */
export class LiveAdapter implements WindowAdapter {
  readonly mode = 'live' as const;
  private profile: Profile = PROFILE;
  private bridge: EercBridge | null = null;

  async init(): Promise<void> {
    console.warn('[LiveAdapter] money-market contracts + eERC bridge pending — see contracts.ts / useEercBridge.');
  }

  attachEerc(bridge: EercBridge) {
    this.bridge = bridge;
  }
  private eerc(): EercBridge {
    if (!this.bridge) throw new EercNotReady();
    return this.bridge;
  }

  getProfile() {
    return this.profile;
  }
  setProfile(p: Profile) {
    this.profile = p;
  }
  async getEpochClock(): Promise<EpochClock> {
    try {
      return (await IndexerAPI.epochClock()) as EpochClock;
    } catch {
      // graceful-empty until the indexer is up
      return {
        epoch: 0, status: 'Open', profile: this.profile,
        openedAt: 0, closesAt: 0, epochLenMs: 0, tenorMs: 0, now: 0,
      };
    }
  }
  subscribeClock(cb: (c: EpochClock) => void) {
    const id = setInterval(() => { void this.getEpochClock().then(cb); }, 1000);
    return () => clearInterval(id);
  }

  // ---- public reads (indexer-backed; graceful-empty) ----
  async getLatestMonia(): Promise<MoniaPrint | null> {
    try {
      return (await IndexerAPI.latestMonia()) as MoniaPrint;
    } catch {
      return null;
    }
  }
  async getMoniaHistory(limit = 40): Promise<MoniaPrint[]> {
    try {
      return (await IndexerAPI.moniaHistory(limit)) as MoniaPrint[];
    } catch {
      return [];
    }
  }
  async getDepthCurve(epoch?: EpochId): Promise<DepthPoint[]> {
    try {
      return (await IndexerAPI.depth(epoch)) as DepthPoint[];
    } catch {
      return [];
    }
  }
  async getMembers(): Promise<MemberInfo[]> {
    try {
      return (await IndexerAPI.members()) as MemberInfo[];
    } catch {
      return [];
    }
  }
  async getLoanBook(): Promise<Loan[]> {
    try {
      return (await IndexerAPI.loans()) as Loan[];
    } catch {
      return [];
    }
  }
  async getRawCiphertexts(epoch: EpochId): Promise<{ side: Side; tick: TickIndex; agg: Ciphertext }[]> {
    try {
      return (await IndexerAPI.aggregates(epoch)) as { side: Side; tick: TickIndex; agg: Ciphertext }[];
    } catch {
      return [];
    }
  }

  // ---- session-scoped ----
  async getSession(): Promise<SessionState> {
    return { address: null, registered: false, persona: ['public'] };
  }
  async getBalances(a: Address): Promise<Balances> {
    const [usdc, reg] = await Promise.allSettled([readUsdcBalance(a), readRegistered(a)]);
    let eercEncrypted = LOCKED_CIPHER;
    if (this.bridge) {
      try {
        eercEncrypted = await this.bridge.encryptedBalance(a);
      } catch {
        /* keep locked */
      }
    }
    return {
      usdcErc20: usdc.status === 'fulfilled' ? usdc.value : 0n,
      registered: reg.status === 'fulfilled' ? reg.value : false,
      eercEncrypted,
    };
  }
  async decryptOwnBalance(a: Address): Promise<UsdcMicro> {
    return this.eerc().decryptBalance(a);
  }
  async getMyBids(): Promise<MyBid[]> {
    return [];
  }
  async getMyLoans(): Promise<Loan[]> {
    return [];
  }

  // ---- member writes (via eERC bridge) ----
  async register(a: Address, onP?: OnProof): Promise<TxResult> {
    return this.eerc().register(a, onP);
  }
  async faucet(): Promise<TxResult> {
    // TestUSDC.mint — a direct viem writeContract once wired; needs a wallet client.
    throw new EercNotReady('faucet needs a wallet client (wagmi useWriteContract).');
  }
  async wrap(a: Address, amt: UsdcMicro, onP?: OnProof): Promise<TxResult> {
    return this.eerc().wrap(a, amt, onP);
  }
  async unwrap(a: Address, amt: UsdcMicro, onP?: OnProof): Promise<TxResult> {
    return this.eerc().unwrap(a, amt, onP);
  }
  async submitAsk(): Promise<TxResult> {
    throw new EercNotReady('submitAsk needs AuctionHouse + eERC encrypt.');
  }
  async submitBid(): Promise<TxResult> {
    throw new EercNotReady('submitBid needs AuctionHouse + eERC encrypt.');
  }
  async lockCollateral(): Promise<TxResult> {
    throw new EercNotReady('lockCollateral needs CollateralVault + solvency proof.');
  }
  async fund(id: LoanId, onP?: OnProof): Promise<TxResult> {
    // lender → borrower encrypted transfer referencing the loan id
    void onP;
    void id;
    throw new EercNotReady('fund needs the eERC transfer bridge.');
  }
  async repay(): Promise<TxResult> {
    throw new EercNotReady('repay needs the eERC transfer bridge.');
  }

  // ---- keeper / admin ----
  async closeEpoch(): Promise<TxResult> {
    throw new EercNotReady('closeEpoch needs AuctionHouse.');
  }
  async seize(): Promise<TxResult> {
    throw new EercNotReady('seize needs LoanBook.');
  }
  async adminDecryptAggregates(): Promise<DepthPoint[]> {
    // Admin/auditor decryption runs in the Node services/admin — the browser never holds the key.
    throw new EercNotReady('admin decryption runs in services/admin (browser never holds the auditor key).');
  }
  async adminComputeClearing(): Promise<{ rStarBps: Bps | null; depth: DepthPoint[] }> {
    throw new EercNotReady('admin clearing runs in services/admin.');
  }
  async adminPostPrint(): Promise<TxResult & { print: MoniaPrint }> {
    throw new EercNotReady('postPrint is triggered against services/admin.');
  }
  async adminPostMatches(): Promise<TxResult & { loans: Loan[] }> {
    throw new EercNotReady('postMatches is triggered against services/admin.');
  }

  subscribe(_cb: (e: WindowEvent) => void) {
    return () => {};
  }
  recentEvents(): WindowEvent[] {
    return [];
  }

  // silence unused type imports on interface-required generics
  _t(_a?: LoanStatus) {}
}
