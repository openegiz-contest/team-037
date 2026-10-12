export const fmtInt = (v: number) => Math.round(v).toLocaleString('ru-RU');
export const fmt1 = (v: number) => v.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Деньги в тенге с сокращением: тыс / млн / млрд. */
export function fmtKzt(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e9) return `${sign}${(a / 1e9).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} млрд ₸`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн ₸`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} тыс ₸`;
  return `${sign}${Math.round(a)} ₸`;
}

/** Время смены «чч:мм» от начала. */
export function fmtClock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function fmtDelta(pct: number): string {
  if (!Number.isFinite(pct)) return '—';
  const s = pct >= 0 ? '+' : '−';
  return `${s}${Math.abs(pct).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;
}
