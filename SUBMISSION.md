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
| Read API | https://window-indexer-w3pv.onrender.com/monia/latest |
| AuctionHouse (Snowtrace) | https://testnet.snowtrace.io/address/0xd001d287d7e62fE1118C42E49E3fe461e010a71e |
| MONIAOracle (Snowtrace) | https://testnet.snowtrace.io/address/0xD1979c145d70009e6D84AB82A590E13a0026CEc2 |
| One-liner | Private machine money market on Avalanche: encrypted eERC auctions print M-ONIA — a ZK-proven benchmark rate. The rate is public. The borrowing never was. |

## Event-rule compliance notes

- **Built entirely in-window**: first commit 2026-07-10, all work during the Speedrun
  (no prior-project delineation needed).
- **Technologies**: BOTH tracks — eERC (converter mode, deep integration, own circuits)
  AND a permissioned Avalanche L1 (`thewindowl1`, TxAllowList synced from
  MemberRegistry — `demo/run_l1.sh`, `notes/09`).
- **Fuji demo**: live + autonomous 24/7 — the drivers run in the cloud (chained GitHub
  Actions jobs, `.github/workflows/fuji-drivers.yml`; `notes/08`), so epochs advance with
  no machine of ours running; the hosted site always serves live Fuji state.
- **Confidential value moving on-chain, live**: encrypted bids accumulate
  homomorphically on-chain every epoch; per-print 4×Groth16 PoCD verified on-chain
  (~4.4M gas); loans cycle borrow → repay / default → seize with encrypted amounts.

## Before the judging session (day-of runbook)

1. Drivers are already running in the cloud (`gh run list --workflow fuji-drivers` shows
   an active run; auction advances every ~120 s). Manual kick if ever needed:
   `gh workflow run fuji-drivers`.
2. Sanity: `curl https://window-indexer-w3pv.onrender.com/health` — `lastBlock` near Fuji head;
   open the live app, check the "Live on-chain activity" feed shows fresh Snowtrace txs.
3. If the public Fuji RPC rate-limits the drivers (500s in the GH run log), re-dispatch
   the workflow — or fall back to local `bash demo/run_fuji.sh` (disable the workflow
   first: two drivers sharing keys race nonces).
4. Optional encore: the permissioned L1 — `avalanche blockchain deploy thewindowl1 --local`
   then `RPC_L1=<rpc> make l1` (proof script prints PASS lines: non-member chain-blocked,
   member transacts, auction alive).
5. Fallback with zero infra: `make demo` (local Anvil, real proofs, no secrets).
