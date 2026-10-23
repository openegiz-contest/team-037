/**
 * Раздел «Сценарии»: конструктор сценариев «что если», активные отклонения с отменой,
 * влияние на KPI обоих вариантов и история команд. На стенде команда пишется в признак
 * command двойника org.aktogay:control, без платформы — применяется к локальной модели.
 */
import { useState, type ReactNode } from 'react';
import { PageHeader } from '../components/PageHeader';
import type { Fleet } from '../platform/fleet';
import { activeDeviations, DEFAULT_DUR, DUR_RANGE, type ActiveDeviation, type Command } from '../platform/scenarios';
import { CONTROL_ID } from '../platform/twins';
import { MATERIAL_SHORT, type Kpis, type Simulation } from '../sim';
import { fmtClock } from '../ui/format';
import { MATERIAL_COLOR, STRATEGY_COLOR } from '../ui/theme';
import { stateTone, TONE_COLOR, VALUE_LABEL } from '../ui/twinLabels';
import { downloadCsv, getSnapshot, impactRows, printReport, takeSnapshot } from '../ui/scenarioReport';

type Kind = 'breakdown' | 'close_road' | 'blast' | 'drill_down' | 'power_cut' | 'storm_water' | 'leach_stop' | 'weather' | 'fuel_shortage' | 'no_tyres' | 'kpp_closed' | 'reset';
/** Сценарии с длительностью: для них показываем ползунок времени. */
type TimedKind = 'breakdown' | 'close_road' | 'drill_down' | 'power_cut' | 'storm_water' | 'leach_stop' | 'weather' | 'fuel_shortage' | 'no_tyres' | 'kpp_closed';

const KINDS: { kind: Kind; icon: string; title: string; text: string; tone: string }[] = [
  { kind: 'breakdown', icon: '⚠', title: 'Поломка экскаватора', text: 'Экскаватор встаёт на ремонт. Кто перевезёт его самосвалы?', tone: '#ef4444' },
  { kind: 'close_road', icon: '⊘', title: 'Перекрытие съезда', text: 'Участок спирального съезда закрыт: маршруты идут в объезд.', tone: '#f97316' },
  { kind: 'blast', icon: '✸', title: 'Внеплановый взрыв', text: 'Предупреждение 15 мин, затем оцепление 30 мин вокруг забоя.', tone: '#f59e0b' },
  { kind: 'drill_down', icon: '⚒', title: 'Поломка бурового станка', text: 'Блок не обурен — взрыв переносится, экскаватору становится нечего грузить.', tone: '#a855f7' },
  { kind: 'power_cut', icon: '✖', title: 'Отключение энергии', text: 'Фабрика, дробилка и электролиз встают. Самосвалы возят — бункер наполняется.', tone: '#eab308' },
  { kind: 'storm_water', icon: '☔', title: 'Ливень на хвостохранилище', text: 'Пруд поднимается, запас до гребня дамбы падает. Ниже нормы — намыв и фабрику останавливают.', tone: '#38bdf8' },
  { kind: 'leach_stop', icon: '⬡', title: 'Остановка орошения', text: 'Карты выщелачивания не поливают: раствор на завод не идёт, катоды не растут.', tone: '#14b8a6' },
  { kind: 'weather', icon: '❄', title: 'Непогода', text: 'Метель, пыльная буря или туман: скорость возки падает, взрывать нельзя.', tone: '#60a5fa' },
  { kind: 'fuel_shortage', icon: '◈', title: 'Перебои с топливом', text: 'Завоз дизеля остановлен, склад ГСМ пустеет — самосвалы ждут на АЗС, добыча падает.', tone: '#fb7185' },
  { kind: 'no_tyres', icon: '◎', title: 'Нет шин на складе РМЦ', text: 'Поставка шин задерживается: ремонт шин затягивается, самосвалы дольше стоят.', tone: '#c084fc' },
  { kind: 'kpp_closed', icon: '⊘', title: 'Закрыт КПП', text: 'Реагенты и топливо не завозят: через несколько часов фабрика снижает переработку.', tone: '#94a3b8' },
  { kind: 'reset', icon: '↺', title: 'Новая смена', text: 'Та же техника, другой сценарий случайных поломок и закрытий дорог.', tone: '#38bdf8' },
];

/** Варианты для сценариев, где выбирается не объект, а характер события. */
const STORM_KINDS = [
  { id: 0, name: 'Ливень', note: 'приток 120 000 м³/ч в пруд' },
  { id: 1, name: 'Снеготаяние', note: 'приток 70 000 м³/ч, дольше и ровнее' },
];
const WEATHER_KINDS = [
  { id: 0, sky: 'blizzard', name: 'Метель', note: 'возка 50 % от нормы, взрывы запрещены' },
  { id: 1, sky: 'dust', name: 'Пыльная буря', note: 'возка 82 %, видимость 800 м' },
  { id: 2, sky: 'fog', name: 'Туман', note: 'возка 76 %, видимость 350 м' },
];

interface Props {
  sims: Simulation[];
  kpis: Kpis[];
  platform: boolean;
  now: number;
  running: boolean;
  onToggleRun: () => void;
  seed: number;
  fleet: Fleet;
  history: [number, string][];
  act: (c: Command) => void;
}

export function ScenariosPage({ sims, kpis, platform, now, running, onToggleRun, seed, fleet, history, act }: Props) {
  const ref = sims[sims.length - 1];
  const [kind, setKind] = useState<Kind>('breakdown');
  const [target, setTarget] = useState<Record<Kind, number>>({ breakdown: 0, close_road: 0, blast: 1, drill_down: 2, power_cut: 0, storm_water: 0, leach_stop: 0, weather: 0, fuel_shortage: 0, no_tyres: 0, kpp_closed: 0, reset: 0 });
  const [dur, setDur] = useState<Record<TimedKind, number>>({ ...DEFAULT_DUR });
  const [newSeed, setNewSeed] = useState(seed);
  if (!ref) return null;

  const deviations = activeDeviations(ref);
  const closedLabels = new Set(ref.closures.map((c) => c.label));

  const cmd: Command =
    kind === 'reset'
      ? { value: 'reset', seed: newSeed }
      : kind === 'blast'
        ? { value: 'blast', arg: target.blast }
        : kind === 'weather'
          ? { value: 'weather', arg: WEATHER_KINDS[target.weather].sky, dur: dur.weather }
          : { value: kind, arg: target[kind], dur: dur[kind as TimedKind] };
  const preview = JSON.stringify({ ...cmd, seq: '<номер>' }, null, 1).replace(/"<номер>"/, '<номер>');

  const pick = (k: Kind, v: number) => setTarget((t) => ({ ...t, [k]: v }));

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-5">
      <PageHeader
        title="Сценарии «что если»"
        subtitle={
          <>
            Меняем условия работы рудника без изменения кода. Команда записывается в двойник <code className="num text-ink-2">{CONTROL_ID}</code>, симулятор
            применяет её к реальному карьеру и к его теневому расчёту без системы — так видно, сколько система спасает.
          </>
        }
        now={now}
        running={running}
        onToggleRun={onToggleRun}
      >
        <button
          onClick={() => act({ value: 'cancel_all' })}
          disabled={deviations.length === 0}
          className="rounded-lg bg-panel px-3 py-2 text-[13px] font-semibold text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/10 disabled:opacity-40"
        >
          ↶ Отменить всё
        </button>
      </PageHeader>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* Конструктор */}
        <section className="panel flex flex-col">
          <SectionTitle n="1" title="Выберите сценарий" />
          <div className="grid grid-cols-2 gap-2 px-4 pb-4 md:grid-cols-3 2xl:grid-cols-5">
            {KINDS.map((k) => (
              <button
                key={k.kind}
                onClick={() => setKind(k.kind)}
                className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors ${kind === k.kind ? 'bg-panel-2' : 'border-line hover:border-ink-3'}`}
                style={kind === k.kind ? { borderColor: k.tone, boxShadow: `inset 0 0 0 1px ${k.tone}` } : undefined}
              >
                <span className="grid h-8 w-8 place-items-center rounded-lg text-[17px]" style={{ background: `${k.tone}22`, color: k.tone }}>
                  {k.icon}
                </span>
                <span className="text-[13.5px] font-semibold leading-tight">{k.title}</span>
                <span className="text-[11.5px] leading-snug text-ink-3">{k.text}</span>
              </button>
            ))}
          </div>

          <SectionTitle
            n="2"
            title={
              kind === 'reset'
                ? 'Параметры смены'
                : kind === 'close_road'
                  ? 'Какой участок'
                  : kind === 'drill_down'
                    ? 'Какой станок'
                    : kind === 'storm_water'
                      ? 'Откуда вода'
                      : kind === 'weather'
                        ? 'Какая погода'
                        : kind === 'power_cut'
                          ? 'Что встанет'
                          : kind === 'leach_stop' || kind === 'fuel_shortage' || kind === 'no_tyres' || kind === 'kpp_closed'
                            ? 'Что остановится'
                            : 'Какой экскаватор'
            }
          />
          <div className="px-4 pb-4">
            {(kind === 'breakdown' || kind === 'blast') && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                {ref.excavators.map((ex) => {
                  const active = target[kind] === ex.id;
                  const tone = stateTone(ex.state);
                  return (
                    <button
                      key={ex.id}
                      onClick={() => pick(kind, ex.id)}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left ${active ? 'border-amber-500 bg-amber-500/10' : 'border-line hover:border-ink-3'}`}
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[13px] font-bold text-black" style={{ background: MATERIAL_COLOR[ex.material] }}>
                        {ex.name}
                      </span>
                      <span className="min-w-0 leading-tight">
                        <span className="block text-[13px] font-semibold">{MATERIAL_SHORT[ex.material]}</span>
                        <span className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: TONE_COLOR[tone] }} />
                          {VALUE_LABEL[ex.state]} · очередь {ex.queue.length}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {(kind === 'storm_water' || kind === 'weather') && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(kind === 'storm_water' ? STORM_KINDS : WEATHER_KINDS).map((o) => {
                  const active = target[kind] === o.id;
                  return (
                    <button
                      key={o.id}
                      onClick={() => pick(kind, o.id)}
                      className={`rounded-lg border px-3 py-2 text-left ${active ? 'border-amber-500 bg-amber-500/10' : 'border-line hover:border-ink-3'}`}
                    >
                      <span className="block text-[13px] font-semibold">{o.name}</span>
                      <span className="block text-[11.5px] text-ink-3">{o.note}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {(kind === 'power_cut' || kind === 'leach_stop' || kind === 'fuel_shortage' || kind === 'no_tyres' || kind === 'kpp_closed') && (
              <ul className="space-y-1 text-[12.5px] text-ink-2">
                {(kind === 'fuel_shortage'
                  ? [
                      'На складе ГСМ остаётся ~12 м³, автоцистерны не приходят',
                      'Склад расходует весь парк комбината — остаток уходит примерно за час',
                      'Когда склад пуст, самосвалы стоят у колонки АЗС, пока не привезут топливо',
                      'Видно, сколько машин ждёт и сколько руды не довезли',
                    ]
                  : kind === 'no_tyres'
                    ? [
                        'Шин на складе РМЦ — ноль, поставка задерживается',
                        'Ремонт шины по прогнозу и после прокола ждёт поставку ~90 мин',
                        'Самосвалы дольше стоят в ремонте — меньше машин на линии',
                      ]
                    : kind === 'kpp_closed'
                      ? [
                          'Грузовики с реагентами, кислотой и запчастями не въезжают — копится очередь',
                          'Запас реагентов флотации на фабрике ~6 ч; ниже 2 ч фабрика снижает переработку',
                          'Автоцистерны не доходят до склада ГСМ',
                          'Вахтовые автобусы проходят — смена не страдает',
                        ]
                      : kind === 'power_cut'
                  ? [
                      'Обогатительная фабрика и дробилка — стоят, руда копится в бункере и на складе',
                      'Электролиз SX-EW — стоит, медь остаётся в электролите, катоды не растут',
                      'Потребление падает до аварийного: ~4 МВт вместо ~60',
                      'Самосвалы продолжают возить: это видно по росту бункера и очереди',
                    ]
                  : [
                      'Карты не поливают — продуктивный раствор на завод не идёт',
                      'Расход PLS падает до нуля, катодная медь не растёт',
                      'Выщелачивание в картах при этом не прекращается — медь просто остаётся в штабеле',
                    ]
                ).map((t) => (
                  <li key={t} className="flex gap-2">
                    <span className="text-ink-3">—</span>
                    {t}
                  </li>
                ))}
              </ul>
            )}
            {kind === 'drill_down' && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {[...ref.drill.rigs.map((g) => ({ id: g.id, name: g.name, g })), { id: 2, name: 'Оба станка', g: null }].map((o) => {
                  const active = target.drill_down === o.id;
                  const g = o.g;
                  return (
                    <button
                      key={o.id}
                      onClick={() => pick('drill_down', o.id)}
                      className={`flex flex-col items-start rounded-lg border px-3 py-2 text-left ${active ? 'border-amber-500 bg-amber-500/10' : 'border-line hover:border-ink-3'}`}
                    >
                      <span className="text-[13.5px] font-semibold">{o.name}</span>
                      <span className="text-[11.5px] text-ink-3">
                        {g
                          ? `${VALUE_LABEL[g.state] ?? g.state}${g.target !== null ? ` · блок у ${ref.excavators[g.target]?.name}: ${ref.drill.blocks[g.target].holesDone}/${ref.drill.blocks[g.target].holesTotal}` : ''}`
                          : 'самый наглядный вариант'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {kind === 'close_road' && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ref.layout.closureGroups.map((g, i) => {
                  const closed = closedLabels.has(g.label);
                  const active = target.close_road === i;
                  return (
                    <button
                      key={g.label}
                      onClick={() => pick('close_road', i)}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] ${active ? 'border-amber-500 bg-amber-500/10' : 'border-line hover:border-ink-3'}`}
                    >
                      <span className="num grid h-7 w-7 shrink-0 place-items-center rounded-md bg-panel-2 text-[12px] text-ink-2">{i}</span>
                      <span className="flex-1">{g.label}</span>
                      {closed && <span className="rounded bg-red-500/15 px-1.5 text-[11px] font-semibold text-red-300">закрыт</span>}
                    </button>
                  );
                })}
              </div>
            )}
            {kind === 'reset' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <span className="text-[12px] text-ink-3">Парк техники</span>
                  <div className="text-[18px] font-bold">
                    {fleet.trucks} самосвалов · {fleet.excavators.length} экскаваторов
                  </div>
                  <span className="text-[11.5px] text-ink-3">
                    Состав парка меняется в разделе{' '}
                    <a href="#/fleet" className="font-semibold text-amber-300 hover:underline">
                      «Оборудование»
                    </a>
                    . Здесь — новая смена с тем же парком и другим сценарием событий.
                  </span>
                </div>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] text-ink-3">Сценарий случайных событий (seed)</span>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={newSeed}
                      onChange={(e) => setNewSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                      className="num w-full rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 outline-none focus:border-amber-500"
                    />
                    <button onClick={() => setNewSeed(Math.floor(Math.random() * 10000))} className="rounded-lg bg-panel-2 px-2.5 text-ink-2 hover:text-ink" title="Случайный seed">
                      ⚄
                    </button>
                  </div>
                  <span className="text-[11.5px] text-ink-3">Сейчас: seed {seed}.</span>
                </label>
              </div>
            )}
          </div>

          {(kind === 'breakdown' || kind === 'close_road' || kind === 'drill_down' || kind === 'fuel_shortage' || kind === 'no_tyres' || kind === 'kpp_closed') && (
            <>
              <SectionTitle n="3" title="Длительность" />
              <div className="flex items-center gap-4 px-4 pb-4">
                <input
                  type="range"
                  min={DUR_RANGE[kind][0]}
                  max={DUR_RANGE[kind][1]}
                  step={5}
                  value={dur[kind]}
                  onChange={(e) => setDur((d) => ({ ...d, [kind]: Number(e.target.value) }))}
                  className="flex-1 accent-amber-500"
                />
                <span className="num w-24 text-right text-[18px] font-bold">
                  {dur[kind]} <span className="text-[12px] font-normal text-ink-3">мин</span>
                </span>
              </div>
            </>
          )}

          <div className="mt-auto flex flex-wrap items-end gap-4 border-t border-line p-4">
            <div className="min-w-[240px] flex-1">
              <div className="mb-1 text-[11px] uppercase tracking-wider text-ink-3">{platform ? 'Команда в Ditto' : 'Команда (автономный режим)'}</div>
              <pre className="num whitespace-pre-wrap break-all rounded-lg bg-panel-2 px-3 py-2 text-[11.5px] leading-relaxed text-ink-2">
                <span className="text-sky-300">PUT</span> /api/2/things/{CONTROL_ID}/features/command/properties{'\n'}
                {preview}
              </pre>
            </div>
            <button
              onClick={() => {
                // Снимок показателей «до» — для отчёта по сценарию.
                if (sims.length === 2 && kpis.length === 2 && kind !== 'reset') takeSnapshot(now, KINDS.find((k) => k.kind === kind)!.title, impactRows(sims, kpis));
                act(cmd);
                if (kind === 'close_road') pick('close_road', (target.close_road + 1) % ref.layout.closureGroups.length);
              }}
              className="rounded-xl px-5 py-3 text-[15px] font-bold text-black shadow-lg hover:brightness-110"
              style={{ background: KINDS.find((k) => k.kind === kind)!.tone }}
            >
              {kind === 'reset' ? '↺ Начать новую смену' : '▶ Запустить сценарий'}
            </button>
          </div>
        </section>

        <div className="flex flex-col gap-4">
          {/* Активные отклонения */}
          <section className="panel">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <span className={`h-2 w-2 rounded-full ${deviations.length ? 'blink bg-red-500' : 'bg-emerald-500'}`} />
              <h3 className="text-[14px] font-semibold">Сейчас на руднике</h3>
              <span className="ml-auto text-[12px] text-ink-3">{deviations.length ? `${deviations.length} отклонений` : 'работа в штатном режиме'}</span>
            </div>
            <div className="flex flex-col gap-2 p-3">
              {deviations.length === 0 && (
                <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-ink-3">
                  Поломок, закрытых участков и взрывов нет. Запустите сценарий слева.
                </div>
              )}
              {deviations.map((d) => (
                <DeviationCard key={`${d.kind}-${d.title}`} d={d} onUndo={d.undo ? () => act({ value: d.undo!.value, arg: d.undo!.arg }) : undefined} />
              ))}
            </div>
          </section>

          {/* Влияние */}
          {sims.length === 2 && (
            <section className="panel">
              <div className="flex items-center border-b border-line px-4 py-3">
                <h3 className="text-[14px] font-semibold">Что было бы без системы</h3>
                <span className="ml-auto text-[12px] text-ink-3">с начала смены</span>
                <div className="ml-3 flex gap-1">
                  <button
                    onClick={() => downloadCsv({ now, seed, rows: impactRows(sims, kpis), history })}
                    className="rounded-md bg-panel-2 px-2 py-1 text-[12px] font-semibold text-ink-2 hover:text-ink"
                    title="Таблица «до/после» сценария для Excel"
                  >
                    ⇩ CSV
                  </button>
                  <button
                    onClick={() => printReport({ now, seed, rows: impactRows(sims, kpis), history })}
                    className="rounded-md bg-panel-2 px-2 py-1 text-[12px] font-semibold text-ink-2 hover:text-ink"
                    title="Отчёт для печати — в окне печати выберите «Сохранить как PDF»"
                  >
                    ⎙ PDF
                  </button>
                </div>
              </div>
              {getSnapshot() && (
                <div className="border-b border-line px-4 py-1.5 text-[11.5px] text-ink-3">
                  Снимок «до» для отчёта: {fmtClock(getSnapshot()!.t)} · {getSnapshot()!.title}
                </div>
              )}
              <ImpactTable sims={sims} kpis={kpis} />
            </section>
          )}

          {/* История */}
          <section className="panel">
            <div className="border-b border-line px-4 py-3">
              <h3 className="text-[14px] font-semibold">История команд</h3>
            </div>
            <div className="flex max-h-[220px] flex-col overflow-y-auto px-4 py-2">
              {history.length === 0 && <div className="py-3 text-[13px] text-ink-3">Команд ещё не было.</div>}
              {[...history].reverse().map(([t, text], i) => (
                <div key={`${t}-${i}`} className="flex gap-3 border-b border-line/50 py-1.5 text-[13px] last:border-0">
                  <span className="num text-ink-3">{fmtClock(t)}</span>
                  <span className="text-ink-2">{text}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <section className="panel px-4 py-3 text-[12.5px] leading-relaxed text-ink-3">
        <b className="text-ink-2">Как это работает.</b> Интерфейс (или Grafana, или любой HTTP-клиент) меняет признак <code className="num">command</code> двойника
        управления. Ditto публикует изменение в MQTT, симулятор применяет сценарий к обеим моделям и пишет результат в признак{' '}
        <code className="num">status</code>. Каждый сценарий можно отменить кнопкой «Отменить» — или он закончится сам по истечении длительности.
      </section>
    </div>
  );
}

function SectionTitle({ n, title }: { n: string; title: string }) {
  return (
    <div className="flex items-center gap-2 px-4 pb-2.5 pt-4">
      <span className="num grid h-5 w-5 place-items-center rounded-full bg-amber-500 text-[11px] font-bold text-black">{n}</span>
      <h3 className="text-[14px] font-semibold">{title}</h3>
    </div>
  );
}

const DEV_STYLE: Record<ActiveDeviation['kind'], { icon: string; color: string }> = {
  breakdown: { icon: '⚠', color: '#ef4444' },
  closure: { icon: '⊘', color: '#f97316' },
  blast: { icon: '✸', color: '#f59e0b' },
  drill: { icon: '⚒', color: '#a855f7' },
  nostock: { icon: '⛏', color: '#ef4444' },
  supply: { icon: '◈', color: '#fb7185' },
};

function DeviationCard({ d, onUndo }: { d: ActiveDeviation; onUndo?: () => void }) {
  const st = DEV_STYLE[d.kind];
  const left = Math.ceil(d.leftSec / 60);
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-panel-2/50 px-3 py-2.5" style={{ borderLeft: `3px solid ${st.color}` }}>
      <span className="text-[18px]" style={{ color: st.color }}>
        {st.icon}
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[13.5px] font-semibold">{d.title}</div>
        <div className="truncate text-[11.5px] text-ink-3">{d.detail}</div>
      </div>
      {d.leftSec > 0 && (
        <div className="text-right leading-tight">
          <div className="num text-[15px] font-bold text-ink">{left} мин</div>
          <div className="text-[10.5px] text-ink-3">{d.phase === 'warning' ? 'до взрыва' : 'осталось'}</div>
        </div>
      )}
      {onUndo && (
        <button onClick={onUndo} className="rounded-md bg-panel px-2.5 py-1.5 text-[12.5px] font-semibold text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/10">
          ↶ Отменить
        </button>
      )}
    </div>
  );
}

function ImpactTable({ sims, kpis }: { sims: Simulation[]; kpis: Kpis[] }) {
  const rows = impactRows(sims, kpis);
  const head = (name: string, color: string): ReactNode => (
    <th className="px-2 py-2 text-right font-semibold" style={{ color }}>
      {name}
    </th>
  );
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-[11px] uppercase tracking-wider text-ink-3">
          <th className="px-4 py-2 text-left font-medium">Показатель</th>
          {head('Без системы', STRATEGY_COLOR.fixed)}
          {head('С системой', STRATEGY_COLOR.smart)}
          <th className="px-4 py-2 text-right font-medium">Разница</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const diff = r.b - r.a;
          const good = Math.abs(diff) < 1e-9 ? null : r.better === 'higher' ? diff > 0 : diff < 0;
          return (
            <tr key={r.label} className="border-t border-line/60">
              <td className="px-4 py-1.5 text-ink-2">{r.label}</td>
              <td className="num px-2 py-1.5 text-right">{r.fmt(r.a)}</td>
              <td className="num px-2 py-1.5 text-right">{r.fmt(r.b)}</td>
              <td className={`num px-4 py-1.5 text-right font-semibold ${good === null ? 'text-ink-3' : good ? 'text-green-400' : 'text-red-400'}`}>
                {good === null ? '—' : `${diff > 0 ? '+' : '−'}${r.fmt(Math.abs(diff))}`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
