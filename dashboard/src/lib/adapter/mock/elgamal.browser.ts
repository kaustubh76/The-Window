// Browser port of packages/eerc-node/src/elgamal.mjs — ElGamal over BabyJubJub.
// Lets the mock emit GENUINE EGCT ciphertexts (c1,c2) for the Explorer, aggregate them
// homomorphically, and (BSGS) decrypt aggregate sums — with no backend. circomlibjs'
// curve matches the on-chain eERC BabyJubJub bit-for-bit.
import { buildBabyjub } from 'circomlibjs';
import type { Ciphertext } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Point = [any, any];

export interface Elgamal {
  keypair(priv: bigint): { priv: bigint; pub: Point };
  encrypt(pub: Point, m: bigint, r: bigint): { c1: Point; c2: Point };
  addCipher(a: { c1: Point; c2: Point }, b: { c1: Point; c2: Point }): { c1: Point; c2: Point };
  decryptToPoint(priv: bigint, c: { c1: Point; c2: Point }): Point;
  bsgs(M: Point, maxUnits?: number): number;
  toStrings(c: { c1: Point; c2: Point }): Pick<Ciphertext, 'c1' | 'c2'>;
  pubToStrings(pub: Point): [string, string];
}

let cached: Elgamal | null = null;

export async function buildElgamal(): Promise<Elgamal> {
  if (cached) return cached;
  const j: any = await buildBabyjub();
  const F = j.F;

  const dec = (P: Point): [string, string] => [F.toObject(P[0]).toString(), F.toObject(P[1]).toString()];

  const el: Elgamal = {
    keypair(priv) {
      return { priv, pub: j.mulPointEscalar(j.Base8, priv) };
    },
    encrypt(pub, m, r) {
      const c1 = j.mulPointEscalar(j.Base8, r);
      const mG = j.mulPointEscalar(j.Base8, m);
      const rPub = j.mulPointEscalar(pub, r);
      const c2 = j.addPoint(mG, rPub);
      return { c1, c2 };
    },
    addCipher(a, b) {
      return { c1: j.addPoint(a.c1, b.c1), c2: j.addPoint(a.c2, b.c2) };
    },
    decryptToPoint(priv, c) {
      const privC1 = j.mulPointEscalar(c.c1, priv);
      const neg: Point = [F.neg(privC1[0]), privC1[1]];
      return j.addPoint(c.c2, neg);
    },
    bsgs(M, maxUnits = 1 << 20) {
      const n = Math.ceil(Math.sqrt(maxUnits));
      const table = new Map<string, number>();
      let cur: Point = [F.e(0), F.e(1)]; // identity
      for (let i = 0; i < n; i++) {
        table.set(F.toString(cur[0]) + ',' + F.toString(cur[1]), i);
        cur = j.addPoint(cur, j.Base8);
      }
      const nG = j.mulPointEscalar(j.Base8, n);
      const negNG: Point = [F.neg(nG[0]), nG[1]];
      let gamma: Point = M;
      for (let i = 0; i < n; i++) {
        const key = F.toString(gamma[0]) + ',' + F.toString(gamma[1]);
        const found = table.get(key);
        if (found !== undefined) return i * n + found;
        gamma = j.addPoint(gamma, negNG);
      }
      return -1; // not found within bound
    },
    toStrings(c) {
      return { c1: dec(c.c1), c2: dec(c.c2) };
    },
    pubToStrings(pub) {
      return dec(pub);
    },
  };

  cached = el;
  return el;
}
