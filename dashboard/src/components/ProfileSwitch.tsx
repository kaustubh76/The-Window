import clsx from 'clsx';
import { useUiStore } from '../stores/useUiStore';
import { useAdapterStore } from '../stores/useAdapterStore';
import { timeProfile, type Profile } from '../config';

const OPTIONS: Profile[] = ['DEMO', 'PROD'];

// DEMO (seconds) / PROD (hours) segmented control. Demo mode is a first-class config.
// Flipping it is the single reactive lever: it updates the shared UI profile (labels, min-bid,
// Diagnostics) AND bridges to the adapter so the mock clock re-paces (live keeps its real clock).
export default function ProfileSwitch() {
  const profile = useUiStore((s) => s.profile);

  const choose = (opt: Profile) => {
    if (opt === profile) return;
    useUiStore.getState().setProfile(opt);
    useAdapterStore.getState().adapter?.setProfile(opt);
  };

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
            onClick={() => choose(opt)}
            className={clsx(
              'px-2.5 py-1 rounded-md text-[11px] font-semibold num tracking-wide transition-all duration-200',
              active
                ? 'bg-benchmark-500/20 text-benchmark-300 shadow-inner-glow'
                : 'text-gray-500 hover:text-gray-300',
            )}
            title={`epoch ${timeProfile(opt).epochLabel}, tenor ${timeProfile(opt).tenorLabel}`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
