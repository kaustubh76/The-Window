import { useState } from 'react';
import { Eye, Loader2 } from 'lucide-react';

// Owner-only self-decrypt (client-side BSGS). Reveals YOUR OWN value only — never others'.
export function RevealButton({ onReveal, className }: { onReveal: () => Promise<void>; className?: string }) {
  const [loading, setLoading] = useState(false);
  return (
    <button
      onClick={async () => {
        setLoading(true);
        try {
          await onReveal();
        } finally {
          setLoading(false);
        }
      }}
      disabled={loading}
      className={`btn btn-cipher text-xs !px-3 !py-1.5 flex items-center gap-1.5 ${className ?? ''}`}
      title="Decrypt locally with your own key"
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
      Reveal
    </button>
  );
}
