# ROADMAP — out of scope for the hackathon

Everything below is **deliberately excluded** from the hackathon build (README §1.4 scope discipline). It is recorded here so the scope of the shipped system stays honest and small. A finished small build wins; a 70%-finished ambitious one reads as broken.

## Protocol / markets
- **Term (non-overnight) tenors.** Only overnight-style, single fixed tenor ships (6h PROD / 5min DEMO).
- **Variable haircut schedules.** Fixed 120% haircut only. No risk-based or per-asset haircuts.
- **Receivables / non-cash collateral.** Cash-secured only (encrypted wrapped-USDC). No price oracles, no liquidation engine — a missed deadline block is the only default condition.
- **Multi-asset support.** Single settlement asset (eERC-wrapped TestUSDC, converter mode).
- **Secondary loan markets.** No trading/assignment of loan positions.
- **Governance tokens / DAO.** None. The administrator is a rotatable, accountable role, not a token-governed one.
- **Market-making strategy.** Agent bots are scripted demonstrations of member behavior, not a production MM.

## Cryptography / trust
- **Removing the administrator's decryption ability.** Out of scope by design — the SOFR model *requires* an accountable administrator (see METHODOLOGY §4). Future: threshold/MPC auditor key so no single party holds it.
- **Receipt-freeness & timing-analysis resistance.** Non-goals (a member can voluntarily reveal their own bid; submission timing is public).
- **Network-level privacy.** Out of scope (member addresses are visible).
- **Contract-enforced transfer magnitudes.** Funding/repay magnitude is auditor-attested; a future eERC primitive exposing a verifiable transfer-amount hook could make it contract-enforced.

## Infrastructure (stretch, not core)
- **Permissioned L1 deployment.** `avalanche-cli` local/testnet L1 with a transaction allowlist wired to `MemberRegistry` membership — a roadmap slide, not part of the Fuji core build. The `bjjPubKeyRef` in `MemberRegistry` is the intended allowlist source.
- **Auditor key rotation ceremony.** eERC supports rotation; a production runbook (schedule, disclosure, re-encryption) is future work.
- **Production indexer / HA services.** The hackathon indexer is single-node SQLite/JSON; production would need a durable, replicated event store.
