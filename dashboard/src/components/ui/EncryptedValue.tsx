import clsx from 'clsx';
import { Lock } from 'lucide-react';
import type { Ciphertext } from '../../lib/adapter/types';
import { formatUsdc } from '../../lib/usdc';
import { ENCRYPTED_GLYPHS } from '../../constants/ui';

// The core identity element. If the viewer is entitled (value.clear present), show the
// amount in gold-ish mono; otherwise a cyan locked chip. NEVER a hover-reveal on others'
// values — reveal is a separate, owner-only action.
export function EncryptedValue({
  value,
  suffix = 'USDC',
  size = 'md',
  className,
}: {
  value: Ciphertext | undefined;
  suffix?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const textSize = { sm: 'text-xs', md: 'text-sm', lg: 'text-lg' }[size];

  if (value?.clear !== undefined) {
    return (
      <span className={clsx('num tabular-nums text-white', textSize, className)}>
        {formatUsdc(value.clear)}
        {suffix && <span className="text-gray-500 ml-1 text-[0.85em]">{suffix}</span>}
      </span>
    );
  }

  return (
    <span
      className={clsx('chip-encrypted', textSize, className)}
      title="Encrypted. Visible only to the owner and the Benchmark Administrator (auditor)."
    >
      <Lock className="w-3 h-3" />
      {ENCRYPTED_GLYPHS}
    </span>
  );
}
