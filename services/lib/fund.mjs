// Gas funder for dynamically-onboarded members. A freshly-generated EOA has zero native
// balance, so it can't send its own register/wrap/bid/lock txs until we top it up. The funder
// is chain-aware:
//   - Fuji C-chain (43113): native AVAX from the Core wallet (WALLET_PRIVATE_KEY).
//   - Permissioned L1 (43117) / local Anvil (31337): the gas token (WIN/ETH) from ADMIN
//     (Anvil #0), which is genesis-prefunded — the Core wallet has no funds on those chains.
// Capped per call (ONBOARD_FUND_WEI) so the funder can't be drained by repeated onboards.
import { provider, ethers, CHAIN_ID, sendTx, wallet } from "./chain.mjs";
import { ACTORS } from "./actors.mjs";

const IS_FUJI = CHAIN_ID === 43113;

// Default top-up: real AVAX is precious on Fuji (~a few txs' worth); the L1/local gas token is
// abundant, so fund generously there. Override with ONBOARD_FUND_WEI.
// Onboarding sends ~5 member txs (register + faucet + wrap deposit) plus later bids/locks, so fund
// a little headroom on Fuji; the L1/local gas token is abundant. Override with ONBOARD_FUND_WEI.
const DEFAULT_FUND_WEI = IS_FUJI ? ethers.parseEther("0.05") : ethers.parseEther("5");
const FUND_WEI = process.env.ONBOARD_FUND_WEI ? BigInt(process.env.ONBOARD_FUND_WEI) : DEFAULT_FUND_WEI;

function funderKey() {
  if (IS_FUJI) {
    const pk = process.env.WALLET_PRIVATE_KEY;
    if (!pk) throw new Error("[fund] WALLET_PRIVATE_KEY (Core wallet) required to fund members on Fuji");
    return pk.startsWith("0x") ? pk : "0x" + pk;
  }
  return ACTORS.admin.pk; // L1/local: gas token from the genesis-prefunded admin
}

// Use the shared FreshNonceManager signer (re-syncs nonce from the chain's pending count before
// every send) so funding from ADMIN interleaves safely with the admin's other txs (addMember etc.)
// on the same account — a plain ethers.Wallet would keep a stale nonce and collide (NONCE_EXPIRED).
let _funder = null; // { signer (FreshNonceManager), address }
function funder() {
  if (!_funder) {
    const key = funderKey();
    _funder = { signer: wallet(key), address: new ethers.Wallet(key).address };
  }
  return _funder;
}

// Send FUND_WEI of the native gas token to `toAddress`. Skips if the address already has
// enough to transact. Returns { funded, txHash? } — funded=false when already topped up.
export async function fundGas(toAddress) {
  const to = ethers.getAddress(toAddress);
  const have = await provider.getBalance(to);
  if (have >= FUND_WEI) return { funded: false, balance: have.toString() };

  const { signer, address } = funder();
  const bal = await provider.getBalance(address);
  if (bal < FUND_WEI) {
    console.error(`[fund] LOW FUNDER BALANCE: ${address} has ${ethers.formatEther(bal)} — needs ${ethers.formatEther(FUND_WEI)}`);
    throw new Error("funder out of gas — top up the Core wallet");
  }
  const { tx } = await sendTx(() => signer.sendTransaction({ to, value: FUND_WEI - have }), { label: `fundGas ${to}` });
  return { funded: true, txHash: tx.hash, amount: (FUND_WEI - have).toString() };
}

export { FUND_WEI };
