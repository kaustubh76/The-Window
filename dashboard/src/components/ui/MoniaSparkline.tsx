// Hand-rolled inline SVG sparkline — no Recharts churn on the always-live ticker.
export function MoniaSparkline({
  values,
  width = 160,
  height = 40,
  color = '#F5A300',
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
  color?: string;
}) {
  const pts = values.filter((v): v is number => v !== null);
  if (pts.length < 2) {
    return <svg width={width} height={height} aria-hidden />;
  }
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 1;
  const stepX = width / (pts.length - 1);
  const y = (v: number) => height - 4 - ((v - min) / range) * (height - 8);
  const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];

  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden>
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${width},${height} L0,${height} Z`} fill="url(#spark-fill)" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={width} cy={y(last)} r="2.5" fill={color} />
    </svg>
  );
}
