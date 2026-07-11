import { useEffect } from 'react';
import { ADAPTER_MODE } from '../config';
import { useAdapterStore } from '../stores/useAdapterStore';

// PHASE 8 — mount once (live mode) to bridge the eERC React SDK into the LiveAdapter.
// @avalabs/eerc-sdk is hooks-only, so proof-bearing writes + encrypted-balance decryption
// must run inside React here. Wiring steps (once the SDK package is confirmed & installed):
//
//   const { useEERC } = await import('@avalabs/eerc-sdk');
//   const eerc = useEERC(publicClient, walletClient, EERC_ADDR, circuitURLs);
//   const enc  = useEncryptedBalance(eerc, TESTUSDC_ADDR);
//   adapter.attachEerc({
//     register:  (a, onP) => runProof(onP, () => eerc.register()),
//     wrap:      (a, amt, onP) => runProof(onP, () => enc.deposit(amt)),
//     unwrap:    (a, amt, onP) => runProof(onP, () => enc.withdraw(amt)),
//     transfer:  (from, to, amt, ref, onP) => runProof(onP, () => enc.transfer(to, amt, ref)),
//     encryptedBalance: (a) => enc.egct(a),
//     decryptBalance:   (a) => enc.decryptedBalance(),
//   });
//
// Until then this is a no-op so the build stays green (verify-first: never invent the SDK API).
export function useEercBridge() {
  const init = useAdapterStore((s) => s.init);
  useEffect(() => {
    if (ADAPTER_MODE !== 'live') return;
    let alive = true;
    init().then((a) => {
      if (!alive || !a || a.mode !== 'live') return;
      // const live = a as unknown as LiveAdapter; live.attachEerc(bridge)  ← wire when SDK confirmed
      if (import.meta.env.DEV) {
        console.info('[eERC bridge] live mode — attach @avalabs/eerc-sdk in hooks/useEercBridge.ts (see wiring notes).');
      }
    });
    return () => {
      alive = false;
    };
  }, [init]);
}
