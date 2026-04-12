// ── SRHS 점수 계산 (Python 코드와 동일한 로직) ──────────────────────────

export const WEIGHTS = { PD: 0.20, LS: 0.20, CR: 0.25, TI: 0.20, RR: 0.15 };

export const TI_SCORES  = { USDT: 44, USDC: 94, DAI: 88, PYUSD: 72 };
export const RR_SCORES  = { USDT: 55, USDC: 14, DAI: 28, PYUSD: 18 };
export const CR_BASELINE = { USDT: 0.62, USDC: 0.92, PYUSD: 0.78 };

export function pdScore(price) {
  const dev = Math.abs(price - 1.0);
  return Math.min((dev / 0.02) * 100, 100);
}

export function lsScore(currentVol, vols30d) {
  if (!vols30d || vols30d.length === 0) return 0;
  const mean = vols30d.reduce((a, b) => a + b, 0) / vols30d.length;
  const std  = Math.sqrt(vols30d.reduce((a, b) => a + (b - mean) ** 2, 0) / vols30d.length);
  const z    = std > 0 ? (currentVol - mean) / std : 0;
  return Math.min(Math.max(z, 0), 3.0) / 3.0 * 100;
}

export function crScore(crRatio) {
  return Math.max(0, 100 - Math.min(crRatio * 100, 200));
}

export function tiScore(sym)  { return 100 - (TI_SCORES[sym]  ?? 50); }
export function rrScore(sym)  { return RR_SCORES[sym] ?? 50; }

export function srhsTotal(pd, ls, cr, ti, rr) {
  return pd * WEIGHTS.PD + ls * WEIGHTS.LS + cr * WEIGHTS.CR
       + ti * WEIGHTS.TI + rr * WEIGHTS.RR;
}

export function getGrade(score) {
  if (score <= 30) return { label: 'LOW',      color: 'var(--green)',  text: '정상 — 계속 사용 가능' };
  if (score <= 55) return { label: 'CAUTION',  color: 'var(--yellow)', text: '주의 — 모니터링 강화' };
  if (score <= 75) return { label: 'HIGH',     color: 'var(--orange)', text: '위험 — 교체 검토' };
  return               { label: 'CRITICAL',    color: 'var(--red)',    text: '즉시 교체 권고' };
}

export function scoreColor(v) {
  if (v >= 76) return 'var(--red)';
  if (v >= 56) return 'var(--orange)';
  if (v >= 31) return 'var(--yellow)';
  return 'var(--green)';
}
