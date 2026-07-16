import { formatUsdc } from '../../lib/usdc';

// Guided amount input: the bare `.input` + a "Max" quick-fill against the relevant balance
// + a live one-line preview. parseUsdc strips commas, so the Max value round-trips safely.
export function AmountInput({
  value,
  onChange,
  max,
  placeholder = 'Amount (USDC)',
  preview,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  max?: bigint | null;
  placeholder?: string;
  preview?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          className="input num flex-1"
          inputMode="decimal"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
        {max != null && max > 0n && (
          <button
            type="button"
            onClick={() => onChange(formatUsdc(max, { group: false }))}
            disabled={disabled}
            className="btn btn-outline text-xs px-3 whitespace-nowrap"
          >
            Max
          </button>
        )}
      </div>
      {preview && <p className="text-[11px] text-gray-500 mt-1.5 num">{preview}</p>}
    </div>
  );
}
