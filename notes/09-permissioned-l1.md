# 09 — Permissioned L1 (`thewindowl1`, chainId 43117)

The Readme §12 D7 stretch, **implemented** (2026-07-12): THE WINDOW running on a
sovereign Avalanche L1 where **MemberRegistry membership IS chain access** — the
Subnet-EVM **TxAllowList precompile** is kept in sync with the on-chain member set by
a dedicated keeper, so a non-member cannot send ANY transaction on the chain. The
market's own governance gates the network itself.

## Why this is composition, not a mirror (two leaks, two primitives)

The L1 is not "the Fuji stack deployed twice." eERC and the permissioned L1 close
**different halves** of the same leak, and only together are they sufficient for the
stigma thesis:

- **eERC hides the _amount_.** But the leak budget (Readme §4) is explicit that member
  addresses, bid participation, and timing stay **public** on Fuji. For a product whose
  whole premise is stigma ("observable borrowing kills lending markets"), *participation
  itself is the signal* — seeing "agent X is at the window this epoch" leaks the stigma
  even with the size encrypted. So amount-privacy is **necessary but not sufficient**.
- **The permissioned L1 hides _participation_ and gates _access_.** Non-members can
  neither transact (TxAllowList write-gate) nor observe (the READ_GATE read-gate, below).

One contract, `MemberRegistry`, is the single source of truth for **four** layers at
once — market (`onlyMember`), eERC enrollment (no chain tx ⇒ no register), network
(TxAllowList), and observation (READ_GATE). One `removeMember` revokes all four
atomically (`demo/verify_l1_revoke.mjs`) — a *complete* eviction that is impossible on
shared public Fuji, where you can only block a bad actor's `onlyMember` calls, never
evict them from the settlement layer or the network.

The honest framing: public Fuji is the **amount-private hard-mode** deployment (required
by the brief, most impressive cryptographically); the sovereign L1 is the
**amount-private AND participation-gated consortium** posture. Same product, two points
on the privacy spectrum — mastery of both Avalanche primitives, not a copy.

## Topology

```
avalanche-cli local network (avalanchego + Subnet-EVM v0.8.0)
  └─ L1 "thewindowl1" — chainId 43117, PoA, token WIN, genesis l1/genesis.json
       ├─ TxAllowList precompile (0x0200…0002), active from genesis:
       │    admin  = anvil#0 (role Admin)
       │    enabled at genesis = keeper (#1), operator (#2)   ← ops roles only
       │    members (#3-#7) NOT enabled — they earn access via MemberRegistry
       ├─ full WINDOW stack (same DeployAll, USE_REAL_VERIFIERS=1, chunked PoCD)
       │    → contracts/deployments/43117.json (per-machine, regenerated)
       └─ services (ports 8788/8900 — runs ALONGSIDE the Fuji stack):
            allowlist ← THE NEW PIECE (services/allowlist/index.mjs)
            indexer · control · keeper · agents · operator · admin
```

## The allowlist keeper (`services/allowlist/index.mjs`)

House-style stateless poll loop: reads `MemberAdded`/`MemberRemoved` from
MemberRegistry via `queryAll`, then for each address seen sets the TxAllowList role
to match current `isMember()` — `setEnabled` on join, `setNone` on removal. Chain
admins (role 2) are never touched. It shares the admin bundle's NonceManager
(`handles(ADMIN_PK).registry.runner`) so it can't desync nonces with the admin
daemon, and self-schedules (no overlapping ticks). On chains without the precompile
(Anvil/Fuji) the read reverts and it idles harmlessly.

Bootstrap order matters: `register_all.mjs` is **admin-only transactions** (addMember
+ admin eERC registration + setAuditor), so it runs while members are still
chain-blocked; the keeper then enables them, and only then do member EOAs transact
(bids, locks). That ordering is exactly the story: **you join the registry, the chain
opens to you.**

## Read-privacy: the READ_GATE member-gated read surface

Write-gating (TxAllowList) stops non-members from *transacting*, but the market is also
*observed* through the indexer's REST API (`/members`, `/bids`, `/events` expose WHO bid
WHEN — the participation leak). On the L1 that read surface is **member-gated** too:

- `services/indexer/index.mjs` installs a `readGate` middleware, active only when
  `READ_GATE=1` (set by `demo/run_l1.sh`; unset on Fuji, so the middleware is a no-op and
  Fuji stays the open hard-mode deployment). `/health` is always open (liveness).
- A caller proves membership by signing a short-TTL challenge `window-read:<floor(now/30s)>`
  (EIP-191 `personal_sign`) with a member EOA; the middleware recovers the address
  (`ethers.verifyMessage`) and checks `MemberRegistry.isMember` (10 s cached — not an RPC
  per request). Bad/expired sig or non-member ⇒ **403**.
- **Scope / honesty**: this gates the **application** read surface (the actual market
  observation channel). Node-level RPC restriction (validator-only) on a real
  sovereign-testnet L1 is the production posture, not demoed on the single-node local
  chain — do not claim more than the app-gate delivers. Copy says "non-members cannot
  observe the market," never "nobody can see" (honest-claims guardrail).

## Files

| File | What |
|---|---|
| `l1/genesis.json` | Subnet-EVM genesis: chainId 43117, feeConfig (20M gas limit), `txAllowListConfig`, prefunded anvil actors + one never-member "intruder" EOA (anvil #8) for the negative test |
| `scripts/deploy_l1.sh` | DeployAll → `deployments/43117.json` (real verifiers; EPOCH_LEN=60, TENOR_BLOCKS=20) |
| `services/allowlist/index.mjs` | the MemberRegistry → TxAllowList sync keeper (write-gate) |
| `services/indexer/index.mjs` | `READ_GATE` middleware — member-signature-gated reads (read-gate) |
| `demo/run_l1.sh` | one-command orchestrator: deploy-if-needed → register → allowlist sync (waits for 5/5) → six services (`READ_GATE=1`) → runs the four proof scripts. PID-tracked (`/tmp/window_l1_pids`), never touches the Fuji stack |
| `demo/verify_l1_allowlist.mjs` | write-gate proof: intruder role None + tx REJECTED at chain level; member role Enabled + tx mined; auction alive on the L1 |
| `demo/verify_l1_readgate.mjs` | read-gate proof: anon read 403, non-member signed read 403, member signed read 200 |
| `demo/verify_l1_revoke.mjs` | atomic revocation: one `removeMember` → market ✗ / eERC ✗ / network ✗ / observation ✗, then re-adds to restore the market |
| `demo/what_a_competitor_sees.mjs` | side-by-side: public Fuji leaks participation; the L1 refuses the non-member |

## One-time L1 creation (documented in run_l1.sh header)

```bash
avalanche blockchain create thewindowl1 --evm --genesis l1/genesis.json \
  --proof-of-authority \
  --validator-manager-owner 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
  --proxy-contract-owner   0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
  --evm-token WIN --latest --icm=false
avalanche blockchain deploy thewindowl1 --local
# RPC = "RPC Endpoint" row of: avalanche blockchain describe thewindowl1
```

avalanche-cli 1.9.6 / subnet-evm v0.8.0. The interactive "initialize Validator
Manager" prompt at the end of `deploy --local` can be ^C'd/skipped — validator-set
management is not needed for the fixed single-node local demo; the chain is already
live and tracking.

## Verified run (2026-07-12)

- Genesis roles confirmed via `readAllowList`: admin=2, keeper/operator=1, members=0.
- Stack deployed: same byte-sizes as Fuji (TestUSDC 1,713 B / AuctionHouse 4,311 B /
  MONIAOracle 5,367 B; real chunked-PoCD verifier inline).
- `register_all` (admin txs) succeeded while members were still chain-blocked.
- allowlist keeper enabled all 5 members from MemberRegistry events.
- Agents' encrypted bids landed on the L1 (member txs pass); keeper opened epochs.
- `demo/verify_l1_allowlist.mjs`: PASS — see output below.

```
PASS  intruder 0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f has TxAllowList role None (0)
PASS  member lender1 0x90F79bf6EB2c4f870365E785982E1f101E93b906 has TxAllowList role Enabled/Admin (1)
PASS  non-member tx REJECTED by the chain (could not coalesce error)
PASS  member tx mined on the L1 (block 53, 0xaa938bbe59878a7b…)
PASS  auction alive on the L1: currentEpoch = 2
      lastPrintedEpoch = 1

ALLOWLIST VERIFY: PASS
```

And the market itself: **M-ONIA epoch 1 printed ON THE L1 at r\* = 525 bps with a
real 4-chunk Groth16 PoCD verified on-chain, 2 loans matched** (admin log
2026-07-12; the same encrypted-auction lifecycle as Fuji, now on a chain that
non-members cannot even transact on).

## Subnet-EVM gotchas (discovered the hard way, fixed in the keeper)

1. **Demand-block time freeze.** Subnet-EVM only produces blocks when transactions
   arrive, so `provider.getBlock("latest").timestamp` FREEZES between txs. The keeper
   originally used chain time as "now" → `closeEpoch` never looked due. Fix
   (keeper:19-25): `now = max(chain time, wall clock)` — right on Fuji (continuous
   blocks), on scripted Anvil (`evm_increaseTime` pushes chain time AHEAD), and here.
2. **Estimation deadlock.** Worse: even when wall-time says the window elapsed,
   `eth_estimateGas` simulates against the STALE latest block, so `closeEpoch`
   estimation reverts `WindowNotElapsed` — and the keeper never sends the very tx
   whose fresh block would pass. Fix (keeper open/close): send with an explicit
   `gasLimit: 300_000`, skipping estimation; the wall-clock guard prevents genuinely
   early sends, and an on-chain revert costs only keeper gas. Time-gated calls are
   the ONLY ones affected — postPrint/postMatches/locks are state-gated and estimate
   fine. (`seize` is gated on block NUMBER, which is never stale relative to
   estimation — no issue.)
3. **State before "Restarting node to track" is not durable.** `blockchain deploy
   --local` restarts the local node to track the new chain — do the one-time
   create+deploy FIRST, then deploy contracts / start services (run_l1.sh's order).

## Honest scope

This is a **local** L1 (single avalanchego node via avalanche-cli) — the sovereign-
testnet variant (real validators tracking the L1 on Fuji) is the same genesis +
`avalanche blockchain deploy thewindowl1 --fuji` plus node infra, deliberately not
run for the hackathon (fragile to keep alive through judging). Everything else —
precompile behavior, the membership→allowlist wiring, the full private-auction
lifecycle with real proofs — is identical to what a testnet L1 would run.
