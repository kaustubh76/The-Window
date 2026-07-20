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

  // The verifiability claim is a feature: the live feed must keep saying its txs are
  // real and Snowtrace-checkable — silently losing that copy would drop the
  // proof-in-one-click story the deployment is built around.
  it('the live tx feed keeps its Snowtrace verifiability claim', () => {
    const feed = fs.readFileSync(path.resolve(SRC, 'components/ui/LiveTxFeed.tsx'), 'utf8');
    expect(feed).toMatch(/Real Fuji transactions/);
    expect(feed).toMatch(/Snowtrace/);
  });

  // Single-path architecture lock: the mock adapter was removed — the app has exactly one
  // data path (indexer reads + Control API writes against the real chain). Nothing under
  // src/ may reference the mock again, so a reintroduced simulation can't quietly serve
  // fabricated data under live copy.
  it('no mock-adapter references anywhere in src/', () => {
    const FORBIDDEN = /MockAdapter|DemoEngine|VITE_ADAPTER|adapter\/mock|hasDemoControls|useDemoStore/;
    const hits: string[] = [];
    for (const f of files) {
      if (FORBIDDEN.test(fs.readFileSync(f, 'utf8'))) hits.push(path.relative(SRC, f));
    }
    expect(hits).toEqual([]);
  });
});
