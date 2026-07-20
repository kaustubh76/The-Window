import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Web3Provider } from './providers/Web3Provider';
import App from './App';
import './index.css';

// Wallet browser extensions (Core/MetaMask/…) inject their own `inpage.js` into every page and can
// emit unhandled promise rejections from their internal broadcast messaging — most often when more
// than one wallet extension is installed and they race over window.ethereum. It's extension-internal
// noise (the app makes no wallet RPC calls), so silence ONLY that exact signature so it can't mask
// real app errors. Belt-and-suspenders; the real fix is not probing the extension (see Web3Provider).
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { stack?: string; message?: string } | string | undefined;
    const text = typeof r === 'string' ? r : `${r?.stack ?? ''} ${r?.message ?? ''}`;
    if (/inpage\.js|ExtendedBroadcastMessage/.test(text)) e.preventDefault();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Web3Provider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Web3Provider>
  </StrictMode>,
);
