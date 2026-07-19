import type { ReactNode } from 'react';
import { Lock, ShieldX } from 'lucide-react';
import { useSessionStore } from '../stores/useSessionStore';
import ConnectWallet from './ConnectWallet';
import type { Persona } from '../lib/adapter/types';

type Need = 'connected' | 'member' | 'admin' | 'keeper';

function Prompt({ icon: Icon, title, body, showConnect }: { icon: typeof Lock; title: string; body: string; showConnect?: boolean }) {
  return (
    <div className="max-w-md mx-auto mt-8 animate-fade-in-up">
      <div className="card text-center py-12">
        <div className="w-14 h-14 rounded-2xl bg-benchmark-500/10 border border-benchmark-500/20 flex items-center justify-center mx-auto mb-6">
          <Icon className="w-7 h-7 text-benchmark-400" />
        </div>
        <h1 className="text-xl font-bold text-white mb-2">{title}</h1>
        <p className="text-gray-400 text-sm max-w-sm mx-auto mb-6">{body}</p>
        {showConnect && <div className="flex justify-center"><ConnectWallet /></div>}
      </div>
    </div>
  );
}

function has(persona: Persona[], role: Persona) {
  return persona.includes(role);
}

export function RoleGate({ need, children }: { need: Need; children: ReactNode }) {
  const { address, persona } = useSessionStore();

  if (!address) {
    return (
      <Prompt
        icon={Lock}
        title="Connect to continue"
        body="Join as a real member — or step in as a demo actor — to access your console, wallet, and positions."
        showConnect
      />
    );
  }
  if (need === 'member' && !(has(persona, 'lender') || has(persona, 'borrower'))) {
    return <Prompt icon={ShieldX} title="Members only" body="This area is for lender and borrower agents. Switch to a member persona to continue." showConnect />;
  }
  if (need === 'admin' && !has(persona, 'admin')) {
    return <Prompt icon={ShieldX} title="Benchmark Administrator only" body="The administrator console requires the auditor role. This is a trusted, accountable, rotatable role." showConnect />;
  }
  if (need === 'keeper' && !has(persona, 'keeper')) {
    return <Prompt icon={ShieldX} title="Keeper only" body="Epoch-close and seize actions require the keeper role." showConnect />;
  }
  return <>{children}</>;
}
