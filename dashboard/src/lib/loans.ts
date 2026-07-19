import type { Loan } from './adapter/types';

// A matched loan stays "Pending" forever if it's never collateralized+funded (the indexer derives
// status purely from Funded/Repaid/Seized events). In DEMO the epoch is ~2 min with a ~2-min tenor,
// so a Pending loan more than a few epochs behind the current epoch can never still be funded — it's
// an abandoned request. Treat those as EXPIRED so the UI stops offering a Lock/Fund CTA that would
// revert on-chain with BadState().
export const STALE_PENDING_EPOCHS = 3;

export function isPendingStale(loan: Loan, currentEpoch?: number): boolean {
  return loan.status === 'Pending' && currentEpoch != null && currentEpoch - loan.epoch >= STALE_PENDING_EPOCHS;
}
