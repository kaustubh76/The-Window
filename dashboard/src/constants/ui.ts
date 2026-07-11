// UI timing + presentation constants.

export const ANIMATION_DELAY_BASE = 0.05;
export const ANIMATION_DELAY_STAGGER = 0.05;

export const MARKET_POLL_MS = 2_000;

// how a ciphertext renders when the viewer is NOT entitled to the value
export const ENCRYPTED_GLYPHS = '•••• ••';

export const EXPLORER_TX = (hash: string, base: string) => `${base}/tx/${hash}`;
export const EXPLORER_ADDR = (addr: string, base: string) => `${base}/address/${addr}`;
