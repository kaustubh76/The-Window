// Actor registry for the demo stack: EOA keys + roles + deterministic BJJ raw
// scalars (so eERC balances can be decrypted later). Anvil default keys for local;
// override any via env. Public test keys only — no real funds.
import "dotenv/config";
import { ethers } from "ethers";

const ANVIL = {
  admin: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // #0
  keeper: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // #1
  operator: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // #2
  lender1: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // #3
  lender2: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a", // #4
  borrower: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba", // #5
  agent4: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e", // #6
  agent5: "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356", // #7
};

const ENV_KEY = {
  admin: "ADMIN_PK", keeper: "KEEPER_PK", operator: "VAULT_OPERATOR_PK",
  lender1: "LENDER1_PK", lender2: "LENDER2_PK", borrower: "BORROWER_PK",
  agent4: "AGENT4_PK", agent5: "AGENT5_PK",
};

// Deterministic BJJ raw scalar per actor (reconstructable for balance decryption).
function bjjRaw(name) {
  return BigInt(ethers.keccak256(ethers.toUtf8Bytes("the-window:bjj:" + name)));
}

// Fallback keys (Anvil PKs above, demo auditor below) are for local chains ONLY:
// Anvil 31337 and the local permissioned L1 43117 (run_l1.sh's zero-secret posture
// relies on the demo auditor default). On any real network a missing env var must
// fail loudly, not silently sign with a publicly-known key.
const CHAIN_ID = Number(process.env.CHAIN_ID || 31337);
const LOCAL_CHAIN = [31337, 43117].includes(CHAIN_ID);
function localOnly(value, what) {
  if (!LOCAL_CHAIN) throw new Error(`[actors] FATAL: ${what} required on chain ${CHAIN_ID} — built-in fallbacks are local-only`);
  return value;
}

export const ACTORS = {};
for (const [name, dflt] of Object.entries(ANVIL)) {
  const pk = process.env[ENV_KEY[name]] || localOnly(dflt, ENV_KEY[name]);
  ACTORS[name] = {
    name,
    pk,
    address: new ethers.Wallet(pk).address.toLowerCase(),
    bjjRaw: bjjRaw(name),
    role: name.startsWith("lender") ? "lender" : name === "borrower" || name.startsWith("agent") ? "borrower" : name,
  };
}

// address(lowercase) -> actor
export const BY_ADDRESS = Object.fromEntries(Object.values(ACTORS).map((a) => [a.address, a]));

export function actorByAddress(addr) {
  return BY_ADDRESS[String(addr).toLowerCase()] || null;
}

// The bidding agents (all registered members). tick/size are BASE values; the live
// stack jitters them per epoch via agentBids() so r*, matched volume, and defaults vary.
export const AGENTS = [
  { actor: "lender1", label: "yield-target lender A", side: 0, tick: 6, size: 400n },
  { actor: "lender2", label: "yield-target lender B", side: 0, tick: 8, size: 500n },
  { actor: "borrower", label: "desperate borrower", side: 1, tick: 30, size: 350n },
  { actor: "agent4", label: "opportunistic borrower", side: 1, tick: 12, size: 300n },
  { actor: "agent5", label: "noise trader", side: 1, tick: 16, size: 120n },
];

// Deterministic hash -> [0,1) seeded by (epoch, salt): reproducible per run, but each
// epoch looks different. Uses keccak so it's stable and needs no RNG state.
function seeded(epoch, salt) {
  return Number(BigInt(ethers.keccak256(ethers.toUtf8Bytes(`window:bid:${epoch}:${salt}`))) % 1_000_000n) / 1_000_000;
}
// jitter a base value by ±spread (rounded, clamped to >= min)
function jitter(epoch, salt, base, spread, min) {
  return Math.max(min, Math.round(base + (seeded(epoch, salt) * 2 - 1) * spread));
}

// Per-epoch bid params: lenders keep low ask ticks, borrowers higher bid ticks (so the
// book still crosses most epochs), but ticks (±3 asks / ±5 bids) and sizes (±150) vary.
export function agentBids(epoch) {
  return AGENTS.map((a) => ({
    ...a,
    tick: Math.min(36, jitter(epoch, `${a.actor}:tick`, a.tick, a.side === 0 ? 3 : 5, 0)),
    size: BigInt(jitter(epoch, `${a.actor}:size`, Number(a.size), 150, 60)),
  }));
}

// Members registered on-chain (need MemberRegistry membership to bid / lock).
export const MEMBER_NAMES = ["lender1", "lender2", "borrower", "agent4", "agent5"];

export const AUDITOR = {
  priv: BigInt(process.env.AUDITOR_BJJ_PRIV || localOnly("2748579834902348905823409582340958234", "AUDITOR_BJJ_PRIV")),
  pub: [
    BigInt(process.env.AUDITOR_BJJ_PUB_X || localOnly("15126131017275559229883198140197230023892265818363501039953620538039205717764", "AUDITOR_BJJ_PUB_X")),
    BigInt(process.env.AUDITOR_BJJ_PUB_Y || localOnly("7504911034826791718448377250227968384413910115391011404817860837847273794444", "AUDITOR_BJJ_PUB_Y")),
  ],
};
