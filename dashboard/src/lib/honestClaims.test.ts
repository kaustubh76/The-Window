import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findHonestViolations } from './honestClaims';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); // .../src

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

describe('honest-claims guardrail (CI)', () => {
  const files = walk(SRC).filter((f) => !f.endsWith('honestClaims.ts') && !f.endsWith('honestClaims.test.ts'));

  it('no forbidden privacy phrases in any source file', () => {
    const violations: string[] = [];
    for (const f of files) {
      const v = findHonestViolations(fs.readFileSync(f, 'utf8'));
      if (v.length) violations.push(`${path.relative(SRC, f)}: ${v.map((x) => x.phrase).join(', ')}`);
    }
    expect(violations).toEqual([]);
  });

  it('the M-ONIA ticker renders a PoCD badge', () => {
    const ticker = fs.readFileSync(path.resolve(SRC, 'components/ui/MoniaTicker.tsx'), 'utf8');
    expect(ticker).toMatch(/PoCDBadge/);
  });

  it('the administrator is framed as accountable, not trustless', () => {
    const claims = fs.readFileSync(path.resolve(SRC, 'lib/honestClaims.ts'), 'utf8');
    expect(claims).toMatch(/accountable/i);
    expect(claims).toMatch(/can decrypt individual amounts/i);
  });

  // Class-of-bug guard: the default deployment is MOCK, so any component that asserts
  // real on-chain activity ("Real Fuji transactions", a pulsing live badge) must gate that
  // copy on ADAPTER_MODE — otherwise a mock build makes a live claim it can't back.
  it('live-only "Real Fuji" copy is gated on ADAPTER_MODE', () => {
    const LIVE_ONLY = /Real Fuji transactions/;
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      if (LIVE_ONLY.test(src)) {
        expect(src, `${path.relative(SRC, f)} makes a live claim without gating on ADAPTER_MODE`).toMatch(/ADAPTER_MODE/);
      }
    }
  });
});
