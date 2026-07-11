// Legend for the depth chart: cyan supply (asks) vs gold demand (bids), plus the r* marker.
export function ChartLegend() {
  return (
    <div className="flex items-center gap-4 text-[11px] text-gray-500 mb-1 flex-wrap">
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3 h-[3px] rounded-full bg-cipher-500" /> Supply · asks
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3 h-[3px] rounded-full bg-benchmark-500" /> Demand · bids
      </span>
      <span className="inline-flex items-center gap-1.5 sm:ml-auto">
        <span className="w-3 border-t border-dashed border-white/60" /> r* clearing rate
      </span>
    </div>
  );
}
