// Purpose-generated NEVER-MEMBER "intruder" identity for the L1 negative tests (write-gate +
// read-gate). Deterministic and public — derived from a fixed Window seed, NOT an Anvil key — so
// the on-Avalanche L1 carries zero Anvil-derived material. It's a throwaway: it only ever holds
// worthless genesis-minted L1 WIN and is never a MemberRegistry member nor TxAllowList-enabled,
// which is exactly the point (it proves a funded-but-unpermissioned EOA still can't transact/read).
//   INTRUDER_ADDR = 0xBd44F6408CeFEF23fca5e9Ef209F3f9B54a7ab7C  (must match l1/genesis.json alloc)
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const require = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), "../services/package.json"));
const { keccak256, toUtf8Bytes, Wallet } = require("ethers");

export const INTRUDER_PK = keccak256(toUtf8Bytes("the-window:l1-intruder:never-a-member"));
export const INTRUDER_ADDR = new Wallet(INTRUDER_PK).address;
