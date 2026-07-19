/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PROFILE?: 'DEMO' | 'PROD';
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_RPC_FUJI?: string;
  readonly VITE_RPC_LOCAL?: string;
  readonly VITE_INDEXER_URL?: string;
  readonly VITE_SNOWTRACE_URL?: string;
  readonly VITE_TESTUSDC_ADDR?: string;
  readonly VITE_EERC_ADDR?: string;
  readonly VITE_REGISTRAR_ADDR?: string;
  readonly VITE_MEMBER_REGISTRY_ADDR?: string;
  readonly VITE_AUCTION_HOUSE_ADDR?: string;
  readonly VITE_MONIA_ORACLE_ADDR?: string;
  readonly VITE_COLLATERAL_VAULT_ADDR?: string;
  readonly VITE_LOAN_BOOK_ADDR?: string;
  readonly VITE_ADMIN_ADDR?: string;
  readonly VITE_KEEPER_ADDR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// circomlibjs ships no types.
declare module 'circomlibjs' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function buildBabyjub(): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function buildPoseidon(): Promise<any>;
}
