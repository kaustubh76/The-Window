# THE WINDOW — Demo Video Script (~3:00)

> Goal: judges remember a **product with a thesis**, not an implementation. The arc:
> a story they already believe → a market running LIVE without you → one crypto
> "impossible" moment → an interactive 403 → an honest close. You never say
> "we implemented" — you say "watch it happen."

**Golden rules**
- Never narrate UI mechanics ("here I click…"). Narrate **meaning**; let the cursor do the mechanics.
- Every claim on screen within 2 seconds of saying it. No claim without pixels.
- The market is ALIVE — let epochs tick and toasts land on camera. Dead air with a live market beats talking over a static slide.
- Speak at ~140 wpm. The script below is ~430 spoken words = ~3:00. Rehearse with a timer; cut the marked OPTIONAL scene first if you run long.

---

## Pre-flight (15 minutes before recording — do not skip)

1. `gh run list --workflow fuji-drivers` → an active run (market advancing). If not: `gh workflow run fuji-drivers`.
2. Warm every service so nothing cold-starts on camera:
   `curl https://window-indexer-w3pv.onrender.com/health` · `curl https://window-control-opuo.onrender.com/health` · `curl https://window-indexer-gated.onrender.com/health`
3. `curl https://window-indexer-w3pv.onrender.com/monia/latest` — note the CURRENT epoch + r\* and update the two numbers in Scene 2's line.
4. Browser tabs, in order (full screen, 100% zoom, bookmarks bar hidden):
   **T1** the-window-five.vercel.app (market home) · **T2** /explorer · **T3** /positions · **T4** /l1 · **T5** testnet.snowtrace.io page for MONIAOracle (`0xD197…CEc2`) · **T6** github.com/kaustubh76/The-Window/actions (fuji-drivers runs).
5. Time the recording to catch a print: epochs are 120s — start Scene 2 ~30s before an epoch closes so a fresh M-ONIA print lands while you talk.

---

## SCENE 1 — The hook (0:00–0:30) · *no product yet*

**Screen:** black title card → tagline fades in: **"The rate is public. The borrowing never was."**

**Voiceover:**
> "In 2008, banks starving for cash refused to borrow from the Fed — because being *seen* borrowing signals distress. That stigma nearly broke the financial system, and the fix was architectural: SOFR publishes the **rate** every day, while the borrowers stay confidential.
> Now — AI agents are about to run treasuries. They'll need overnight credit at machine speed. But on a transparent blockchain, every desperate borrow is world-readable, forever. On a public chain, the machine money market isn't just worse. It's **impossible**."

**Cut on the word "impossible" → straight into the live app.**

---

## SCENE 2 — It's alive (0:30–1:05)

**Screen:** T1 — market home. Epoch countdown ticking, M-ONIA hero number, live tx feed scrolling. DO NOT touch anything for the first 5 seconds — let it move.

**Voiceover:**
> "This is THE WINDOW — a private machine money market, live on Avalanche Fuji **right now**. Nobody is driving this. Every two minutes an auction opens, agents submit bids whose **sizes are encrypted**, and the market prints M-ONIA — the Machine Overnight Index Average — the first benchmark rate for the agent economy.
> It has printed over **⟨1,800⟩ epochs** and settled over **⟨1,800⟩ encrypted loans** autonomously. Every event you see links to a real transaction."

**Action:** click one feed item → Snowtrace opens (T5 adjacent). Hover the tx. Back to T1. If a print lands during this scene, pause one beat and point at it: *"— there. That print just happened."* (This moment wins the video; engineer for it in pre-flight.)

---

## SCENE 3 — The impossible part (1:05–1:50) · *the crypto wow*

**Screen:** T2 /explorer — the split screen: raw on-chain **ciphertexts** per tick on one side, the proven depth curve + r\* on the other.

**Voiceover:**
> "Here's what should be impossible. The left side is what the blockchain sees: ElGamal ciphertexts, added **homomorphically on-chain** — the chain aggregates the entire order book without ever seeing a single number.
> The right side is the print: an accountable administrator decrypts only the **aggregates**, and must post **four Groth16 proofs of correct decryption** — verified **on-chain, every single print** — and the contract **recomputes the clearing rate itself** from the proven curve. If the administrator lies about the rate, the transaction reverts.
> That's the SOFR model, rebuilt in ciphertext: a public benchmark nobody can fake, distilled from borrowing nobody gets to watch."

**Action:** scroll ciphertext list slowly while speaking; end on the depth chart + r\*.

---

## SCENE 4 — Loans in ciphertext (1:50–2:10) · *OPTIONAL — cut first if long*

**Screen:** T3 /positions — a loan row with its lifecycle (locked → active → repaid); one defaulted row.

**Voiceover:**
> "Matched loans settle the same way: collateral locked with a **zero-knowledge solvency proof** — collateral covers 120% of the loan, proven over ciphertexts — funding and repayment as encrypted transfers, and defaulters seized permissionlessly. Amounts never touch the chain in plaintext."

---

## SCENE 5 — The L1: hiding participation itself (2:10–2:40)

**Screen:** T4 /l1 — read-gate demonstrator.

**Voiceover:**
> "One leak remains on any public chain: **participation** — and in money markets, the stigma signal *is* participation. So we built the bonus track: a permissioned Avalanche L1 where **membership is chain access**. eERC hides the amount; the L1 hides that you were ever here.
> This isn't a slide — watch:"

**Action (silent, 4 seconds):** click **Outsider** → live **403 · read refused** lands. Click **Member** → live **200 · members visible**. Point at nothing; the red/green does the work.

**Voiceover:**
> "A real server, gated by the real on-chain member registry. And one `removeMember` revokes everything **atomically** — market, token, network, even the right to observe."

---

## SCENE 6 — The close (2:40–3:00)

**Screen:** back to T1, market still ticking. Then title card returns.

**Voiceover:**
> "No mocks anywhere in the live path. An honest trust model — an accountable auditor, exactly like SOFR, stated proudly, never hidden. And a market that's been proving itself on-chain every two minutes, all week, with no one watching over it.
> Machines will need to borrow. They will refuse to be watched doing it.
> **The rate is public. The borrowing never was.**"

**Hold the tagline 3 seconds. End.**

---

## Delivery notes

- **Energy curve:** calm gravity in Scene 1 → quiet confidence in Scene 2 → controlled excitement at Scene 3's "verified on-chain, every single print" → let Scene 5's clicks breathe in silence → slow down for the final tagline. The tagline is the last thing they hear; do not rush it.
- **The two numbers** in Scene 2 (⟨…⟩): pull live values in pre-flight step 3 and round DOWN so they're still true at watch time.
- If a Render service cold-starts on camera despite pre-flight: don't apologize, don't wait — the /l1 panel says "indexer waking"; say *"free-tier infra waking up — the chain underneath never sleeps"* and move on. Honesty plays as strength.
- Record screen at 1080p+, system fonts crisp, cursor smooth and SLOW. Two takes minimum; splice the best print-landing moment.
