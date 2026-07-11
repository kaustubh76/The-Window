import clsx from 'clsx';

// Uses the existing .skeleton shimmer. Shown only during the sub-second adapter init —
// NOT during the honest pre-first-print period (that shows a real "—").
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} aria-hidden="true" />;
}

export function MarketHeroSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading market">
      <div className="card !p-7">
        <div className="grid lg:grid-cols-[1.6fr_1fr] gap-6">
          <div className="space-y-4">
            <Skeleton className="h-3 w-64" />
            <Skeleton className="h-16 w-56" />
            <Skeleton className="h-5 w-40" />
          </div>
          <div className="space-y-3 lg:border-l lg:border-white/[0.06] lg:pl-6">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-full rounded-xl" />
          </div>
        </div>
      </div>
      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-6">
        <Skeleton className="h-72 rounded-xl" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
