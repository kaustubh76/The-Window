// Honest-claims guardrail (Readme.md §1.3, §4). The auditor CAN decrypt individual
// amounts — this is the documented SOFR-style trust model. We NEVER claim otherwise.
// A Vitest greps the component source for these phrases and fails the build if present.

export const FORBIDDEN_PHRASES: RegExp[] = [
  /trustless/i,
  /undecryptable/i,
  /unbreakable/i,
  /nobody can (?:see|decrypt)/i,
  /no one can (?:see|decrypt)/i,
  /fully anonymous/i,
];

export interface HonestViolation {
  phrase: string;
  index: number;
}

export function findHonestViolations(text: string): HonestViolation[] {
  const out: HonestViolation[] = [];
  for (const re of FORBIDDEN_PHRASES) {
    const m = re.exec(text);
    if (m) out.push({ phrase: m[0], index: m.index });
  }
  return out;
}

/** The approved framing for the administrator role — use this copy verbatim in UI. */
export const ADMIN_FRAMING = 'a trusted, accountable, rotatable Benchmark Administrator (SOFR / ICE model)';

/** The approved one-liner about what the auditor can see. */
export const AUDITOR_DISCLOSURE =
  'The Benchmark Administrator holds the auditor key and can decrypt individual amounts. The public only ever sees aggregates and the printed rate — each backed by a proof of correct decryption.';

/** Dev-only assertion used by copy-heavy components. */
export function assertHonest(text: string): void {
  if (import.meta.env.DEV) {
    const v = findHonestViolations(text);
    if (v.length) {
      console.error(`[honest-claims] forbidden phrase(s): ${v.map((x) => x.phrase).join(', ')}`);
    }
  }
}
