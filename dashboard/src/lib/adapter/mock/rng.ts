// Deterministic PRNG (mulberry32). The demo is seeded — never Math.random in domain
// logic — so every playthrough (and every scrub/replay) is byte-identical.

export class Rng {
  private a: number;
  constructor(seed: number) {
    this.a = seed >>> 0;
  }
  /** next float in [0, 1) */
  next(): number {
    this.a |= 0;
    this.a = (this.a + 0x6d2b79f5) | 0;
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** integer in [min, max] inclusive */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }
  bool(pTrue: number): boolean {
    return this.next() < pTrue;
  }
  /** a positive bigint scalar suitable as ElGamal randomness r */
  scalar(): bigint {
    // 52-bit-ish deterministic scalar
    const hi = BigInt(Math.floor(this.next() * 0x1fffff));
    const lo = BigInt(Math.floor(this.next() * 0xffffffff));
    return (hi << 32n) | lo | 1n;
  }
}

/** Derive a stable per-epoch seed from a base seed. */
export function epochSeed(base: number, epoch: number): number {
  // splitmix-ish mix so adjacent epochs diverge
  let x = (base ^ Math.imul(epoch + 1, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}
