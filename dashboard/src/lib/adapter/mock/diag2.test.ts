import { it } from 'vitest';
import { DemoEngine } from './engine';
import { DEFAULT_SCENARIO } from './scenarios';

it('diag2: normal ticks then a jump', async () => {
  const e = new DemoEngine('DEMO');
  await e.init(DEFAULT_SCENARIO.params, DEFAULT_SCENARIO.name);
  for (let i = 0; i < 150; i++) e.tick(120); // ~18s of normal ticks — fired advances mid-array
  e.tick(50000); // then a catch-up jump past ungenerated epochs
  const cur = e.getEpochClock().epoch;
  const maxSupply2 = e.getDepthCurve(2).reduce((m, d) => (d.supply > m ? d.supply : m), 0n);
  const maxSupplyCur = e.getDepthCurve(cur).reduce((m, d) => (d.supply > m ? d.supply : m), 0n);
  // eslint-disable-next-line no-console
  console.log(
    `after ramp+jump: epoch=${cur} latestRStar=${e.getLatestMonia()?.rStarBps} epoch2maxSupply=${maxSupply2} curMaxSupply=${maxSupplyCur}`,
  );
});
