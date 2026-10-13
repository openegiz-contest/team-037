import type { ReactNode } from 'react';
import { fmtClock } from '../ui/format';

/** Шапка разделов: заголовок и время смены. Рудник работает непрерывно — паузы нет. */
export function PageHeader({
  title,
  subtitle,
  now,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  now: number;
  /** Устарело: рудник работает непрерывно. */
  running?: boolean;
  onToggleRun?: () => void;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[24px] font-bold leading-tight tracking-tight">{title}</h1>
        <div className="mt-0.5 max-w-[760px] text-[13px] text-ink-3">{subtitle}</div>
      </div>
      <div className="ml-auto flex items-center gap-3">
        {children}
        <div className="flex items-center gap-3 rounded-xl border border-line bg-panel py-1.5 pl-3 pr-1.5">
          <div className="leading-none">
            <div className="text-[10px] uppercase tracking-wider text-ink-3">Время смены</div>
            <div className="num mt-1 text-[19px] font-bold text-amber-400">
              {fmtClock(now)}
              <span className="text-[12px] text-ink-3"> / 12:00</span>
            </div>
          </div>
          <span className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-2 text-[12.5px] font-semibold text-emerald-300" title="Рудник работает непрерывно: смена за сменой">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />в работе
          </span>
        </div>
      </div>
    </header>
  );
}

/** Мини-график последних значений. */
export function Sparkline({ values, color = '#f59e0b', width = 88, height = 22 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return <svg width={width} height={height} />;
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (width - 2) + 1).toFixed(1)},${(height - 2 - ((v - lo) / (hi - lo)) * (height - 4)).toFixed(1)}`);
  const last = pts[pts.length - 1].split(',');
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={`1,${height - 1} ${pts.join(' ')} ${width - 1},${height - 1}`} fill={`${color}18`} stroke="none" />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2} fill={color} />
    </svg>
  );
}
