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
export const TIME_PROFILES: Record<Profile, TimeProfile> = {
  DEMO: { epochLenMs: 60_000, tenorMs: 300_000, label: 'DEMO', epochLabel: '60s', tenorLabel: '5m' },
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
export const INDEXER_URL = env.VITE_INDEXER_URL ?? '/api';
export const SNOWTRACE_URL = env.VITE_SNOWTRACE_URL ?? 'https://testnet.snowtrace.io';

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
