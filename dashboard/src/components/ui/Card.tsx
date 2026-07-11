import clsx from 'clsx';
import type { ReactNode } from 'react';

export function Card({
  children,
  className,
  hover,
  shine,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  shine?: boolean;
}) {
  return <div className={clsx('card', hover && 'card-hover', shine && 'card-shine', className)}>{children}</div>;
}

export function CardHeader({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-4">
      <div>
        <h3 className="text-sm font-semibold text-white tracking-tight">{title}</h3>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
