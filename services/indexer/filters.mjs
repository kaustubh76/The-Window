// The event filter set the indexer replays into state — shared by the indexer's incremental log
// store AND scripts/gen_indexer_snapshot.mjs (which bakes a fast-resume snapshot). Kept in its own
// module because index.mjs starts an HTTP server on import, so the generator can't import it.
// `H` is a handles() bundle (see services/lib/chain.mjs); each entry is [contract, filter].
export function buildFilters(H) {
  return {
    epochOpened: [H.auction, H.auction.filters.EpochOpened()],
    epochClosed: [H.auction, H.auction.filters.EpochClosed()],
    epochPrinted: [H.auction, H.auction.filters.EpochPrinted()],
    askSubmitted: [H.auction, H.auction.filters.AskSubmitted()],
    bidSubmitted: [H.auction, H.auction.filters.BidSubmitted()],
    ratePrinted: [H.oracle, H.oracle.filters.RatePrinted()],
    noTrade: [H.oracle, H.oracle.filters.NoTrade()],
    loanCreated: [H.book, H.book.filters.LoanCreated()],
    funded: [H.book, H.book.filters.Funded()],
    repaid: [H.book, H.book.filters.Repaid()],
    bookSeized: [H.book, H.book.filters.Seized()],
    vaultLockRequested: [H.vault, H.vault.filters.LockRequested()],
    vaultLocked: [H.vault, H.vault.filters.Locked()],
    vaultReleased: [H.vault, H.vault.filters.Released()],
    vaultSeized: [H.vault, H.vault.filters.Seized()],
    memberAdded: [H.registry, H.registry.filters.MemberAdded()],
    memberRemoved: [H.registry, H.registry.filters.MemberRemoved()],
  };
}

// High-volume per-epoch filters — the snapshot captures only a RECENT window of these (old bids
// only affect /bids history for ancient epochs, never epochs/prints/loans/clock). Everything else
// is structural (low volume) and captured in full so loans/members/prints reconstruct exactly.
export const HIGH_VOLUME_KEYS = ["askSubmitted", "bidSubmitted"];
