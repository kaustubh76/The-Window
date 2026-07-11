import { EyeOff, Eye, ShieldCheck, Gavel, Landmark } from 'lucide-react';
import { Card, CardHeader } from '../components/ui/Card';
import { HonestClaimsCallout } from '../components/ui/HonestClaimsCallout';
import { ADMIN_FRAMING } from '../lib/honestClaims';
import { TIME_PROFILES, HAIRCUT_PCT, RATE_MIN_BPS, RATE_MAX_BPS, TICK_BPS, TICK_COUNT, USDC_DECIMALS } from '../config';

const hidden = [
  'Bid sizes and ask sizes',
  'Loan sizes and collateral amounts',
  'Repayment amounts',
  'Every account’s encrypted balance',
  'An individual’s borrowing history (the sequence)',
];
const visible = [
  'Rate ticks bid at (not by whom, at what size)',
  'Member addresses (eERC hides amounts, not addresses)',
  'Epoch timing and M-ONIA prints',
  'Aggregate depth per tick (PoCD-backed)',
  'Loan count and lifecycle events (not sizes)',
];

function Param({ k, prod, demo }: { k: string; prod: string; demo: string }) {
  return (
    <tr className="border-b border-white/[0.04]">
      <td className="py-2 text-sm text-gray-300">{k}</td>
      <td className="py-2 text-sm num text-benchmark-300">{prod}</td>
      <td className="py-2 text-sm num text-cipher-300">{demo}</td>
    </tr>
  );
}

export default function Methodology() {
  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Methodology</h1>
        <p className="text-gray-400 text-sm mt-1">
          How M-ONIA — the Machine Overnight Index Average — is discovered, printed, and proven.
        </p>
      </div>

      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Gavel className="w-4 h-4 text-benchmark-400" /> Uniform-price auction</span>} />
        <div className="text-sm text-gray-400 space-y-2 leading-relaxed">
          <p>
            Each epoch, lenders submit <span className="text-signal-up">asks</span> (a minimum acceptable rate) and borrowers submit{' '}
            <span className="text-benchmark-300">bids</span> (a maximum acceptable rate). The <em>rate tick</em> is public; the{' '}
            <span className="text-cipher-300">size is an encrypted eERC ciphertext</span>. The contract homomorphically accumulates
            Σ Enc(size) per tick per side — never decrypting individual orders.
          </p>
          <p>
            The clearing rate <span className="rate-print">r*</span> is the crossing of cumulative supply and demand. All fills clear at
            r* (uniform price); pro-rata allocation at the marginal tick. Tie-break: the <strong>lowest crossing tick</strong>. If the curves
            don’t cross, the epoch prints “no trade” and M-ONIA carries the last print, flagged stale.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-signal-up" /> Proof of correct decryption (PoCD)</span>} />
        <p className="text-sm text-gray-400 leading-relaxed">
          Every print carries a Groth16 <strong>PoCD</strong>: a zero-knowledge proof that the published per-tick depth curve is the true
          decryption of the on-chain ciphertext accumulators, under the auditor’s key. The proof is bound to on-chain state — not to
          admin-supplied numbers — and verifies on-chain (~266k gas). This is the trust anchor of the benchmark: you don’t trust the
          administrator’s arithmetic, you verify it.
        </p>
      </Card>

      <div className="grid sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader title={<span className="flex items-center gap-2 text-cipher-300"><EyeOff className="w-4 h-4" /> Hidden from the public</span>} />
          <ul className="space-y-1.5">
            {hidden.map((h) => (
              <li key={h} className="text-sm text-gray-400 flex items-start gap-2">
                <span className="text-cipher-500 mt-1">•</span> {h}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title={<span className="flex items-center gap-2 text-benchmark-300"><Eye className="w-4 h-4" /> Visible to the public</span>} />
          <ul className="space-y-1.5">
            {visible.map((v) => (
              <li key={v} className="text-sm text-gray-400 flex items-start gap-2">
                <span className="text-benchmark-500 mt-1">•</span> {v}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Landmark className="w-4 h-4 text-benchmark-400" /> The administrator</span>} />
        <p className="text-sm text-gray-400 leading-relaxed">
          The market is run by {ADMIN_FRAMING}. The administrator holds the eERC auditor key and can decrypt individual amounts — exactly
          as a benchmark administrator (ICE / SOFR) sees confidential transaction reports. Accountability is structural: every print carries
          a PoCD, the role publishes only aggregates, and the auditor key is rotatable.
        </p>
        <div className="mt-4">
          <HonestClaimsCallout compact />
        </div>
      </Card>

      <Card>
        <CardHeader title="Parameters" subtitle="Demo mode is a first-class config" />
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 border-b border-white/[0.06]">
                <th className="py-2 font-medium">Parameter</th>
                <th className="py-2 font-medium">PROD</th>
                <th className="py-2 font-medium">DEMO</th>
              </tr>
            </thead>
            <tbody>
              <Param k="Epoch length" prod={TIME_PROFILES.PROD.epochLabel} demo={TIME_PROFILES.DEMO.epochLabel} />
              <Param k="Loan tenor" prod={TIME_PROFILES.PROD.tenorLabel} demo={TIME_PROFILES.DEMO.tenorLabel} />
              <Param k="Rate band" prod={`${RATE_MIN_BPS / 100}%–${RATE_MAX_BPS / 100}%`} demo={`${RATE_MIN_BPS / 100}%–${RATE_MAX_BPS / 100}%`} />
              <Param k="Tick size" prod={`${TICK_BPS} bps · ${TICK_COUNT} ticks`} demo={`${TICK_BPS} bps · ${TICK_COUNT} ticks`} />
              <Param k="Haircut" prod={`${HAIRCUT_PCT}%`} demo={`${HAIRCUT_PCT}%`} />
              <Param k="Settlement" prod={`eERC-wrapped TestUSDC (${USDC_DECIMALS}dp)`} demo={`eERC-wrapped TestUSDC (${USDC_DECIMALS}dp)`} />
              <Param k="Min bid" prod="10 USDC" demo="1 USDC" />
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
