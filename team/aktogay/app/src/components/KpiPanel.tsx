import { useState } from 'react';
import { deltaPct, type Effect, type Kpis, type StrategyName } from '../sim';
import { fmt1, fmtDelta, fmtInt, fmtKzt } from '../ui/format';
import { STRATEGY_COLOR } from '../ui/theme';

interface Row {
  label: string;
  value: (k: Kpis) => number;
  fmt: (v: number) => string;
  unit?: string;
  better: 'up' | 'down';
  sub?: (k: Kpis) => string;
}

const ROWS: Row[] = [
  { label: 'Выполнение плана: сульфид', value: (k) => k.planPct.sulfide, fmt: fmt1, unit: '%', better: 'up' },
  { label: 'Выполнение плана: оксид', value: (k) => k.planPct.oxide, fmt: fmt1, unit: '%', better: 'up' },
  { label: 'Выполнение плана: вскрыша', value: (k) => k.planPct.waste, fmt: fmt1, unit: '%', better: 'up' },
  {
    label: 'Качество руды на ОФ в норме',
    value: (k) => k.gradeInBandPct,
    fmt: fmt1,
    unit: '% вр.',
    better: 'up',
    sub: (k) => `ср. ${k.feedGradePct.toFixed(3)}% Cu`,
  },
  {
    label: 'Извлечение меди',
    value: (k) => k.recoveryPct,
    fmt: (v) => v.toFixed(2),
    unit: '%',
    better: 'up',
    sub: (k) => `${fmt1(k.cuConcT)} т Cu`,
  },
  { label: 'Средняя очередь у экскаватора', value: (k) => k.avgQueueMin, fmt: fmt1, unit: 'мин', better: 'down' },
  { label: 'Использование самосвалов', value: (k) => k.utilizationPct, fmt: fmt1, unit: '%', better: 'up' },
  {
    label: 'Простои техники',
    value: (k) => k.truckIdleH + k.excavatorIdleH,
    fmt: fmt1,
    unit: 'ч',
    better: 'down',
    sub: (k) => fmtKzt(k.idleCostKzt),
  },
  {
    label: 'Аварийные отказы самосвалов',
    value: (k) => k.unplannedFailures,
    fmt: fmtInt,
    unit: 'шт',
    better: 'down',
    sub: (k) => (k.preventedFailures > 0 ? `предотвр. ${k.preventedFailures}` : ''),
  },
  { label: 'Расход топлива', value: (k) => k.fuelL, fmt: fmtInt, unit: 'л', better: 'down', sub: (k) => fmtKzt(k.fuelCostKzt) },
  { label: 'Удельный расход', value: (k) => k.fuelLPerT, fmt: (v) => v.toFixed(3), unit: 'л/т', better: 'down' },
];

interface Tile {
  label: string;
  value: (k: Kpis) => number;
  fmt: (v: number) => string;
  unit: string;
  better: 'up' | 'down';
  sub?: (k: Kpis) => string;
}

const TILES: Tile[] = [
  {
    label: 'Добыто за смену',
    value: (k) => k.minedTotal,
    fmt: fmtInt,
    unit: 'т',
    better: 'up',
    sub: (k) => `руда ${fmtInt(k.mined.sulfide + k.mined.oxide)} · вскрыша ${fmtInt(k.mined.waste)}`,
  },
  { label: 'Производительность', value: (k) => k.tph, fmt: fmtInt, unit: 'т/ч', better: 'up' },
  { label: 'План смены', value: (k) => k.planTotalPct, fmt: fmt1, unit: '%', better: 'up' },
  {
    label: 'Простой дробилки',
    value: (k) => k.crusherIdleMin,
    fmt: fmt1,
    unit: 'мин',
    better: 'down',
    sub: (k) => fmtKzt(k.crusherIdleCostKzt),
  },
];

function Delta({ a, b, better }: { a: number; b: number; better: 'up' | 'down' }) {
  const d = deltaPct(a, b);
  const neutral = Math.abs(b - a) < 1e-6 || !Number.isFinite(d);
  const good = better === 'up' ? b > a : b < a;
  const cls = neutral ? 'bg-panel-2 text-ink-3' : good ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400';
  return (
    <span className={`num inline-block min-w-[64px] rounded px-1.5 py-0.5 text-right text-[13px] font-semibold ${cls}`}>
      {neutral ? '0%' : `${good ? '▲' : '▼'} ${fmtDelta(d)}`}
    </span>
  );
}

interface Props {
  labels: StrategyName[];
  kpis: Kpis[];
  effect: Effect | null;
  /** Режим сравнения, но эффект ещё не посчитан (идёт первый час смены). */
  pending?: boolean;
}

export function KpiPanel({ labels, kpis, effect, pending }: Props) {
  const compare = kpis.length === 2;
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1">
      <div className="grid grid-cols-2 gap-2">
        {TILES.map((t) => (
          <div key={t.label} className="panel px-3 py-2.5">
            <div className="text-[12px] uppercase tracking-wider text-ink-3">{t.label}</div>
            {compare ? (
              <>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="num text-[26px] font-bold leading-none" style={{ color: STRATEGY_COLOR.smart }}>
                    {t.fmt(t.value(kpis[1]))}
                  </span>
                  <span className="text-[13px] text-ink-3">{t.unit}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-1">
                  <span className="num text-[13px]" style={{ color: STRATEGY_COLOR.fixed }}>
                    фикс. {t.fmt(t.value(kpis[0]))}
                  </span>
                  <Delta a={t.value(kpis[0])} b={t.value(kpis[1])} better={t.better} />
                </div>
              </>
            ) : (
              <>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="num text-[30px] font-bold leading-none text-ink">{t.fmt(t.value(kpis[0]))}</span>
                  <span className="text-[13px] text-ink-3">{t.unit}</span>
                </div>
                {t.sub && <div className="num mt-1 text-[12px] text-ink-2">{t.sub(kpis[0])}</div>}
              </>
            )}
          </div>
        ))}
      </div>

      {compare && effect && <EffectBlock effect={effect} />}
      {pending && (
        <div className="panel border-amber-500/30 px-3 py-3">
          <div className="text-[12px] uppercase tracking-wider text-amber-400">Экономический эффект умной диспетчеризации</div>
          <div className="mt-1 text-[15px] text-ink-2">Накапливаем статистику — оценка появится после первого часа смены…</div>
        </div>
      )}

      <div className="panel px-3 py-2">
        {compare && (
          <div className="mb-1 grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 border-b border-line pb-1.5 text-[11px] uppercase tracking-wider text-ink-3">
            <span>Показатель</span>
            <span className="w-[78px] text-right" style={{ color: STRATEGY_COLOR.fixed }}>
              Фикс.
            </span>
            <span className="w-[78px] text-right" style={{ color: STRATEGY_COLOR.smart }}>
              Умная
            </span>
            <span className="w-[72px] text-right">Δ</span>
          </div>
        )}
        {ROWS.map((r) => (
          <div
            key={r.label}
            className={`grid items-center gap-x-3 border-b border-line/50 py-1.5 last:border-0 ${compare ? 'grid-cols-[1fr_auto_auto_auto]' : 'grid-cols-[1fr_auto]'}`}
          >
            <span className="text-[13px] text-ink-2">{r.label}</span>
            {kpis.map((k, i) => (
              <span key={labels[i]} className="num w-[78px] text-right text-[15px] font-semibold">
                {r.fmt(r.value(k))}
                <span className="ml-0.5 text-[11px] font-normal text-ink-3">{r.unit}</span>
                {r.sub && <div className="text-[11px] font-normal text-ink-3">{r.sub(k)}</div>}
              </span>
            ))}
            {compare && (
              <span className="w-[72px] text-right">
                <Delta a={r.value(kpis[0])} b={r.value(kpis[1])} better={r.better} />
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EffectBlock({ effect }: { effect: Effect }) {
  const [open, setOpen] = useState(false);
  const positive = effect.perYearKzt >= 0;
  return (
    <div
      className="panel relative cursor-help border-amber-500/40 bg-gradient-to-br from-amber-500/10 to-transparent px-3 py-3"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen((o) => !o)}
    >
      <div className="flex items-center justify-between text-[12px] uppercase tracking-wider text-amber-400">
        <span>Экономический эффект умной диспетчеризации</span>
        <span className="text-ink-3 normal-case">ⓘ формула</span>
      </div>
      <div className={`num mt-1 text-[34px] font-extrabold leading-tight ${positive ? 'text-amber-300' : 'text-red-400'}`}>
        {fmtKzt(effect.perYearKzt)}
        <span className="ml-1 text-[16px] font-semibold text-ink-2">/ год</span>
      </div>
      <div className="num text-[13px] text-ink-2">
        {fmtKzt(effect.perShiftKzt)} за смену · доп. добыча {effect.extraTonnesPerShift >= 0 ? '+' : ''}
        {fmtInt(effect.extraTonnesPerShift)} т/смену
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 rounded-lg border border-line bg-[#0b0d10] p-3 text-[12px] leading-relaxed text-ink-2 shadow-2xl">
          <div className="mb-1 font-semibold text-ink">Как считается (за смену, экстраполяция на 12 ч):</div>
          {effect.parts.map((p) => (
            <div key={p.label} className="mb-1.5">
              <div className="flex justify-between gap-2 text-ink">
                <span>{p.label}</span>
                <span className="num">{fmtKzt(p.perShiftKzt)}</span>
              </div>
              <div className="num text-[11px] text-ink-3">{p.formula}</div>
            </div>
          ))}
          <div className="mt-2 border-t border-line pt-2 text-ink">
            Эффект/год = Σ за смену × {effect.shiftsPerYear} смен ={' '}
            <span className="num font-semibold text-amber-300">{fmtKzt(effect.perYearKzt)}</span>
          </div>
          <div className="mt-1 text-[11px] text-ink-3">
            Доп. добыча в деньги не переводится (консервативно). Ставки — оценка, см. src/sim/config.ts.
          </div>
        </div>
      )}
    </div>
  );
}
