// One source of truth for the jargon a first-timer hits on the Desk/Auction/Wallet pages.
// Each term links to the Methodology section that explains it in full. Copy is written to
// stay honest (see lib/honestClaims) — amounts are private to the owner AND the accountable
// Benchmark Administrator; we never claim otherwise.
export interface GlossaryEntry {
  term: string;
  def: string;
  anchor: string; // /methodology#<anchor>
}

export const GLOSSARY = {
  eerc: {
    term: 'eERC',
    def: 'Encrypted ERC-20: balances and transfer amounts live on-chain as ElGamal ciphertext, so sizes stay private while the token still behaves like an ERC-20.',
    anchor: 'auction',
  },
  pocd: {
    term: 'PoCD',
    def: 'Proof of Correct Decryption — a Groth16 proof that each published rate and depth curve is the true decryption of the on-chain ciphertext. You verify the benchmark instead of trusting it.',
    anchor: 'pocd',
  },
  wrap: {
    term: 'wrap',
    def: 'Convert public TestUSDC into your encrypted eERC balance (unwrap converts back). Only wrapped funds can be bid privately.',
    anchor: 'auction',
  },
  bjj: {
    term: 'BabyJubJub key',
    def: 'The elliptic-curve keypair that encrypts your eERC balance. Registering derives it once; only its holder can open their own amounts.',
    anchor: 'auction',
  },
  rstar: {
    term: 'r*',
    def: 'The clearing rate — where cumulative supply (asks) crosses demand (bids). Every fill settles at r*, a single uniform price.',
    anchor: 'auction',
  },
  tick: {
    term: 'tick',
    def: 'A discrete rate step (25 bps) on the 1–10% band. Orders are placed at a public tick; only the size is encrypted.',
    anchor: 'auction',
  },
  haircut: {
    term: 'haircut',
    def: 'The over-collateralization ratio (120%): the collateral required as a percentage of the loan principal.',
    anchor: 'auction',
  },
} satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;
