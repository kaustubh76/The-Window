import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight } from 'lucide-react';

// Actionable empty state — never a dead sentence. Always offers the next step.
export function EmptyState({
  icon: Icon,
  title,
  body,
  cta,
}: {
  icon?: LucideIcon;
  title: string;
  body?: string;
  cta?: { label: string; to?: string; onClick?: () => void };
}) {
  return (
    <div className="flex flex-col items-center text-center py-8 px-4">
      {Icon && (
        <div className="w-11 h-11 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mb-3">
          <Icon className="w-5 h-5 text-gray-500" />
        </div>
      )}
      <div className="text-sm font-medium text-gray-300">{title}</div>
      {body && <p className="text-xs text-gray-500 mt-1 max-w-xs">{body}</p>}
      {cta &&
        (cta.to ? (
          <Link to={cta.to} className="btn btn-primary mt-4 inline-flex items-center gap-2 text-sm">
            {cta.label} <ArrowRight className="w-4 h-4" />
          </Link>
        ) : (
          <button onClick={cta.onClick} className="btn btn-primary mt-4 inline-flex items-center gap-2 text-sm">
            {cta.label} <ArrowRight className="w-4 h-4" />
          </button>
        ))}
    </div>
  );
}
