import { Link } from 'react-router-dom';
import { Construction, ArrowRight } from 'lucide-react';

// Temporary themed placeholder used during scaffolding. Each page replaces this
// with its real implementation in later build phases.
export default function PageStub({
  title,
  subtitle,
  phase,
}: {
  title: string;
  subtitle: string;
  phase: string;
}) {
  return (
    <div className="max-w-2xl mx-auto animate-fade-in-up">
      <div className="card card-shine text-center py-14">
        <div className="w-14 h-14 rounded-2xl bg-benchmark-500/10 border border-benchmark-500/20 flex items-center justify-center mx-auto mb-6">
          <Construction className="w-7 h-7 text-benchmark-400" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2 tracking-tight">{title}</h1>
        <p className="text-gray-400 text-sm max-w-md mx-auto leading-relaxed">{subtitle}</p>
        <div className="mt-5 inline-flex items-center gap-2 text-xs text-gray-500 num">
          <span className="w-1.5 h-1.5 rounded-full bg-benchmark-500 animate-pulse-soft" />
          {phase}
        </div>
        <div className="mt-8">
          <Link to="/" className="btn btn-outline inline-flex items-center gap-2">
            Back to Market <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
