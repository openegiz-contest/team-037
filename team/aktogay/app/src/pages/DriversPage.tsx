/**
 * Раздел «Водители»: рейтинг стиля вождения по телеметрии самосвалов (GNSS, датчик топлива,
 * акселерометр рамы) и подсказка, кого ставить на длинные спуски по съездам.
 */
import { useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import type { Selection } from '../render/drawMine';
import { rampPicks, rateDrivers, type DriverRating, type Simulation } from '../sim';
import { TRUCK_COLOR } from '../ui/theme';
import { rateDrillers, type DrillerRating } from '../sim/drilling';
import { VALUE_LABEL } from '../ui/twinLabels';

type SortKey = 'total' | 'ramp' | 'fuel' | 'safety' | 'output';

const COLS: { key: SortKey; label: string; hint: string }[] = [
  { key: 'total', label: 'Итог', hint: '30% съезды · 30% аккуратность · 25% экономичность · 15% выработка' },
  { key: 'ramp', label: 'Съезды, км/ч', hint: 'средняя скорость на спиральных съездах по GNSS' },
  { key: 'safety', label: 'Торможения /100 км', hint: 'резкие торможения и опасные сближения на 100 км (акселерометр рамы)' },
  { key: 'fuel', label: 'Расход, л/100 км', hint: 'расход в движении на 100 км (датчик уровня топлива)' },
  { key: 'output', label: 'Выработка, т/ч', hint: 'перевезено тонн за час смены' },
];

const scoreColor = (s: number) => (s >= 65 ? '#22c55e' : s >= 40 ? '#f59e0b' : '#ef4444');

interface Props {
  sim: Simulation;
  now: number;
  running: boolean;
  onToggleRun: () => void;
  onLocate: (sel: Selection) => void;
}

export function DriversPage({ sim, now, running, onToggleRun, onLocate }: Props) {
  const [sort, setSort] = useState<SortKey>('total');
  const [tab, setTab] = useState<'trucks' | 'drills'>('trucks');
  const minute = Math.floor(sim.now / 60);
  // Пересчёт раз в модельную минуту.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rating = useMemo(() => rateDrivers(sim.trucks, sim.now), [sim, minute]);
  const picks = rampPicks(rating, 5);
  const enough = rating.some((r) => r.enough);
  const rows = [...rating].sort((a, b) => (sort === 'total' ? b.total - a.total : b.scores[sort] - a.scores[sort]));
  const attention = rating.filter((r) => r.enough && (r.scores.safety < 25 || r.scores.fuel < 25));
  const harshTotal = sim.trucks.reduce((n, t) => n + t.driverStats.harsh, 0);
  const deep = sim.excavators.filter((e) => e.material === 'sulfide').sort((a, b) => sim.cfg.excavators[b.id].ring - sim.cfg.excavators[a.id].ring)[0];

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-5">
      <PageHeader
        title="Водители"
        subtitle={
          <>
            {tab === 'trucks'
              ? 'У каждого водителя свой стиль. Двойник видит его по телеметрии самосвала: темп на съездах (GNSS), расход в движении (датчик топлива), резкие торможения (акселерометр рамы) — и подсказывает, кого ставить на длинные спуски с грузом.'
              : 'Машинисты буровых станков. Стиль видно по датчикам станка: скорость проходки (MWD), отклонение устья скважины от проекта (GNSS), заклинивания става (датчик момента). Сравнение — с нормативами.'}{' '}
            Люди вымышленные.
          </>
        }
        now={now}
        running={running}
        onToggleRun={onToggleRun}
      >
        <div className="flex overflow-hidden rounded-lg border border-line text-[13px]">
          {(
            [
              ['trucks', 'Водители самосвалов'],
              ['drills', 'Машинисты буровых'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 font-semibold ${tab === k ? 'bg-amber-500 text-black' : 'text-ink-2 hover:bg-panel-2'}`}>
              {l}
            </button>
          ))}
        </div>
      </PageHeader>

      {tab === 'drills' ? (
        <DrillersView sim={sim} />
      ) : (
      <>

      {!enough && (
        <div className="panel px-4 py-3 text-[13px] text-ink-3">Данных пока мало: рейтинг появится, когда самосвалы проедут хотя бы 15 км (≈ первый час смены).</div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Средний итог парка" value={String(Math.round(rating.reduce((n, r) => n + r.total, 0) / Math.max(1, rating.length)))} hint="из 100, относительно парка" />
        <Tile label="Лучший на съездах" value={picks[0]?.name ?? '—'} hint={picks[0] ? `${sim.trucks[picks[0].truckId].name} · ${picks[0].rampKmh?.toFixed(1)} км/ч на уклоне` : 'нужно больше данных'} />
        <Tile label="Нужен инструктаж" value={String(attention.length)} hint="низкая аккуратность или экономичность" tone={attention.length ? '#f59e0b' : undefined} />
        <Tile label="Резких торможений за смену" value={String(harshTotal)} hint="по всему парку" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        {/* Рекомендации */}
        <section className="panel flex flex-col">
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-[14px] font-semibold">Кого ставить на сложные съезды</h3>
            <div className="mt-0.5 text-[12px] text-ink-3">
              Длинные спуски с грузом{deep ? ` — забой ${deep.name} на дне карьера` : ''}. Нужен уверенный темп на уклоне и аккуратность.
            </div>
          </div>
          <div className="flex flex-col gap-2 p-3">
            {picks.length === 0 && <div className="py-4 text-center text-[13px] text-ink-3">Нужно больше данных.</div>}
            {picks.map((r, i) => (
              <div key={r.truckId} className="flex items-center gap-3 rounded-lg border border-line bg-panel-2/40 px-3 py-2">
                <span className="num grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-500 text-[14px] font-bold text-black">{i + 1}</span>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="text-[14px] font-semibold">{r.name}</div>
                  <div className="text-[11.5px] text-ink-3">
                    {sim.trucks[r.truckId].name} · стаж {r.years} лет · {r.rampKmh?.toFixed(1)} км/ч на съездах · аккуратность {r.scores.safety}
                  </div>
                </div>
                <button onClick={() => onLocate({ kind: 'truck', id: r.truckId })} className="text-[12px] text-ink-3 hover:text-amber-300" title="Показать на карте">
                  ◎
                </button>
              </div>
            ))}
            {attention.length > 0 && (
              <>
                <div className="mt-2 text-[12px] font-semibold uppercase tracking-wider text-ink-3">Внимание</div>
                {attention.slice(0, 4).map((r) => (
                  <div key={r.truckId} className="rounded-lg border border-line px-3 py-2 text-[12.5px]" style={{ borderLeft: '3px solid #f59e0b' }}>
                    <b>{r.name}</b> <span className="text-ink-3">({sim.trucks[r.truckId].name})</span>
                    <div className="text-ink-2">{r.advice}</div>
                  </div>
                ))}
              </>
            )}
          </div>
        </section>

        {/* Рейтинг */}
        <section className="panel min-w-0">
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <h3 className="text-[14px] font-semibold">Рейтинг водителей</h3>
            <span className="text-[12px] text-ink-3">оценки 0–100 относительно парка · клик по заголовку — сортировка</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-ink-3">
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-2 py-2 font-medium">Водитель</th>
                  {COLS.map((c) => (
                    <th key={c.key} className="whitespace-nowrap px-2 py-2 font-medium" title={c.hint}>
                      <button onClick={() => setSort(c.key)} className={sort === c.key ? 'text-amber-300' : 'hover:text-ink'}>
                        {c.label} {sort === c.key ? '▾' : ''}
                      </button>
                    </th>
                  ))}
                  <th className="min-w-[220px] px-3 py-2 font-medium">Где использовать</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <Row key={r.truckId} r={r} i={i} sim={sim} onLocate={onLocate} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      </>
      )}
    </div>
  );
}

// ───────────────────────────── машинисты буровых станков ─────────────────────────────

const NORMS: { key: keyof DrillerRating['scores']; label: string; value: (r: DriverRatingLike) => string; norm: string }[] = [
  { key: 'pace', label: 'Темп бурения', value: (r) => (r.paceIndex !== null ? `${Math.round(r.paceIndex * 100)}% нормы · ${r.paceMh?.toFixed(1)} м/ч` : '—'), norm: 'норма — по крепости пройденной породы (MWD)' },
  { key: 'precision', label: 'Точность наведения', value: (r) => (r.offsetM !== null ? `${(r.offsetM * 100).toFixed(0)} см` : '—'), norm: 'отклонение устья ≤ 30 см' },
  { key: 'care', label: 'Бережность к ставу', value: (r) => (r.jams100 !== null ? `${r.jams100.toFixed(1)} на 100 м` : '—'), norm: 'заклиниваний ≤ 1 на 100 м' },
];
type DriverRatingLike = DrillerRating;

function DrillersView({ sim }: { sim: Simulation }) {
  const minute = Math.floor(sim.now / 60);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rating = useMemo(() => rateDrillers(sim.drill, sim.now), [sim, minute]);
  const ready = rating.filter((r) => r.enough);
  const nextBlast = sim.blasts.filter((b) => b.phase === 'planned' || b.phase === 'warning').sort((a, b) => a.t - b.t)[0];
  const best = [...ready].sort((a, b) => b.scores.pace + b.scores.precision - (a.scores.pace + a.scores.precision))[0];
  return (
    <div className="flex flex-col gap-4">
      {ready.length === 0 && <div className="panel px-4 py-3 text-[13px] text-ink-3">Данных пока мало: оценка появится после первых трёх скважин у каждого машиниста.</div>}
      {best && nextBlast && sim.drill.drilled(nextBlast.target) < 1 && (
        <div className="panel border-amber-500/50 px-4 py-3 text-[13.5px]">
          <b className="text-amber-300">Рекомендация:</b> блок под плановый взрыв у {sim.excavators[nextBlast.target].name} (
          {sim.drill.blocks[nextBlast.target].holesDone}/{sim.drill.blocks[nextBlast.target].holesTotal} скважин) — поручить <b>{best.name}</b> (станок{' '}
          {sim.drill.rigs[best.rigId].name}): у него лучший темп и точность, взрыв не придётся переносить.
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {rating.map((r) => {
          const g = sim.drill.rigs[r.rigId];
          const col = r.total >= 65 ? '#22c55e' : r.total >= 40 ? '#f59e0b' : '#ef4444';
          return (
            <section key={r.rigId} className="panel p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[18px] font-bold">{r.name}</div>
                  <div className="text-[12.5px] text-ink-3">
                    машинист станка {g.name} · стаж {r.years} лет · сейчас: {VALUE_LABEL[g.state] ?? g.state}
                    {g.target !== null ? ` · блок у ${sim.excavators[g.target].name}` : ''}
                  </div>
                </div>
                <span className="num rounded-lg px-3 py-1 text-[22px] font-bold" style={{ background: `${col}22`, color: col }}>
                  {r.enough ? r.total : '—'}
                </span>
              </div>
              <div className="mt-4 flex flex-col gap-3">
                {NORMS.map((n) => {
                  const sc = r.scores[n.key];
                  const c = sc >= 60 ? '#22c55e' : sc >= 40 ? '#f59e0b' : '#ef4444';
                  return (
                    <div key={n.key}>
                      <div className="flex items-baseline justify-between text-[13px]">
                        <span className="text-ink-2">{n.label}</span>
                        <span className="num font-semibold">{n.value(r)}</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded bg-panel-2">
                        <div className="h-full rounded" style={{ width: `${r.enough ? sc : 0}%`, background: c }} />
                      </div>
                      <div className="mt-0.5 text-[11px] text-ink-3">{n.norm}</div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-panel-2 px-2 py-2">
                  <div className="num text-[18px] font-bold">{g.holesShift}</div>
                  <div className="text-[11px] text-ink-3">скважин за смену</div>
                </div>
                <div className="rounded-lg bg-panel-2 px-2 py-2">
                  <div className="num text-[18px] font-bold">{Math.round(g.metersShift)}</div>
                  <div className="text-[11px] text-ink-3">метров</div>
                </div>
                <div className="rounded-lg bg-panel-2 px-2 py-2">
                  <div className="num text-[18px] font-bold">{g.opStats.jams}</div>
                  <div className="text-[11px] text-ink-3">заклиниваний</div>
                </div>
              </div>
              <div className="mt-3 rounded-lg border border-line px-3 py-2 text-[12.5px] text-ink-2">
                <span className="text-ink-3">Где использовать: </span>
                {r.advice}
              </div>
            </section>
          );
        })}
      </div>
      <div className="panel px-4 py-3 text-[12px] leading-relaxed text-ink-3">
        Почему это важно: точность наведения определяет сетку скважин, а значит дробление при взрыве; темп — успеют ли обурить блок к плановому взрыву (иначе
        экскаватор останется без взорванной массы). Машинистов двое, поэтому их сравнивают не друг с другом, а с нормативами.
      </div>
    </div>
  );
}

function Row({ r, i, sim, onLocate }: { r: DriverRating; i: number; sim: Simulation; onLocate: (sel: Selection) => void }) {
  const t = sim.trucks[r.truckId];
  const cell = (score: number, value: string) => (
    <td className="px-2 py-1.5">
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-14 overflow-hidden rounded bg-panel-2">
          <div className="h-full rounded" style={{ width: `${score}%`, background: scoreColor(score) }} />
        </div>
        <span className="num w-[40px] text-[12px] text-ink-2">{value}</span>
      </div>
    </td>
  );
  return (
    <tr className={`border-t border-line/60 ${r.enough ? '' : 'opacity-50'}`}>
      <td className="num px-3 py-1.5 text-ink-3">{i + 1}</td>
      <td className="px-2 py-1.5">
        <button onClick={() => onLocate({ kind: 'truck', id: r.truckId })} className="text-left hover:text-amber-300">
          <div className="whitespace-nowrap font-semibold">{r.name}</div>
          <div className="flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-ink-3">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: TRUCK_COLOR[t.state] }} />
            {t.name} · {r.years} л.
          </div>
        </button>
      </td>
      <td className="px-2 py-1.5">
        <span className="num inline-block min-w-[44px] rounded px-2 py-0.5 text-center text-[14px] font-bold" style={{ background: `${scoreColor(r.total)}22`, color: scoreColor(r.total) }}>
          {r.total}
        </span>
      </td>
      {cell(r.scores.ramp, r.rampKmh !== null ? r.rampKmh.toFixed(1) : '—')}
      {cell(r.scores.safety, r.harsh100 !== null ? r.harsh100.toFixed(1) : '—')}
      {cell(r.scores.fuel, r.fuelL100 !== null ? String(Math.round(r.fuelL100)) : '—')}
      {cell(r.scores.output, String(Math.round(r.tph)))}
      <td className="px-3 py-1.5 text-[12px] text-ink-2">{r.advice}</td>
    </tr>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: string }) {
  return (
    <div className="panel px-4 py-3">
      <div className="text-[11.5px] text-ink-3">{label}</div>
      <div className="mt-0.5 truncate text-[22px] font-bold" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      <div className="truncate text-[11.5px] text-ink-3" title={hint}>
        {hint}
      </div>
    </div>
  );
}
