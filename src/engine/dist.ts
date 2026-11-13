import type { Dist } from "./types";

export const logit = (p: number) => Math.log(p / (1 - p));
export const expit = (x: number) => 1 / (1 + Math.exp(-x));

/** Standard normal CDF (Abramowitz & Stegun 26.2.17 via erf approximation, |error| < 1.5e-7). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Inverse standard normal CDF (Acklam's algorithm, relative error < 1.2e-9). */
export function normInv(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5, r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Inverse-CDF sampling: maps a uniform u to a value. Returns the raw value (string, boolean or number). */
export function inverseCdf(d: Dist, u: number): string | number | boolean {
  switch (d.kind) {
    case "bernoulli":
      return u < d.p;
    case "categorical": {
      let acc = 0;
      for (let i = 0; i < d.p.length; i++) {
        acc += d.p[i];
        if (u < acc) return d.categories[i];
      }
      for (let i = d.p.length - 1; i >= 0; i--) if (d.p[i] > 0) return d.categories[i];
      return d.categories[0];
    }
    case "normal": {
      // Truncated to the support: u is mapped into [F(min), F(max)].
      const lo = d.min === undefined ? 0 : normCdf((d.min - d.mean) / d.sd);
      const hi = d.max === undefined ? 1 : normCdf((d.max - d.mean) / d.sd);
      const uu = Math.min(Math.max(lo + u * (hi - lo), 1e-12), 1 - 1e-12);
      return d.mean + d.sd * normInv(uu);
    }
  }
}

/** Probability (discrete) or density (continuous) of a value; used to weight pinned traits. */
export function likelihood(d: Dist, value: unknown): number {
  switch (d.kind) {
    case "bernoulli":
      return value === true ? d.p : value === false ? 1 - d.p : 0;
    case "categorical": {
      const i = d.categories.indexOf(String(value));
      return i < 0 ? 0 : d.p[i];
    }
    case "normal": {
      const x = Number(value);
      if (Number.isNaN(x)) return 0;
      if ((d.min !== undefined && x < d.min) || (d.max !== undefined && x > d.max)) return 0;
      const z = (x - d.mean) / d.sd;
      return Math.exp(-0.5 * z * z) / (d.sd * Math.sqrt(2 * Math.PI));
    }
  }
}

export function percentile(d: Dist, value: unknown): number | undefined {
  if (d.kind !== "normal") return undefined;
  return normCdf((Number(value) - d.mean) / d.sd);
}
