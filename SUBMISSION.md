# Submission checklist — Avalanche Team1 India Speedrun "Privacy on Avalanche"

Deadline: **July 19, 2026, 03:29 IST** · Portal: Avalanche Builder Hub (the event page).

## What to submit (mandatory)

- [ ] **GitHub repository**: https://github.com/kaustubh76/The-Window
      — ⚠️ make it **PUBLIC** first: `gh repo edit kaustubh76/The-Window --visibility public --accept-visibility-change-consequences`
      (or GitHub → Settings → General → Danger Zone → Change visibility). Everything is
      pushed and secrets-audited (only public Anvil test keys are committed; the live
      auditor scalar exists solely in the gitignored `.env`).
- [ ] **Pitch slides**: export `pitch/PITCH.md` → PDF and upload:
      `npx @marp-team/marp-cli pitch/PITCH.md --pdf --allow-local-files -o pitch/PITCH.pdf`
- [ ] **Team members** added on the Builder Hub event page.

## Supporting links to paste into the submission form

| | |
|---|---|
| Live app (Fuji) | https://the-window-five.vercel.app |
| Read API | https://window-indexer.onrender.com/monia/latest |
| AuctionHouse (Snowtrace) | https://testnet.snowtrace.io/address/0xd001d287d7e62fE1118C42E49E3fe461e010a71e |
| MONIAOracle (Snowtrace) | https://testnet.snowtrace.io/address/0xD1979c145d70009e6D84AB82A590E13a0026CEc2 |
| One-liner | Private machine money market on Avalanche: encrypted eERC auctions print M-ONIA — a ZK-proven benchmark rate. The rate is public. The borrowing never was. |

## Event-rule compliance notes

- **Built entirely in-window**: first commit 2026-07-10, all work during the Speedrun
  (no prior-project delineation needed).
- **Technologies**: BOTH tracks — eERC (converter mode, deep integration, own circuits)
  AND a permissioned Avalanche L1 (`thewindowl1`, TxAllowList synced from
  MemberRegistry — `demo/run_l1.sh`, `notes/09`).
- **Fuji demo**: live + autonomous (epochs advance while `demo/run_fuji.sh` drivers run
  on the operator machine; the hosted site always serves live Fuji state).
- **Confidential value moving on-chain, live**: encrypted bids accumulate
  homomorphically on-chain every epoch; per-print 4×Groth16 PoCD verified on-chain
  (~4.4M gas); loans cycle borrow → repay / default → seize with encrypted amounts.

## Before the judging session (day-of runbook)

1. Start the drivers: `bash demo/run_fuji.sh` (auction advances every 120 s).
2. Sanity: `curl https://window-indexer.onrender.com/health` — `lastBlock` near Fuji head;
   open the live app, check the "Live on-chain activity" feed shows fresh Snowtrace txs.
3. If the public Fuji RPC rate-limits the drivers (500s in `/tmp/window_fuji_*.log`),
   restart `run_fuji.sh` — or set a dedicated RPC in `RPC_LOCAL`.
4. Optional encore: the permissioned L1 — `avalanche blockchain deploy thewindowl1 --local`
   then `RPC_L1=<rpc> make l1` (proof script prints PASS lines: non-member chain-blocked,
   member transacts, auction alive).
5. Fallback with zero infra: `make demo` (local Anvil, real proofs, no secrets).
