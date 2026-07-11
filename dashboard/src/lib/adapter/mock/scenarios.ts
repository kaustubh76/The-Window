import type { ScenarioParams } from './engine';

export interface Scenario {
  name: string;
  label: string;
  description: string;
  params: ScenarioParams;
}

// Named presets for the demo control bar. All deterministic (seeded).
export const SCENARIOS: Scenario[] = [
  {
    name: 'happy-path',
    label: 'Happy path',
    description: 'Agents bid, M-ONIA prints, loans borrow → repay → collateral released.',
    params: { seed: 1, defaultRate: 0.1 },
  },
  {
    name: 'default-and-seize',
    label: 'Default & seize',
    description: 'A borrower misses the deadline block; the keeper seizes the collateral.',
    params: { seed: 7, defaultRate: 0.18, forceSeizeEpoch: 1 },
  },
  {
    name: 'no-trade',
    label: 'No trade',
    description: 'Supply and demand curves don’t cross; M-ONIA carries the last print (stale).',
    params: { seed: 3, defaultRate: 0.1, noTradeEpoch: 2 },
  },
  {
    name: 'rate-spike',
    label: 'Rate spike',
    description: 'Desperate borrowing pushes the clearing rate sharply higher.',
    params: { seed: 91, defaultRate: 0.14 },
  },
];

export const DEFAULT_SCENARIO = SCENARIOS[0];

export function scenarioByName(name: string): Scenario {
  return SCENARIOS.find((s) => s.name === name) ?? DEFAULT_SCENARIO;
}
