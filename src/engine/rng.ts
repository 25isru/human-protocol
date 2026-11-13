// Deterministic random streams. Each trait gets its own stream keyed by (seed, name),
// so adding traits later never changes what an old seed produces for existing traits.

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** Uniform numbers in the open interval (0, 1). */
export function stream(seed: string, name: string): () => number {
  const h = xmur3(`${seed}\u0000${name}`);
  const next = sfc32(h(), h(), h(), h());
  for (let i = 0; i < 12; i++) next();
  return () => Math.min(Math.max(next(), 1e-12), 1 - 1e-12);
}

export function randomSeed(): string {
  const a = new Uint32Array(2);
  globalThis.crypto.getRandomValues(a);
  return (a[0].toString(36) + a[1].toString(36)).slice(0, 10);
}
