import { Landmark } from 'lucide-react';
import { StatTile } from '../components/ui/StatTile';
import { LoanCard } from '../components/ui/LoanCard';
import { HonestClaimsCallout } from '../components/ui/HonestClaimsCallout';
import { usePositionsStore } from '../stores/usePositionsStore';
import { useSessionStore } from '../stores/useSessionStore';
import type { Address } from '../lib/adapter/types';

export default function PositionsPage() {
  const address = useSessionStore((s) => s.address) as Address;
  const { myLoans } = usePositionsStore();

  const live = myLoans.filter((l) => l.status === 'Pending' || l.status === 'Active');
  const settled = myLoans.filter((l) => l.status === 'Repaid' || l.status === 'Defaulted');
  const active = myLoans.filter((l) => l.status === 'Active').length;
  const repaid = myLoans.filter((l) => l.status === 'Repaid').length;
  const defaulted = myLoans.filter((l) => l.status === 'Defaulted').length;

  return (
    <div className="max-w-4xl mx-auto space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Positions</h1>
        <p className="text-gray-400 text-sm mt-1">Your loans — a 6-hour tenor compressed to seconds. Collateralize, fund, repay.</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Active" value={active} accent="cipher" icon={Landmark} />
        <StatTile label="Repaid" value={repaid} accent="up" />
        <StatTile label="Defaulted" value={defaulted} accent="down" />
      </div>

      {myLoans.length === 0 ? (
        <div className="card text-center py-14">
          <p className="text-gray-400 text-sm">No loans yet. Submit bids in the <span className="text-benchmark-400">Auction</span> — matched loans appear here after the next print.</p>
        </div>
      ) : (
        <>
          {live.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-500 mb-3">Open</div>
              <div className="grid sm:grid-cols-2 gap-3">
                {live.map((l) => (
                  <LoanCard key={l.id} loan={l} myAddress={address} />
                ))}
              </div>
            </div>
          )}
          {settled.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-500 mb-3 mt-2">Settled</div>
              <div className="grid sm:grid-cols-2 gap-3">
                {settled.slice(0, 6).map((l) => (
                  <LoanCard key={l.id} loan={l} myAddress={address} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <HonestClaimsCallout compact />
    </div>
  );
}
