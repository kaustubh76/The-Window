import clsx from 'clsx';
import { useUiStore } from '../stores/useUiStore';
import type { Profile } from '../config';

const OPTIONS: Profile[] = ['DEMO', 'PROD'];

// DEMO (seconds) / PROD (hours) segmented control. Demo mode is a first-class config.
export default function ProfileSwitch() {
  const profile = useUiStore((s) => s.profile);
  const setProfile = useUiStore((s) => s.setProfile);

  return (
    <div
      className="inline-flex items-center gap-0.5 bg-white/[0.03] rounded-lg p-0.5 border border-white/[0.06]"
      role="radiogroup"
      aria-label="Time profile"
    >
      {OPTIONS.map((opt) => {
        const active = profile === opt;
        return (
          <button
            key={opt}
            role="radio"
            aria-checked={active}
            onClick={() => setProfile(opt)}
            className={clsx(
              'px-2.5 py-1 rounded-md text-[11px] font-semibold num tracking-wide transition-all duration-200',
              active
                ? 'bg-benchmark-500/20 text-benchmark-300 shadow-inner-glow'
                : 'text-gray-500 hover:text-gray-300',
            )}
            title={opt === 'DEMO' ? 'Seconds — epoch 60s, tenor 5m' : 'Hours — epoch 1h, tenor 6h'}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
