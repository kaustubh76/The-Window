# 02 — On-chain Contracts (`contracts/src/`)

The six Solidity contracts that make up THE WINDOW, plus the verifier layer and the
vendored eERC stack they build on. Circuits and the proving pipeline that feed these
contracts are in `03-circuits-and-proving.md`; the services that drive them are in
`04-services.md`; deployment/demo flow is in `06-demo-and-ops.md`; design rationale and
sharp edges in `07-decisions-and-gotchas.md`.

All contracts are `pragma solidity ^0.8.24` and compiled with solc 0.8.27 (pinned to
match the eERC submodule — see `spike/NOTES.md`).

## Contents

- [System wiring at a glance](#system-wiring-at-a-glance)
- [MemberRegistry.sol](#memberregistrysol)
- [MemberGated.sol](#membergatedsol)
- [AuctionHouse.sol](#auctionhousesol)
- [MONIAOracle.sol](#moniaoraclesol)
- [CollateralVault.sol](#collateralvaultsol)
- [LoanBook.sol](#loanbooksol)
- [Verifier layer (`contracts/src/verifiers/`)](#verifier-layer-contractssrcverifiers)
- [Deployment wiring](#deployment-wiring)
- [Test suite](#test-suite)
- [The eERC stack underneath](#the-eerc-stack-underneath)

---

## System wiring at a glance

```
MemberRegistry ──(onlyMember via MemberGated)──> AuctionHouse, CollateralVault, LoanBook

AuctionHouse <──setOracle(one-time)── deploy script
AuctionHouse <──markPrinted(epoch)─── MONIAOracle          (only oracle may call)
MONIAOracle  ──getAggregate/epochStatus/TICKS──> AuctionHouse (reads accumulators)
MONIAOracle  ──verifyProof──> IPoCDVerifier (PoCDVerifierAdapter → DepthPoCDArrayVerifier, or MockVerifier)

CollateralVault <──setLoanBook(one-time)── deploy script
CollateralVault ──verifyProof──> IPoCDVerifier (SolvencyVerifierAdapter → CollateralSolvencyVerifier, or MockVerifier)
LoanBook ──rateAt(epoch)──> MONIAOracle       (postMatches must clear at printed r*)
LoanBook ──isLocked / release / seizeTo──> CollateralVault (vault↔loanbook link; onlyLoanBook)
```

Privileged roles across the system:

| Role | Held by (local demo) | Gates |
|---|---|---|
| `admin` | Anvil #0 | MemberRegistry `onlyAdmin`, MONIAOracle `onlyAdmin` (postPrint), LoanBook `onlyAdmin` (postMatches/confirmFunding/repay) |
| `keeper` | Anvil #1 | AuctionHouse `onlyKeeper` (openEpoch/closeEpoch) |
| `vaultOperator` | Anvil #2 | CollateralVault `onlyOperator` (confirmLock) |
| members | 5 agent EOAs | `onlyMember` on AuctionHouse/CollateralVault/LoanBook via `MemberGated` |
| oracle (contract) | MONIAOracle address | AuctionHouse.markPrinted |
| loanBook (contract) | LoanBook address | CollateralVault.release / seizeTo |

---

## MemberRegistry.sol

**Purpose** — admin-gated allowlist of vetted agent members. `onlyMember` on the other
contracts resolves here via `MemberGated`. `bjjPubKeyRef` records the member's
registered BabyJubJub key for off-chain services (`contracts/src/MemberRegistry.sol:4-8`).

**State** (`MemberRegistry.sol:10-18`):

| Variable | Type | Notes |
|---|---|---|
| `admin` | `address` | transferable via `transferAdmin` |
| `members` | `mapping(address => Member{bool active; uint64 joinedEpoch; bytes32 bjjPubKeyRef})` | |
| `memberCount` | `uint256` | incremented/decremented unchecked |

**Functions**:

| Function | Access | Behavior |
|---|---|---|
| `addMember(address who, uint64 joinedEpoch, bytes32 bjjPubKeyRef)` | `onlyAdmin` | reverts `AlreadyMember`/`ZeroAddress`; emits `MemberAdded` (`MemberRegistry.sol:39-47`) |
| `removeMember(address who)` | `onlyAdmin` | sets `active=false`; emits `MemberRemoved` (`:49-56`) |
| `isMember(address who) → bool` | view | consumed by `MemberGated.onlyMember` (`:58-60`) |
| `transferAdmin(address newAdmin)` | `onlyAdmin` | emits `AdminTransferred` (`:62-66`) |

**Events**: `MemberAdded(address indexed who, uint64 joinedEpoch, bytes32 bjjPubKeyRef)`,
`MemberRemoved(address indexed who)`, `AdminTransferred(address indexed from, address indexed to)`
(`MemberRegistry.sol:20-22`). **Errors**: `NotAdmin`, `AlreadyMember`, `NotMember`, `ZeroAddress`.

Members are added post-deploy by `packages/eerc-node/src/register_all.mjs` (see
`03-circuits-and-proving.md`).

## MemberGated.sol

**Purpose** — tiny abstract base sharing the `onlyMember` gate
(`contracts/src/MemberGated.sol:7-20`). Holds one immutable, `MemberRegistry public
immutable registry` (`:8`), set in the constructor; the `onlyMember` modifier calls
`registry.isMember(msg.sender)` and reverts `NotMember()` otherwise (`:16-19`).
Inherited by `AuctionHouse`, `CollateralVault`, `LoanBook`.

## AuctionHouse.sol

**Purpose** — hourly (60 s in DEMO) uniform-price auction over **encrypted** bid sizes.
Rate ticks are public; sizes are eERC ElGamal ciphertexts (`EGCT`). Per
`(epoch, side, tick)` the contract homomorphically accumulates `Σ Enc(size)` via
BabyJubJub point addition (~13k gas per add, validated in `spike/GATE.md`)
(`contracts/src/AuctionHouse.sol:8-13`).

**Constants** (`AuctionHouse.sol:15-18`): `TICKS = 37` (tick *i* → rate `100 + 25*i`
bps, i.e. 1.00%–10.00% in 25 bps steps), `ASK = 0` (lenders, min acceptable rate),
`BID = 1` (borrowers, max acceptable rate).

**State** (`AuctionHouse.sol:20-46`):

| Variable | Type | Notes |
|---|---|---|
| `Status` enum | `None, Open, Closed, Printed` | per-epoch lifecycle (`:20-25`) |
| `epochLength` | `uint256 immutable` | seconds; DEMO=60, PROD=3600 (`:33`); **live Fuji = 120** (deploy_fuji.sh default — see the parameter-sets note under Deployment wiring) |
| `keeper` | `address` | epoch lifecycle authority (`:34`) |
| `oracle` | `address` | set once by `setOracle` (`:35`) |
| `currentEpoch` | `uint64` | monotonically incremented (`:37`) |
| `epochStatus` / `epochStart` | mappings by epoch | (`:38-39`) |
| `acc` | `epoch ⇒ side ⇒ tick ⇒ Acc{Point c1; Point c2; bool init}` | internal EGCT accumulator (`:27-31`, `:42`) |
| `bidCount` | `epoch ⇒ side ⇒ tick ⇒ uint32` | number of bids accumulated (`:44`) |
| `filled` | `epoch ⇒ side ⇒ tick ⇒ member ⇒ bool` | one bid per member per side per tick per epoch (`:46`) |

**Functions**:

| Function | Access | Behavior |
|---|---|---|
| `setOracle(address)` | anyone, **one-time** (self-locking; reverts `AlreadySet`) | wires MONIAOracle (`AuctionHouse.sol:75-78`) |
| `openEpoch() → uint64` | `onlyKeeper` | reverts `PrevEpochStillOpen`; `++currentEpoch`, `Status.Open`, emits `EpochOpened` (`:82-89`) |
| `closeEpoch()` | `onlyKeeper` | reverts `WindowNotElapsed` before `epochStart + epochLength`; emits `EpochClosed` (`:91-97`) |
| `submitAsk(uint16 tick, EGCT cSize, bytes fundsRef)` | `onlyMember` | `_accumulate(ASK, …)`; emits `AskSubmitted` (with `fundsRef`) (`:101-104`) |
| `submitBid(uint16 tick, EGCT cSize)` | `onlyMember` | `_accumulate(BID, …)`; emits `BidSubmitted` (`:106-109`) |
| `_accumulate(side, tick, c)` | internal | checks `BadTick`/`NotOpen`/`AlreadyBidHere`; first bid initializes `Acc`, subsequent bids `BabyJubJub._add` componentwise on `c1`/`c2`; `++bidCount` (`:111-130`) |
| `getAggregate(uint64 e, uint8 side, uint16 tick) → (EGCT, uint32 count, bool init)` | view | **empty tick returns the BabyJubJub identity point `(0,1)` for both c1,c2** — a valid encryption of 0 so padded ticks pass the PoCD circuit's on-curve checks (`:134-148`) |
| `markPrinted(uint64 e)` | `msg.sender == oracle` only; requires status `Closed` | flips to `Printed`; emits `EpochPrinted` (`:151-156`) |

**Events** (`AuctionHouse.sol:48-52`): `EpochOpened(epoch, startTs)`,
`EpochClosed(epoch, closeTs)`, `AskSubmitted(epoch, who, tick, fundsRef)`,
`BidSubmitted(epoch, who, tick)`, `EpochPrinted(epoch)`.
**Errors**: `NotKeeper, NotOracle, AlreadySet, BadTick, NotOpen, AlreadyBidHere,
WindowNotElapsed, EpochNotClosed, PrevEpochStillOpen` (`:54-62`).

## MONIAOracle.sol

**Purpose** — prints **M-ONIA** (Machine Overnight Index Average). Verifies a Proof of
Correct Decryption (PoCD) that the published per-tick depth is the true decryption of
AuctionHouse's on-chain EGCT accumulators, then computes clearing rate r* and matched
volume **on-chain** from that proven depth. Because the public-signal vector is built
here from on-chain accumulators, a valid proof cannot certify admin-invented numbers —
the SOFR model: confidential inputs, accountable administrator, public benchmark
(`contracts/src/MONIAOracle.sol:8-15`).

**The PoCD is chunked** (EIP-170 fix): instead of one 372-signal monolithic proof, the
37-tick curve is verified as **CHUNKS = 4 proofs of CHUNK_TICKS = 10 ticks each**
(`MONIAOracle.sol:18-24`) — chunking keeps the generated Groth16 verifier under
EIP-170's 24,576-byte limit (the monolith was 62,708 bytes of deployed code).
`CHUNKS*CHUNK_TICKS (40) >= TICKS (37)`; virtual ticks 37–39 are padded with the
identity point `(0,1)` and zero sums on both the prover and this contract.

**State** (`MONIAOracle.sol:17-52`):

| Variable | Type | Notes |
|---|---|---|
| `NO_TRADE` | `uint16 constant = type(uint16).max` | (`:17`) |
| `CHUNK_TICKS` / `CHUNKS` | `uint16 constant = 10` / `= 4` | chunked-PoCD geometry (`:23-24`) |
| `Groth16Proof` struct | `{uint256[2] a; uint256[2][2] b; uint256[2] c}` | one per chunk (`:31-35`) |
| `auctionHouse` | `AuctionHouse immutable` | |
| `verifier` | `IPoCDVerifier immutable` | adapter or mock |
| `admin` | `address immutable` | |
| `auditorPubX` / `auditorPubY` | `uint256 immutable` | auditor BJJ public key baked in at deploy (`:47-48`) |
| `prints` | `mapping(uint64 => Print{uint16 rStarTick; uint256 aggVolume; uint64 printedAt; bool exists})` | (`:37-42`, `:50`) |
| `lastPrintedEpoch`, `lastPrintStale` | `uint64`, `bool` | `lastPrintStale=true` after a NoTrade print (`:51-52`) |

**`postPrint(uint64 epoch, uint16 rStarTick, DepthPoint[] calldata depth, Groth16Proof[4] calldata proofs)`** — `onlyAdmin` (`MONIAOracle.sol:82-118`); `proofs[k]` covers ticks `[k*CHUNK_TICKS, (k+1)*CHUNK_TICKS)`:

1. Requires `auctionHouse.epochStatus(epoch) == Status.Closed` (revert `EpochNotClosed`, `:88`), no prior print (`AlreadyPrinted`, `:89`), and `depth.length == TICKS` (`BadDepthLength`, `:90-91`).
2. Verifies **all four chunk proofs**, each against `_buildChunkSignals(epoch, depth, k)` — binding every chunk to its own slice of on-chain accumulators, the claimed sums, and the auditor key (revert `BadProof`, `:94-98`). Because each chunk's public signals embed its own accumulator slice, cross-chunk proof swaps fail (tested on-chain, `MONIAOracleArrayIntegration.t.sol:80-99`).
3. Recomputes the clearing **on-chain** via `_computeClearing(depth)` (`:101`) and reverts `WrongClearingTick` if the claimed `rStarTick` disagrees (`:104`, `:112`).
4. No-trade case: stores `Print{NO_TRADE, 0, …}`, sets `lastPrintStale = true`, calls `auctionHouse.markPrinted(epoch)`, emits `NoTrade(epoch)` (`:103-110`).
5. Trade case: stores the print, updates `lastPrintedEpoch`, clears staleness, `markPrinted`, emits `RatePrinted(epoch, crossing, matched)` (`:112-117`).

**`_computeClearing`** (`MONIAOracle.sol:124-146`) — uniform-price crossing: lenders
(asks) accept if r* ≥ their tick, borrowers (bids) accept if r* ≤ their tick. Cumulative
supply at tick t = Σ asks with tick ≤ t; cumulative demand = Σ bids with tick ≥ t.
r* = the lowest tick where `cumSupply >= demandFrom` with both positive; matched volume
= min of the two. Returns `(NO_TRADE, 0, false)` if no crossing.

**`_buildChunkSignals(uint64 epoch, DepthPoint[] calldata depth, uint16 k)`**
(`MONIAOracle.sol:158-226`) — builds the **102-element** vector `2 + CHUNK_TICKS*10`
for chunk k over ticks `k*10 .. k*10+9`. Order is **grouped** (circom flattens
`public [...]` arrays grouped, not interleaved):

```
sig[0..1]    auditorPubX, auditorPubY
sig[2..21]   askC1[t].x, askC1[t].y     for t = k*10..k*10+9   (read from getAggregate)
sig[22..41]  askC2[t].x, askC2[t].y     for t = k*10..k*10+9   (read from getAggregate)
sig[42..51]  askSum[t]                  for t = k*10..k*10+9   (claimed depth)
sig[52..71]  bidC1[t].x, bidC1[t].y     for t = k*10..k*10+9
sig[72..91]  bidC2[t].x, bidC2[t].y     for t = k*10..k*10+9
sig[92..101] bidSum[t]                  for t = k*10..k*10+9
```

Virtual ticks `>= TICKS` (37–39, last chunk only) are written as the identity point
`(0,1)` for c1/c2 and sum 0 **without calling `getAggregate`** (`:174-181` etc.) —
exactly what the prover pads, and exactly what `getAggregate` returns for empty on-chain
ticks, so a mismatch fails verification. This order MUST match the
`depth_pocd_array.circom` `public [...]` declaration at N = 10 — see the coupling
section in `03-circuits-and-proving.md`. Real-tick accumulators are read live from
`auctionHouse.getAggregate(epoch, side, t)` so each chunk proof binds to on-chain state.

**Views**: `latestRate() → (tick, epoch, stale)` (`:229-231`),
`rateAt(epoch) → (tick, exists)` (`:233-236`).
**Events**: `RatePrinted(uint64 indexed epoch, uint16 rStarTick, uint256 aggVolume)`,
`NoTrade(uint64 indexed epoch)` (`:54-55`).

## CollateralVault.sol

**Purpose** — encrypted, cash-secured collateral. A borrower proves in ZK that
`Dec(collateral) ≥ h·Dec(loanSize)` (the CollateralSolvency circuit) before their
encrypted collateral is escrowed. Since a Solidity contract cannot hold a BabyJubJub key
or generate proofs, custody sits in a registered `vaultOperator` EOA; the contract holds
the AUTHORITY and records, and movement is event-driven (operator executes eERC
transfers, then confirms) — disclosed in METHODOLOGY.md
(`contracts/src/CollateralVault.sol:8-14`).

**State** (`CollateralVault.sol:16-37`):

| Variable | Type | Notes |
|---|---|---|
| `HAIRCUT_BPS` | `uint256 constant = 12000` | 120% (`:16`) |
| `LockState` enum | `None, Requested, Locked, Released, Seized` | (`:18-24`) |
| `solvencyVerifier` | `IPoCDVerifier immutable` | |
| `vaultOperator` | `address immutable` | |
| `loanBook` | `address` | one-time `setLoanBook` (reverts `AlreadySet`, `:67-70`) |
| `locks` | `mapping(uint256 loanId => Lock{address borrower; LockState state; bytes32 collateralRef})` | (`:26-30`, `:36`) |
| `activeLockCount` | `uint256` | ++ on confirmLock, -- on release/seize |

**The two-step lock flow** (proof gate, then custody confirmation):

1. **`lockCollateral(uint256 loanId, EGCT cCollateral, EGCT cLoanSize, uint256[2] ownerPub, a, b, c)`** — `onlyMember` (`CollateralVault.sol:74-101`). Requires `LockState.None`. Builds the 11-element public-signal vector in the order the CollateralSolvency verifier expects: `[Ccoll.c1.x, Ccoll.c1.y, Ccoll.c2.x, Ccoll.c2.y, Cloan.c1.x, Cloan.c1.y, Cloan.c2.x, Cloan.c2.y, HAIRCUT_BPS, ownerPub.x, ownerPub.y]` (`:85-96`), verifies (revert `BadSolvencyProof`, `:97`), then records `LockState.Requested` and emits **`LockRequested(loanId, borrower)`** (`:99-100`). No funds move here.
2. **`confirmLock(uint256 loanId, bytes32 collateralRef)`** — `onlyOperator` (`:104-113`). Requires `Requested`; the operator has executed the actual eERC escrow transfer off this contract and confirms it, flipping to `LockState.Locked`, storing `collateralRef`, `++activeLockCount`, emitting **`Locked(loanId, collateralRef)`**.

**Terminal transitions — `onlyLoanBook`** (`CollateralVault.sol:119-141`):

| Function | Effect |
|---|---|
| `release(uint256 loanId)` | `Locked → Released`; emits `ReleaseOrdered(loanId, borrower)` + `Released(loanId)` (`:121-130`) |
| `seizeTo(uint256 loanId, address lender)` | `Locked → Seized`; emits `SeizeOrdered(loanId, lender)` + `Seized(loanId)` (`:132-141`) |

The `*Ordered` events are the operator's work queue (the operator service executes the
corresponding eERC transfer — see `04-services.md`).

**View**: `isLocked(loanId) → bool` (`state == Locked`, `:115-117`) — consumed by
`LoanBook.confirmFunding`.
**Events**: `LockRequested, Locked, ReleaseOrdered, SeizeOrdered, Released, Seized`
(`:39-44`). **Errors**: `NotOperator, NotLoanBook, AlreadySet, BadSolvencyProof, BadState`.

## LoanBook.sol

**Purpose** — overnight loan lifecycle. Admin posts matches at the printed clearing rate
r*; each loan is collateralized (Vault), funded (eERC transfer, auditor-attested), then
repaid (release collateral) or, past its deadline block, seized. The contract enforces
LIFECYCLE finality; transfer magnitudes are auditor-attested since eERC transfer events
carry no plaintext amount (`contracts/src/LoanBook.sol:9-15`, and see
`spike/NOTES.md` Q5).

**State machine**: `LoanState { None, Pending, Active, Repaid, Defaulted }`
(`LoanBook.sol:17-23`):

```
None ──postMatches(onlyAdmin, epoch printed, rateTick == r*)──> Pending
Pending ──confirmFunding(onlyAdmin, requires vault.isLocked(loanId))──> Active
Active ──repay(onlyAdmin) → vault.release(loanId)──> Repaid
Active ──seize(ANYONE, block.number > deadlineBlock) → vault.seizeTo(loanId, lender)──> Defaulted
```

**State** (`LoanBook.sol:25-49`):

| Variable | Type | Notes |
|---|---|---|
| `oracle` / `vault` / `admin` / `tenorBlocks` | immutables | `tenorBlocks`: DEMO 150 (~5 min), PROD 10800 (`script/DeployAll.s.sol:39`); **live Fuji = 60** (deploy_fuji.sh default) |
| `loans` | `mapping(uint256 => Loan{lender, borrower, epoch, rateTick, EGCT cSize, deadlineBlock, state})` | (`:25-33`) |
| `nextLoanId` | `uint256` | sequential ids assigned in `postMatches` |
| `activeLoanCount` | `uint256` | ++ on fund, -- on repay/seize |

**Functions**:

| Function | Access | Behavior |
|---|---|---|
| `postMatches(uint64 epoch, Match[] ms)` | `onlyAdmin` | requires `oracle.rateAt(epoch).exists` (`EpochNotPrinted`); every `ms[i].rateTick` must equal the printed r* (`BadRate`) — invariant 4; creates `Pending` loans with `deadlineBlock = block.number + tenorBlocks`; emits `LoanCreated(loanId, lender, borrower, epoch, rateTick, deadlineBlock)` (`LoanBook.sol:81-98`) |
| `confirmFunding(uint256 loanId, bytes32 transferRef)` | `onlyAdmin` | requires `Pending` and **`vault.isLocked(loanId)`** (`CollateralNotLocked`) → `Active`; emits `Funded` (`:102-111`). `transferRef` is an unnamed/unused calldata slot — attestation reference only |
| `repay(uint256 loanId, bytes32 transferRef)` | `onlyAdmin` | requires `Active` → `Repaid`; calls `vault.release(loanId)`; emits `Repaid` (`:114-123`) |
| `seize(uint256 loanId)` | **permissionless** | requires `Active` and `block.number > deadlineBlock` (`DeadlineNotReached` — seize at exactly the deadline block still reverts, `:129`) → `Defaulted`; calls `vault.seizeTo(loanId, lender)`; emits `Seized` (`:126-136`) |
| `loanState(uint256) → LoanState` | view | (`:138-140`) |

**Events**: `LoanCreated, Funded, Repaid, Seized` (`LoanBook.sol:51-56`).
**Errors**: `NotAdmin, EpochNotPrinted, BadRate, BadState, CollateralNotLocked,
DeadlineNotReached` (`:58-63`).

---

## Verifier layer (`contracts/src/verifiers/`)

Everything routes through one seam, `contracts/src/interfaces/IPoCDVerifier.sol`:
`verifyProof(uint256[2] a, uint256[2][2] b, uint256[2] c, uint256[] input) → bool`
with a **dynamic** input array, implemented by mocks and adapters alike.

| Contract | What it is |
|---|---|
| `DepthPoCDArrayVerifier.sol` | snarkjs-generated Groth16 verifier for **one 10-tick chunk** of the DepthCurve PoCD, `verifyProof(..., uint256[102])`. Regenerated for the chunked circuit: deployed bytecode is now **17,892 bytes — under EIP-170's 24,576** (the 372-signal monolith was 62,708 bytes), so it **deploys inline like any other contract** — the old `cast send --create` pre-deploy, the `DEPTH_ARRAY_VERIFIER_ADDR` env var, and the `anvil --code-size-limit` flag are all gone. The build script still renames the generated `Groth16Verifier` to `DepthPoCDArrayVerifier` to avoid a name collision (`circuits/build_pocd_array.sh` step 3). |
| `PoCDVerifierAdapter.sol` | bridges MONIAOracle's dynamic `uint256[]` seam to the generated `uint[102]` signature; hard length guard reverts `BadInputLength` if `input.length != 102` (`contracts/src/verifiers/PoCDVerifierAdapter.sol:35`). |
| `CollateralSolvencyVerifier.sol` | snarkjs-generated Groth16 verifier for CollateralSolvency, `verifyProof(..., uint256[11])` (~11 KB, deploys normally). |
| `SolvencyVerifierAdapter.sol` | same bridge pattern for the vault: `input.length != 11` reverts `BadInputLength` (`contracts/src/verifiers/SolvencyVerifierAdapter.sol:27-39`). |
| `DepthPoCDVerifier.sol` | generated verifier for the **superseded single-sum** `depth_pocd.circom` (7 public signals). Kept as the D2 gate artifact; not wired into deployment. |
| `MockVerifier.sol` | test double used when `USE_REAL_VERIFIERS != 1`. Always returns `result` (settable via `setResult(bool)`) and **records `lastInput`** so tests can assert the oracle bound the proof to the correct accumulators (`contracts/src/verifiers/MockVerifier.sol:9-30`). |
| `eerc/*.sol` | the five snarkjs-generated eERC verifiers, renamed with a `Gen` suffix: `RegistrationVerifierGen`, `MintVerifierGen`, `TransferVerifierGen`, `WithdrawVerifierGen`, `BurnVerifierGen` — deployed by `DeployAll` and handed to the `Registrar`/`EncryptedERC` constructors. |

## Deployment wiring

`contracts/script/DeployAll.s.sol` deploys and wires the FULL stack (eERC converter +
5 WINDOW contracts) in one broadcast:

- **Env inputs** (`DeployAll.s.sol:34-42`): `ADMIN_PK` (required), `KEEPER_ADDR` /
  `VAULT_OPERATOR_ADDR` (default: admin), **`EPOCH_LEN`** (default 60; PROD 3600),
  **`TENOR_BLOCKS`** (default 150; PROD ~10800), `AUDITOR_PUB_X/Y` (default 0),
  **⚠️ three parameter sets exist** — DEMO (60 s / 150 blocks, `DeployAll` defaults),
  PROD (3600 s / 10800 blocks), and **the LIVE Fuji stack: `EPOCH_LEN=120`,
  `TENOR_BLOCKS=60`** (defaults baked into `scripts/deploy_fuji.sh:31-32` and
  `demo/run_fuji.sh:21` so epochs outlast ~40 s chunked-PoCD proving + real
  confirmations; confirmed in the 43113 broadcast constructor args and on-chain
  `epochLength()`/`tenorBlocks()`),
  `USE_REAL_VERIFIERS` (1 ⇒ real Groth16, else MockVerifier for both seams). The old
  `DEPTH_ARRAY_VERIFIER_ADDR` env var is **gone** — the chunked 102-signal verifier
  (~18 KB) fits EIP-170 and is deployed inline:
  `new PoCDVerifierAdapter(address(new DepthPoCDArrayVerifier()))` (`:74-77`).
- **Order** (`:46-89`): TestUSDC (`SimpleERC20("Test USDC","tUSDC",6)`) → five eERC
  verifiers → `Registrar` → `EncryptedERC` (converter mode, decimals 6) →
  `MemberRegistry(admin)` → `AuctionHouse(registry, epochLen, keeper)` → verifier
  selection → `MONIAOracle(auction, pocdVerifier, admin, auditorPubX, auditorPubY)` →
  `CollateralVault(registry, solvencyVerifier, operator)` →
  `LoanBook(registry, oracle, vault, admin, tenorBlocks)` → one-time wiring
  `auction.setOracle(oracle)` and `vault.setLoanBook(book)` (`:88-89`).
- **Output**: writes `contracts/deployments/<chainid>.json` (`:98-112`); the local one
  is `contracts/deployments/31337.json`, the live Fuji one
  `contracts/deployments/43113.json` (see `06-demo-and-ops.md`) — keys `TESTUSDC_ADDR,
  EERC_ADDR, REGISTRAR_ADDR, MEMBER_REGISTRY_ADDR, AUCTION_HOUSE_ADDR,
  MONIA_ORACLE_ADDR, COLLATERAL_VAULT_ADDR, LOAN_BOOK_ADDR, ADMIN_ADDR, KEEPER_ADDR,
  VAULT_OPERATOR_ADDR`. All services and `register_all.mjs` read this file.
- `scripts/deploy_local.sh` is the local driver: `forge build`, then one
  `forge script script/DeployAll.s.sol --broadcast` with `USE_REAL_VERIFIERS=1`
  (`scripts/deploy_local.sh:17-26`) — **no cast pre-deploy step anymore**; it works
  against a vanilla Anvil. `scripts/deploy_fuji.sh` is the Fuji driver (same
  `DeployAll`, `--broadcast --slow`, real keys from root `.env` — see
  `06-demo-and-ops.md`). EOA registration in eERC + auditor binding happen afterwards
  in `packages/eerc-node/src/register_all.mjs` because registration needs client-side
  proofs (`DeployAll.s.sol:30-31`).

Note the one-time setters `AuctionHouse.setOracle` and `CollateralVault.setLoanBook`
are callable by **anyone** but only once (self-locking `AlreadySet`) — a deployment
front-running consideration recorded in `07-decisions-and-gotchas.md`.

## Test suite

Unit tests (`contracts/test/`, **49 tests total, all green** after the chunked-PoCD
migration):

| File | Covers |
|---|---|
| `MemberRegistry.t.sol` | add/remove, onlyAdmin, no double add, transferAdmin (5 tests) |
| `AuctionHouse.t.sol` | open/bid/close/aggregate, non-member rejection, one-bid-per-tick, bad tick, closed-window bidding, close-before-window, keeper gating, `markPrinted` only-oracle+Closed, `setOracle` once (9 tests) |
| `MONIAOracle.t.sol` | crossing computation, `WrongClearingTick`, `BadProof`, not-Closed revert, no double print, NoTrade path, onlyAdmin (7 tests, MockVerifier). Uses the new `Groth16Proof[4]` postPrint shape (`_emptyProofs()` helper, `MONIAOracle.t.sol:71`) and asserts the mock saw `lastInputLength == 2 + 10*10 = 102` (`:86`) |
| `LoanBook.t.sol` | repay path, seize path, match-rate enforcement, `confirmFunding` requires lock, no double seize, `postMatches` requires print (6 tests; print helper updated to `Groth16Proof[4]`) |
| `ToyAccumulator.t.sol` | the D2 spike: homomorphic sum decrypts correctly, many-accumulate, per-add gas measurement (`contracts/src/spike/ToyAccumulator.sol`) |

Gate tests (real Groth16 proofs on-chain):

| File | Covers |
|---|---|
| `CollateralSolvencyGate.t.sol` | hardcoded proof for coll 6000 / loan 5000 (exactly 120%); valid proof verifies; tampered haircut (`h→11000`) fails; tampered ciphertext fails (`contracts/test/CollateralSolvencyGate.t.sol:49-63`) |
| `DepthPoCDGate.t.sol` | superseded single-sum verifier: Enc(100)+Enc(250) claiming Σ=350, 7 public signals; tamper + gas tests |
| `DepthPoCDArrayGate.t.sol` | the 4 chunk proofs loaded from `test/fixtures/depth_chunks.json` (generated by `emit_array_fixture.mjs`), verified through `PoCDVerifierAdapter`: all 4 chunks verify with 102 signals each (`test_AllChunkProofsVerifyThroughAdapter`, `:42-47`); tampered signal fails (`:49`); **cross-chunk swap fails** — chunk 1's proof against chunk 0's signals does not verify (`test_CrossChunkProofFails`, `:57-61`); wrong length reverts `BadInputLength` (`:63`) |
| `MONIAOracleArrayIntegration.t.sol` | Phase B capstone: the fixture scenario (ask 300 @ tick 4, bid 300 @ tick 10, `FIXTURE_PRIV = 2748579834902348905823409582340958234`) is submitted on-chain; `postPrint` with the REAL chunk verifier succeeds only because each chunk's on-chain accumulator slice equals that chunk proof's 102 signals bit-for-bit; asserts r* = tick 4, volume 300, epoch `Printed` (`test_RealPoCDBoundToOnChainAccumulators`, `:54-78`); **`test_SwappedChunkProofsRevert`** (`:80-99`) swaps two individually-valid chunk proofs and asserts `BadProof` — the chunk↔slice binding is sound. The full postPrint tx (4 × Groth16 verify ≈ 860k each + storage) runs at ~5.0M gas in this test path — same order as the old ~4.1M single-proof print |

Invariant/fuzz suite (`contracts/test/invariant/`): `WindowHandler.sol` deploys and
wires the full stack with itself as admin/keeper/operator/member and exposes bounded
actions (`act_openAndBid, act_closeAndPrint, act_postMatch, act_lock, act_fund,
act_repay, act_warp, act_roll, act_seize`) plus ghost state
(`ghost_seizeBeforeDeadlineSucceeded`). `WindowInvariants.t.sol` asserts the five
README §11 invariants (`contracts/test/invariant/WindowInvariants.t.sol`):

1. **`invariant_collateralConservation`** (`:30`) — every Active loan has a locked
   collateral; `activeLoanCount ≤ activeLockCount`.
2. **`invariant_epochMonotonicity`** (`:43`) — a printed epoch stays `Printed`; the
   current epoch is never `None` once started.
3. **`invariant_noDoubleTerminal`** (`:58`) — Repaid ⇒ collateral `Released`;
   Defaulted ⇒ collateral `Seized`.
4. **`invariant_matchRate`** (`:73`) — every loan clears at its epoch's printed r*.
5. **`invariant_deadlineSafety`** (`:85`) — seize never succeeds at
   `block.number <= deadlineBlock` (ghost flag).

Plus `test_FullLifecycleReachable` (`:92`) — a coverage guard proving the handler
actions compose into both funded→repaid and funded→seized paths, so the invariants are
not vacuously true.

## The eERC stack underneath

THE WINDOW settles on the vendored **ava-labs/EncryptedERC** submodule at
`contracts/lib/EncryptedERC/` (solc 0.8.27), deployed by `DeployAll` in **converter
mode**:

- **TestUSDC** — `SimpleERC20("Test USDC", "tUSDC", 6)` from the submodule's tokens
  (`contracts/script/DeployAll.s.sol:50`), minted freely in demos.
- **Registrar** — users register a BabyJubJub public key bound to their EOA + chainid
  via a ZK registration proof.
- **EncryptedERC** — `isConverter: true, decimals: 6` (`DeployAll.s.sol:57-69`):
  deposit wraps tUSDC into an encrypted `EGCT` balance; `transfer` moves value with a
  32-signal proof and emits `PrivateTransfer` carrying **no plaintext amount** — only
  an auditor-decryptable `auditorPCT`. This is why LoanBook funding/repayment is
  auditor-attested rather than contract-observed.
- The auditor is set to the admin's registered key post-deploy
  (`packages/eerc-node/src/register_all.mjs:33-48`).

The full teardown — EGCT layout, registration circuit, converter decimals/dust,
auditor rotation, what `PrivateTransfer` exposes, the on-chain `BabyJubJub` library
(public functions, `_add`, deterministic `encrypt` with `random = 1`) and gas numbers —
lives in **`spike/NOTES.md`** (Q1–Q7) and `spike/GATE.md`. Don't duplicate it here.
