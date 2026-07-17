// THE WINDOW — central config. Fixed protocol parameters (Readme.md §3.3) + runtime wiring.
// Every duration reads from a DEMO/PROD profile; never hardcode durations elsewhere.

export type Profile = 'DEMO' | 'PROD';
export type AdapterMode = 'mock' | 'live';

const env = import.meta.env;

export const ADAPTER_MODE: AdapterMode = (env.VITE_ADAPTER as AdapterMode) ?? 'mock';
export const PROFILE: Profile = (env.VITE_PROFILE as Profile) ?? 'DEMO';

// ---- time profiles (ms) ----
export interface TimeProfile {
  epochLenMs: number;
  tenorMs: number;
  label: string;
  epochLabel: string;
  tenorLabel: string;
}
// Single source of truth for both the mock clock (engine.ts reads this) and every label.
// DEMO matches the pace the DemoEngine actually runs at — keep them equal so labels never lie.
export const TIME_PROFILES: Record<Profile, TimeProfile> = {
  DEMO: { epochLenMs: 22_000, tenorMs: 30_000, label: 'DEMO', epochLabel: '22s', tenorLabel: '30s' },
  PROD: { epochLenMs: 3_600_000, tenorMs: 21_600_000, label: 'PROD', epochLabel: '1h', tenorLabel: '6h' },
};
export function timeProfile(p: Profile = PROFILE): TimeProfile {
  return TIME_PROFILES[p];
}

// ---- fixed protocol parameters ----
export const USDC_DECIMALS = 6;
export const HAIRCUT_BPS = 12_000; // 120% collateral ratio (fixed)
export const HAIRCUT_PCT = 120;

// rate band: 1.00%..10.00% annualized, 25 bps ticks -> 37 ticks
export const RATE_MIN_BPS = 100;
export const RATE_MAX_BPS = 1000;
export const TICK_BPS = 25;
export const TICK_COUNT = (RATE_MAX_BPS - RATE_MIN_BPS) / TICK_BPS + 1; // 37

// min bid size (micro-USDC): PROD 10 USDC, DEMO 1 USDC
export const MIN_BID_MICRO: Record<Profile, bigint> = {
  DEMO: 1_000_000n,
  PROD: 10_000_000n,
};
export function minBidMicro(p: Profile = PROFILE): bigint {
  return MIN_BID_MICRO[p];
}

// ---- chain ----
export const CHAIN_ID = Number(env.VITE_CHAIN_ID ?? 43113);
export const RPC_FUJI = env.VITE_RPC_FUJI ?? 'https://api.avax-test.network/ext/bc/C/rpc';
export const RPC_LOCAL = env.VITE_RPC_LOCAL ?? 'http://127.0.0.1:8545';

// ---- permissioned-L1 awareness (thewindowl1, 43117) ----
// On the sovereign L1, membership IS chain access: non-members can neither transact
// (TxAllowList write-gate) nor observe (READ_GATE read-gate). READ_GATED turns on the
// member-signature auth for indexer reads (see services/readAuth.ts); off on Fuji, so
// the public hard-mode deployment is unchanged.
export const IS_L1 = CHAIN_ID === 43117;
export const READ_GATED = env.VITE_READ_GATE === '1' || IS_L1;
export const HAS_PUBLIC_EXPLORER = !IS_L1;
export const CHAIN_LABEL = IS_L1
  ? 'thewindowl1 · 43117 · Subnet-EVM'
  : CHAIN_ID === 43113
    ? `Fuji · ${CHAIN_ID}`
    : `chain ${CHAIN_ID}`;

export const INDEXER_URL = env.VITE_INDEXER_URL ?? '/api';
// Control API — the backend that performs member/admin/keeper WRITES server-side
// (proven eerc-node flows) for the disclosed simulated members. See services/control.
export const CONTROL_URL = env.VITE_CONTROL_URL ?? 'http://127.0.0.1:8899';
export const SNOWTRACE_URL = env.VITE_SNOWTRACE_URL ?? 'https://testnet.snowtrace.io';
// The live hosted Fuji indexer — read by the /l1 competitor pane to show the REAL
// participation leak on a public chain (both indexers send permissive CORS).
export const FUJI_INDEXER_URL = env.VITE_FUJI_INDEXER_URL ?? 'https://window-indexer.onrender.com';

// ---- deployed addresses (live mode) ----
export const ADDRESSES = {
  testUsdc: env.VITE_TESTUSDC_ADDR ?? '',
  eerc: env.VITE_EERC_ADDR ?? '',
  registrar: env.VITE_REGISTRAR_ADDR ?? '',
  memberRegistry: env.VITE_MEMBER_REGISTRY_ADDR ?? '',
  auctionHouse: env.VITE_AUCTION_HOUSE_ADDR ?? '',
  moniaOracle: env.VITE_MONIA_ORACLE_ADDR ?? '',
  collateralVault: env.VITE_COLLATERAL_VAULT_ADDR ?? '',
  loanBook: env.VITE_LOAN_BOOK_ADDR ?? '',
} as const;

// ---- ops role addresses (persona gating, live mode) ----
export const ADMIN_ADDR = (env.VITE_ADMIN_ADDR ?? '').toLowerCase();
export const KEEPER_ADDR = (env.VITE_KEEPER_ADDR ?? '').toLowerCase();

// tagline — the one line that must appear on the demo closer
export const TAGLINE = 'The rate is public. The borrowing never was.';

// ---- boot-time config sanity ----
// Catch the one sharp edge a hosted LIVE build can hit: if VITE_CONTROL_URL is unset, the
// live adapter silently posts every member/keeper/admin write to localhost and fails with
// no user-visible cause. Surface it loudly instead of failing in silence.
function computeConfigWarnings(): string[] {
  const w: string[] = [];
  if (ADAPTER_MODE === 'live' && /localhost|127\.0\.0\.1/.test(CONTROL_URL)) {
    w.push(
      `Live mode but Control API points at ${CONTROL_URL} — set VITE_CONTROL_URL to the hosted Control API or every write will fail.`,
    );
  }
  return w;
}
export const CONFIG_WARNINGS: string[] = computeConfigWarnings();
if (CONFIG_WARNINGS.length) console.error('[config]', CONFIG_WARNINGS.join(' '));
