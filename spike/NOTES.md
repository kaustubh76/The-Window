# D1 — eERC Teardown Notes

All citations are to the vendored submodule at `contracts/lib/EncryptedERC/` (ava-labs/EncryptedERC, converter-capable). Pragma across the repo is **`solidity 0.8.27`** (e.g. `contracts/types/Types.sol:6`) — our Foundry `solc_version` is pinned to 0.8.27 to match.

Status: **all 7 teardown questions answered from source.** The D2 gate (homomorphic accumulation + PoCD) is validated — see `spike/GATE.md`.

---

### Q1 — On-chain ciphertext representation of an encrypted amount

`contracts/types/Types.sol`:
- `struct Point { uint256 x; uint256 y; }` (`:8-11`)
- `struct EGCT { Point c1; Point c2; }` (`:48-51`) — one ElGamal ciphertext = **2 points = 4 × uint256**.
- `struct EncryptedBalance { EGCT eGCT; mapping(...) balanceList; uint256 nonce; uint256 transactionIndex; uint256[7] balancePCT; AmountPCT[] amountPCTs; }` (`:34-41`). Per-account balance is one `EGCT` plus a `uint256[7] balancePCT` (Poseidon ciphertext, for fast owner/auditor decryption) plus a history of `AmountPCT { uint256[7] pct; uint256 index; }` (`:29-32`).

**ElGamal scheme (from circom `circom/components.circom`):** `c1 = r·G`, `c2 = msg·G + r·pub`. Decryption `Dec(priv,C) = c2 − priv·c1 = msg·G`; the scalar `msg` is recovered off-chain by discrete log (BSGS). Additively homomorphic: `Enc(a) ⊕ Enc(b) = Enc(a+b)`.

### Q2 — Registration flow

`contracts/Registrar.sol`:
- `register(RegisterProof calldata proof)` (`:82`) → `_verifyProof` (`:169`) → `_register` (`:151`); guards duplicate registration; emits `Register(address indexed user, Point publicKey)` (`:47`).
- `RegisterProof { ProofPoints proofPoints; uint256[5] publicSignals; }` (`Types.sol:60-63`).
- Circuit `circom/registration.circom` proves: `SenderPublicKey == SenderPrivateKey·G` (`CheckPublicKey`) and a `RegistrationHash` binding `(chainID, privKey, address)`. Public signals: `[SenderPublicKey(2), SenderAddress, ChainID, RegistrationHash]` (5).
- Views: `isUserRegistered(address)` (`:121`), `getUserPublicKey(address)` (`:131`).

### Q3 — Converter mode: deposit/withdraw + decimals

`contracts/EncryptedERC.sol`:
- `deposit(uint256 amount, address tokenAddress, uint256[7] amountPCT)` (`:424`) and an overload `deposit(..., bytes calldata message)` (`:445`). Guards: `onlyIfAuditorSet`, `onlyForConverter`, `revertIfBlacklisted`, `onlyIfUserRegistered`. Pulls the ERC-20 and credits the encrypted balance via `_executeDeposit`. Emits `Deposit(user, amount, dust, tokenId)` (`:138`).
- `withdraw(uint256 tokenId, WithdrawProof proof, uint256[7] balancePCT)` (`:479`) + `message` overload (`:499`). `WithdrawProof { ProofPoints; uint256[16] publicSignals; }` (`Types.sol:80-83`).
- **Decimals:** `_convertFrom`/`_convertTo` (`:618`,`:697`) scale between the underlying token decimals and the eERC `decimals` (constructor immutable, `CreateEncryptedERCParams.decimals`, `Types.sol:21`). The remainder on deposit is returned as **dust** (see `Deposit.dust`). Do NOT assume 2 decimals — set/read the deployed value (we deploy with `decimals = 6` to match TestUSDC).

### Q4 — Auditor mechanics + rotation

`contracts/auditor/AuditorManager.sol`:
- `Point public auditorPublicKey` (`:34`); `isAuditorKeySet()` (`:83`); `_updateAuditor(address, uint256[2] publicKey)` sets both address + key and emits `AuditorChanged` (`:104-115`).
- `EncryptedERC.setAuditorPublicKey(address user)` (`:229`) — `onlyOwner`, requires the target user is registered; pulls their pubkey from the Registrar and calls `_updateAuditor`. **Rotation supported** (call again with a new registered user).
- Every transfer/deposit/mint carries an `amountPCT`/`auditorPCT` (`uint256[7]`) — a Poseidon ciphertext of the amount that the **auditor** key can decrypt. Circuits enforce it encodes the same amount as the ElGamal ciphertext. → The auditor CAN decrypt individual amounts (SOFR-style accountable role — honest-claim guardrail).

### Q5 — Transfer flow: what a third-party contract can observe (LoanBook funding hook)

`contracts/EncryptedERC.sol`:
- `transfer(...)` (`:369`) + overload with `bytes message` (`:391`). Uses `TransferProof { ProofPoints; uint256[32] publicSignals; }` (`Types.sol:70-73`).
- Emits **`PrivateTransfer(address indexed from, address indexed to, uint256[7] auditorPCT, address indexed auditorAddress)`** (`:123-128`). **The event carries NO plaintext amount and NO EGCT** — only `from`, `to`, and the `auditorPCT` (auditor-decryptable amount).
- **Implication for LoanBook:** a contract cannot read the transferred magnitude on-chain. Funding/repay confirmation must be **auditor-attested**: the admin service watches `PrivateTransfer`, decrypts `auditorPCT` with the auditor key, checks `from==lender,to==borrower,amount==principal`, then calls `LoanBook.confirmFunding(loanId, txHash)`. The `transfer(..., bytes message)` overload (emits a `Metadata` blob, `Types.sol:92-97`) can carry a `loanId` reference to bind the transfer to a loan. Contract enforces lifecycle finality; magnitude is attested (document in METHODOLOGY.md).

### Q6 — Can external contracts add ciphertexts on-chain? (the gate primitive)

`contracts/libraries/BabyJubJub.sol` — a **library with `public` functions**, so it deploys standalone and links via DELEGATECALL; any contract can call it:
- `_add(Point,Point)` (`:48`), `_sub(Point,Point)` (`:32`), `scalarMultiply(Point,uint256)` (`:78`), `elGamalEncryption(Point,uint256)` (`:113`) — note **hardcoded `random = 1`** (`:117`), i.e. deterministic on-chain encryption — `encrypt(...)` (`:130`), `base8()` (`:140`), `Q` (`:19`).
- **Homomorphic add** = componentwise `_add` on `c1` and `c2`. **Measured cost ≈ 13k gas per accumulate step (2 point-adds + SSTORE)** — see `spike/GATE.md`. Far under the ~500k budget. `_add` uses the bigModExp precompile (0x05) for inversion (`expmod`, `:177`).

### Q7 — Proof-gen latency (this machine)

- eERC ships **prebuilt** circuit artifacts (`circom/build/{registration,transfer,mint,withdraw,burn}/*.wasm,*.zkey,*_verification_key.json`) — register/wrap/transfer proofs can be generated with snarkjs directly, no recompile.
- Our `depth_pocd` (single-sum PoCD) compiles to **~12k non-linear constraints**; full ptau(2^15)+setup+prove+verify latency recorded in `spike/GATE.md`.
- Toolchain: circom 2.2.3, snarkjs (global), Foundry (solc 0.8.27), Node v26.

---

---

## ⚠️ Critical gotcha — committed verifiers ≠ shipped zkeys

The repo's committed `contracts/verifiers/*CircuitGroth16Verifier.sol` do **NOT** match the shipped `circom/build/*/*.zkey`. A proof generated with the shipped zkey verifies offline against the shipped `*_verification_key.json` but the committed verifier returns `false` on-chain (→ `InvalidProof()`, selector `0x09bde339`).

**Fix (done):** export fresh verifiers *from the shipped zkeys* and deploy those.
```
snarkjs zkey export solidityverifier circom/build/<c>/<c>.zkey  contracts/src/verifiers/eerc/<Name>Gen.sol
```
See `contracts/src/verifiers/eerc/*Gen.sol` and `script/DeployEERC.s.sol`. Always regenerate verifiers from the exact zkey used for proving.

## D1 e2e result — PASS ✅

`packages/eerc-node/src/e2e_register_wrap.mjs` against the Anvil deployment:
- register admin/A/B (registration proofs, prebuilt artifacts) — OK
- `setAuditorPublicKey(admin)` — auditor set
- mint + `deposit` (converter wrap) — A's eGCT decrypts to the deposited amount
- **encrypted `transfer` A→B (32-signal transfer proof, ~1.08M gas)** — B's and A's post-transfer balances decrypt to the exact expected values.

Node crypto lives in `packages/eerc-node` (`eerc.mjs`: genUser, registrationHash=`poseidon3([chainId, formattedPriv, eoa])`, `processPoseidonEncryption`, `encryptMessage`, `genRegistrationProof`, `genTransferProof`, `decryptEGCT`/`bsgs`) using the SAME libs as eERC (`@zk-kit/baby-jubjub`, `maci-crypto`, `poseidon-lite`). **BSGS note:** eGCT ElGamal decryption to a full 6-decimal balance (e.g. 1e9) needs a large BSGS table; the admin service should decrypt large balances via the Poseidon `balancePCT` (`decryptPCT`) and reserve BSGS for the small per-tick auction aggregates.

## ⚠️ Array PoCD verifier exceeds EIP-170

The combined 37-tick DepthCurve verifier (`DepthPoCDArrayVerifier`, **372 public signals**) compiles to **~62KB**, over the EIP-170 24576-byte limit. It is **proven correct on-chain in the test suite** (`test/MONIAOracleArrayIntegration.t.sol` — real verifier + real accumulators, ~4.1M gas) and deploys fine on **Anvil launched with `--code-size-limit`**. Forge's linker refuses to broadcast an oversized contract, so `scripts/deploy_local.sh` **pre-deploys it via `cast`** (Anvil accepts it) and `DeployAll` references the address through the small `PoCDVerifierAdapter`.

**Fuji path (deferred, README §15):** split into bid/ask (2 proofs, 187 signals each) or a Poseidon-hash-committed variant (~78 signals) to get under EIP-170. Documented as the next step; does not diminish the proven cryptography.

## Deployment order (converter mode; DEMO/PROD profiles)

1. `TestUSDC` (ERC-20, 6 decimals, faucet) — our wrapped asset.
2. eERC verifiers (reuse `contracts/verifiers/*Groth16Verifier.sol` from the submodule) + `BabyJubJub` library.
3. `Registrar(registrationVerifier)`.
4. `EncryptedERC` (converter mode, `decimals=6`, verifiers, registrar).
5. Admin EOA registers in Registrar → `EncryptedERC.setAuditorPublicKey(adminEOA)`.
6. Our verifiers (`DepthPoCDVerifier`, `CollateralSolvencyVerifier`).
7. `MemberRegistry` → `AuctionHouse` → `MONIAOracle` → `CollateralVault` → `LoanBook`, then one-time wiring setters (self-locking).

## SDK note

Settlement/registration client (dashboard) uses `@avalabs/eerc-sdk` **v1.0.2** (React hooks: `useEERC`, `useEncryptedBalance`). Node services use `packages/eerc-node` (`elgamal.mjs` + snarkjs) — **never** the React hooks.
