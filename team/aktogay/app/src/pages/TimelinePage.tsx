/**
 * Раздел «Хронология»: цепочки последствий (что случилось и к чему привело, с системой и без неё)
 * и диаграмма Ганта всей смены — полоска на каждую машину, раскрашенная по состояниям.
 */
import { useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import type { Selection } from '../render/drawMine';
import { analyzeShift, chainTotals, hhmm, type Chain } from '../sim/causality';
import { TRUCK_CODE, type Simulation } from '../sim/engine';
import type { StrategyName, TruckState } from '../sim';
import { STRATEGY_COLOR, TRUCK_COLOR } from '../ui/theme';

const CODE_TRUCK = Object.fromEntries(Object.entries(TRUCK_CODE).map(([s, c]) => [c, s])) as Record<string, TruckState>;
const TRUCK_RU: Record<TruckState, string> = {
  idle: 'ожидание',
  empty: 'порожний рейс',
  queue: 'очередь',
  loading: 'погрузка',
  loaded: 'гружёный рейс',
  dumping: 'разгрузка',
  refuel: 'заправка',
  service: 'плановый ремонт',
  broken: 'поломка',
};
const EX_COLOR: Record<string, string> = { w: '#22c55e', i: '#5b6470', b: '#ef4444', x: '#f97316', n: '#a855f7' };
const EX_RU: Record<string, string> = { w: 'работает', i: 'ждёт самосвал', b: 'поломка', x: 'оцепление (взрыв)', n: 'нет взорванной массы' };
const BIN_COLOR = (c: string) => (c === 's' ? '#ef4444' : ['#b45309', '#c2410c', '#d97706', '#ca8a04', '#a3a635', '#65a30d', '#16a34a', '#16a34a', '#15803d', '#15803d'][Number(c)] ?? '#15803d');

const SEV: Record<Chain['severity'], { color: string; label: string }> = {
  high: { color: '#ef4444', label: 'серьёзно' },
  mid: { color: '#f59e0b', label: 'заметно' },
  low: { color: '#6b7480', label: 'мелко' },
  good: { color: '#22c55e', label: 'система помогла' },
};
const TONE: Record<string, string> = { root: '#f59e0b', warn: '#f59e0b', bad: '#ef4444', good: '#22c55e', info: '#8a929d' };

const fmtMln = (v: number) => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)} млрд ₸` : `${(v / 1e6).toFixed(1)} млн ₸`);

interface Props {
  sims: Simulation[];
  now: number;
  running: boolean;
  onToggleRun: () => void;
  onLocate: (variant: StrategyName, sel: Selection) => void;
}

export function TimelinePage({ sims, now, running, onToggleRun, onLocate }: Props) {
  const real = sims.find((s) => s.strategyName === 'smart') ?? sims[sims.length - 1];
  const shadow = sims.find((s) => s.strategyName === 'fixed');
  const minutes = real.timeline.minutes;
  const [filter, setFilter] = useState<'all' | 'loss' | 'good'>('all');
  const [hl, setHl] = useState<Chain | null>(null);
  const [variant, setVariant] = useState<StrategyName>('smart');
  const ganttSim = variant === 'smart' ? real : (shadow ?? real);

  // Пересчёт раз в минуту модели — хронология меняется только при записи новой минуты.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const chains = useMemo(() => analyzeShift(real, shadow), [real, shadow, minutes]);
  const tot = useMemo(() => chainTotals(chains), [chains]);
  const shown = chains.filter((c) => (filter === 'all' ? true : filter === 'good' ? c.severity === 'good' : c.severity !== 'good'));

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-5">
      <PageHeader
        title="Хронология смены"
        subtitle={
          <>
            Двойник записывает каждую минуту смены и сам находит происшествия: что случилось, к чему привело и сколько это стоило. Рядом — что было бы без системы
            (теневой расчёт той же смены). Внизу — диаграмма Ганта: полоска на каждую машину.
          </>
        }
        now={now}
        running={running}
        onToggleRun={onToggleRun}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="Происшествий" value={String(tot.incidents)} hint={`${tot.prevented} аварий предотвращено прогнозом`} />
        <Tile label="Фабрика стояла" value={`${tot.starvedMin} мин`} hint="по вине происшествий смены" tone={tot.starvedMin > 0 ? '#ef4444' : undefined} />
        <Tile label="Ущерб с системой" value={fmtMln(tot.kzt)} hint="простой фабрики, очереди, аварии" />
        <Tile label="Без системы было бы" value={fmtMln(tot.shadowKzt)} hint="те же события, старая диспетчеризация" tone={STRATEGY_COLOR.fixed} />
        <Tile label="Система сберегла" value={fmtMln(Math.max(0, tot.shadowKzt - tot.kzt))} hint="на происшествиях этой смены" tone="#22c55e" />
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[440px_minmax(0,1fr)]">
        {/* Цепочки последствий */}
        <section className="panel flex min-h-0 flex-col">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <h3 className="whitespace-nowrap text-[14px] font-semibold">Цепочки последствий</h3>
            <div className="ml-auto flex overflow-hidden rounded-md border border-line text-[12px]">
              {(
                [
                  ['all', 'все'],
                  ['loss', 'ущерб'],
                  ['good', 'помогла система'],
                ] as const
              ).map(([k, l]) => (
                <button key={k} onClick={() => setFilter(k)} className={`whitespace-nowrap px-2 py-1 font-semibold ${filter === k ? 'bg-amber-500 text-black' : 'text-ink-2 hover:bg-panel-2'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
            {shown.length === 0 && <div className="py-6 text-center text-[13px] text-ink-3">{minutes < 5 ? 'Смена только началась — данных пока нет.' : 'Происшествий нет.'}</div>}
            {shown.map((c) => (
              <ChainCard key={c.id} c={c} active={hl?.id === c.id} onHover={setHl} onLocate={c.row ? () => onLocate('smart', c.row!) : undefined} />
            ))}
          </div>
        </section>

        {/* Диаграмма Ганта */}
        <section className="panel flex min-h-0 flex-col">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
            <h3 className="text-[14px] font-semibold">Диаграмма Ганта</h3>
            <span className="text-[12px] text-ink-3">каждая минута смены · наведите на полоску — подробности</span>
            <div className="ml-auto flex overflow-hidden rounded-md border border-line text-[12px]">
              {(['smart', 'fixed'] as StrategyName[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setVariant(v)}
                  disabled={v === 'fixed' && !shadow}
                  className="px-2.5 py-1 font-semibold disabled:opacity-40"
                  style={variant === v ? { background: STRATEGY_COLOR[v], color: '#fff' } : { color: 'var(--color-ink-2)' }}
                >
                  {v === 'smart' ? 'Реальный карьер' : 'Без системы'}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            <Gantt sim={ganttSim} minutes={ganttSim.timeline.minutes} hl={hl} onLocate={(sel) => onLocate(variant, sel)} />
            <Legend />
          </div>
        </section>
      </div>
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: string }) {
  return (
    <div className="panel px-4 py-3">
      <div className="text-[11.5px] text-ink-3">{label}</div>
      <div className="num mt-0.5 text-[22px] font-bold" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      <div className="truncate text-[11.5px] text-ink-3" title={hint}>
        {hint}
      </div>
    </div>
  );
}

function ChainCard({ c, active, onHover, onLocate }: { c: Chain; active: boolean; onHover: (c: Chain | null) => void; onLocate?: () => void }) {
  const sev = SEV[c.severity];
  const saved = c.shadow ? c.shadow.kzt - c.impact.kzt : 0;
  return (
    <div
      onMouseEnter={() => onHover(c)}
      onMouseLeave={() => onHover(null)}
      className={`rounded-lg border bg-panel-2/40 p-3 transition-colors ${active ? 'border-amber-500' : 'border-line'}`}
      style={{ borderLeft: `3px solid ${sev.color}` }}
    >
      <div className="flex items-center gap-2">
        <span className="num text-[12px] text-ink-3">
          {hhmm(c.t0)}–{hhmm(c.t1)}
        </span>
        <span className="rounded px-1.5 text-[10.5px] font-semibold" style={{ background: `${sev.color}22`, color: sev.color }}>
          {sev.label}
        </span>
        {onLocate && (
          <button onClick={onLocate} className="ml-auto text-[11.5px] text-ink-3 hover:text-amber-300">
            ◎ на карте
          </button>
        )}
      </div>
      <div className="mt-1 text-[14px] font-semibold leading-snug">{c.title}</div>
      <ol className="mt-2 flex flex-col">
        {c.steps.map((s, i) => (
          <li key={i} className="relative flex gap-2 pb-1.5 pl-4 text-[12.5px] leading-snug">
            <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full" style={{ background: TONE[s.tone] }} />
            {i < c.steps.length - 1 && <span className="absolute left-[3.5px] top-3.5 bottom-0 w-px bg-line" />}
            <span className="num shrink-0 text-ink-3">{hhmm(s.t)}</span>
            <span className={s.tone === 'root' ? 'font-semibold text-ink' : 'text-ink-2'}>{s.text}</span>
          </li>
        ))}
      </ol>
      {c.shadow && c.severity !== 'good' && (
        <div className="mt-1.5 rounded-md bg-panel-2 px-2.5 py-1.5 text-[12px] text-ink-2">
          <span style={{ color: STRATEGY_COLOR.fixed }}>Без системы: </span>
          {c.shadow.starvedMin > 0 ? `фабрика стояла бы ${c.shadow.starvedMin} мин, ` : ''}
          ущерб {fmtMln(c.shadow.kzt)}
          {saved > 1e5 && <b className="text-green-400"> · система сберегла {fmtMln(saved)}</b>}
        </div>
      )}
      {c.shadow && c.severity === 'good' && (
        <div className="mt-1.5 rounded-md bg-panel-2 px-2.5 py-1.5 text-[12px] text-ink-2">
          <span style={{ color: STRATEGY_COLOR.fixed }}>Без системы: </span>
          {c.kind === 'prevented' ? `отказ на трассе, ремонт ≈ ${fmtMln(c.shadow.kzt)}` : `фабрика стояла бы ${c.shadow.starvedMin} мин, ${fmtMln(c.shadow.kzt)}`}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── диаграмма Ганта ─────────────────────────────

const LABEL_W = 78;
const PLOT_W = 1000;
const ROW = 13;
const GAP = 3;

function Gantt({ sim, minutes, hl, onLocate }: { sim: Simulation; minutes: number; hl: Chain | null; onLocate: (sel: Selection) => void }) {
  const total = sim.cfg.shift.durationSec / 60;
  const x = (m: number) => LABEL_W + (m / total) * PLOT_W;
  const tl = sim.timeline;

  // Тяжёлая часть (тысячи прямоугольников) — только при новой минуте.
  const body = useMemo(() => {
    const rows: { label: string; color?: string; rects: { s: number; e: number; fill: string; tip: string }[]; sel?: Selection; header?: string }[] = [];
    /** Строка по минутам → отрезки одинакового состояния. */
    const seg = (str: string, color: (c: string) => string | null, tip: (c: string) => string, name: string) => {
      const out: { s: number; e: number; fill: string; tip: string }[] = [];
      let s = 0;
      for (let i = 1; i <= str.length; i++) {
        if (i === str.length || str[i] !== str[s]) {
          const fill = color(str[s]);
          if (fill) out.push({ s, e: i, fill, tip: `${name} · ${tip(str[s])} · ${hhmm(s)}–${hhmm(i)} (${i - s} мин)` });
          s = i;
        }
      }
      return out;
    };
    rows.push({ header: 'Переработка', label: '', rects: [] });
    rows.push({ label: 'Бункер', rects: seg(tl.crusher, BIN_COLOR, (c) => (c === 's' ? 'пусто, фабрика стоит' : `уровень ${Number(c) * 10}–${Number(c) * 10 + 10}%`), 'Бункер дробилки') });
    rows.push({ label: 'Перекрытия', rects: seg(tl.closures, (c) => (c === '0' ? null : '#f97316'), (c) => `закрыто участков: ${c}`, 'Съезды') });
    rows.push({ header: 'Экскаваторы', label: '', rects: [] });
    tl.excavators.forEach((str, i) => {
      const e = sim.excavators[i];
      if (e) rows.push({ label: e.name, rects: seg(str, (c) => EX_COLOR[c] ?? null, (c) => EX_RU[c] ?? c, e.name), sel: { kind: 'excavator', id: i } });
    });
    rows.push({ header: 'Самосвалы', label: '', rects: [] });
    tl.trucks.forEach((str, i) => {
      const t = sim.trucks[i];
      if (t) rows.push({ label: t.name, rects: seg(str, (c) => TRUCK_COLOR[CODE_TRUCK[c]] ?? null, (c) => TRUCK_RU[CODE_TRUCK[c]] ?? c, t.name), sel: { kind: 'truck', id: i } });
    });
    let y = 18;
    const placed = rows.map((r) => {
      const yy = y;
      y += r.header ? 18 : ROW + GAP;
      return { ...r, y: yy };
    });
    const height = y + 4;
    const el = (
      <>
        {/* сетка по часам */}
        {Array.from({ length: total / 60 + 1 }, (_, h) => (
          <g key={h}>
            <line x1={x(h * 60)} y1={14} x2={x(h * 60)} y2={height} stroke="var(--color-line)" strokeWidth={1} />
            <text x={x(h * 60)} y={10} textAnchor="middle" fontSize={10} fill="var(--color-ink-3)">
              {h} ч
            </text>
          </g>
        ))}
        {placed.map((r, k) =>
          r.header ? (
            <text key={k} x={4} y={r.y + 12} fontSize={10.5} fontWeight={700} fill="var(--color-ink-3)" letterSpacing="0.08em">
              {r.header.toUpperCase()}
            </text>
          ) : (
            <g key={k}>
              <text
                x={LABEL_W - 6}
                y={r.y + ROW - 3}
                textAnchor="end"
                fontSize={11}
                fill="var(--color-ink-2)"
                style={r.sel ? { cursor: 'pointer' } : undefined}
                onClick={r.sel ? () => onLocate(r.sel!) : undefined}
              >
                {r.label}
              </text>
              <rect x={LABEL_W} y={r.y} width={PLOT_W} height={ROW} fill="var(--color-panel-2)" />
              {r.rects.map((q, j) => (
                <rect key={j} x={x(q.s)} y={r.y} width={Math.max(0.6, x(q.e) - x(q.s))} height={ROW} fill={q.fill}>
                  <title>{q.tip}</title>
                </rect>
              ))}
            </g>
          ),
        )}
      </>
    );
    return { el, height };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, minutes]);

  const { el, height } = body;
  return (
    <svg viewBox={`0 0 ${LABEL_W + PLOT_W + 6} ${height}`} className="w-full min-w-[720px]">
      {el}
      {hl && <rect x={x(hl.t0)} y={14} width={Math.max(2, x(Math.min(total, hl.t1 + 30)) - x(hl.t0))} height={height - 14} fill="#f59e0b" fillOpacity={0.14} stroke="#f59e0b" strokeOpacity={0.6} />}
      <line x1={x(minutes)} y1={14} x2={x(minutes)} y2={height} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 3" />
    </svg>
  );
}

function Legend() {
  const truck: TruckState[] = ['empty', 'queue', 'loading', 'loaded', 'dumping', 'refuel', 'service', 'broken', 'idle'];
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-3">
      {truck.map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className="h-2.5 w-3 rounded-sm" style={{ background: TRUCK_COLOR[s] }} />
          {TRUCK_RU[s]}
        </span>
      ))}
      <span className="mx-1 h-3 border-l border-line" />
      {Object.entries(EX_RU).map(([c, l]) => (
        <span key={c} className="flex items-center gap-1.5">
          <span className="h-2.5 w-3 rounded-sm" style={{ background: EX_COLOR[c] }} />
          экск.: {l}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-3 rounded-sm" style={{ background: '#ef4444' }} />
        бункер пуст
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-0 w-4 border-t-2 border-dashed border-amber-500" />
        сейчас
      </span>
    </div>
  );
}
