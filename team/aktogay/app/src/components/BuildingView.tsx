/**
 * «Внутренний двойник» здания — мнемосхема процесса, как на экранах SCADA в операторской:
 * что происходит внутри дробилки, фабрики, гаража, площадки выщелачивания и отвала.
 * Все значения — из того же двойника (локальной модели, восстановленной из Ditto).
 */
import { useState, type ReactNode } from 'react';
import { Interior3D } from './Interior3D';
import { webglAvailable } from '../render3d/quality';
import { SENSORS_BY_KIND } from '../platform/sensors';
import type { BuildingKind } from '../render3d/MineScene';
import { TRUCK_STATE_LABEL, type Simulation } from '../sim';
import { CONC_GRADE, TRAIN_WAGONS, WAGON_T } from '../sim/concentrate';
import { CAPACITY_MT, CREST_FINAL_M, FREEBOARD_MIN_M, SOLIDS_PCT } from '../sim/tailings';
import { CELL_CAP_T, EW_CELLS, IRRIGATION_GROUPS, IRRIGATION_WINDOW_H, SX_EFFICIENCY, type CellStage } from '../sim/leach';
import { fmtInt } from '../ui/format';
import { MATERIAL_COLOR, TRUCK_COLOR } from '../ui/theme';
import { thingIds } from '../platform/twins';
import { UNIT_STATE_RU } from '../sim/equipment';
import { FEATURE_LABEL, stateTone, TONE_COLOR, UNIT_LABEL } from '../ui/twinLabels';

const TITLE: Record<BuildingKind, string> = {
  crusher: 'Первичная дробилка ККД',
  plant: 'Обогатительная фабрика',
  garage: 'Гараж, АЗС и стоянка',
  leach: 'Площадка кучного выщелачивания',
  waste: 'Отвал вскрыши',
  stockpile: 'Склад дроблёной руды',
  sxew: 'Завод SX-EW и пруды растворов',
  tsf: 'Хвостохранилище: дамба, пруд и оборотная вода',
  conc: 'Склад концентрата и ж/д погрузка',
};
const TWIN_KIND: Record<BuildingKind, string> = { crusher: 'crusher', plant: 'concentrator', garage: 'garage', leach: 'heap-leach', waste: 'waste-dump', stockpile: 'stockpile', sxew: 'sxew-plant', tsf: 'tailings-dam', conc: 'concentrate-store' };

// Цвета схемы (тёмный «экран»).
const C = {
  line: '#3a4350',
  pipe: '#56606d',
  text: '#e8eaed',
  dim: '#8a929d',
  ok: '#22c55e',
  warn: '#f59e0b',
  bad: '#ef4444',
  ore: MATERIAL_COLOR.sulfide,
  box: '#161b21',
  boxHi: '#1d242c',
};

interface Props {
  sim: Simulation;
  kind: BuildingKind;
  onClose: () => void;
  onTruck: (id: number) => void;
  /** Лёгкая графика для 3D-цеха. */
  light?: boolean;
}

export function BuildingView({ sim, kind, onClose, onTruck, light = false }: Props) {
  const sensors = SENSORS_BY_KIND[TWIN_KIND[kind]] ?? [];
  /** У дробилки и фабрики есть 3D-цех; без WebGL — только схема. */
  const has3d = (kind === 'crusher' || kind === 'plant' || kind === 'garage') && webglAvailable();
  const [tab, setTab] = useState<'3d' | 'scheme'>(has3d ? '3d' : 'scheme');
  const show3d = has3d && tab === '3d';
  return (
    <div className="absolute inset-2 z-30 flex flex-col overflow-hidden rounded-lg border border-line bg-popover shadow-2xl" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-amber-300">Внутри</span>
        <span className="truncate text-[15px] font-semibold">{TITLE[kind]}</span>
        <span className={`hidden shrink-0 text-[12px] text-ink-3 ${has3d ? "" : "2xl:inline"}`}>мнемосхема процесса · данные двойника · {sensors.length} датчиков</span>
        {has3d && (
          <div className="ml-auto flex shrink-0 overflow-hidden rounded-md border border-line text-[12.5px]">
            {(['3d', 'scheme'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`px-2.5 py-1 font-semibold ${tab === t ? 'bg-amber-500 text-black' : 'text-ink-2 hover:bg-panel-2'}`}>
                {t === '3d' ? '3D внутри' : 'Схема'}
              </button>
            ))}
          </div>
        )}
        <button onClick={onClose} className={`${has3d ? '' : 'ml-auto '}shrink-0 whitespace-nowrap rounded px-2 py-0.5 text-ink-3 hover:bg-panel-2 hover:text-ink`} aria-label="Закрыть">
          ✕ Закрыть
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {show3d && (
          <div className="relative h-[46vh] min-h-[300px]">
            <Interior3D sim={sim} kind={kind as 'crusher' | 'plant' | 'garage'} light={light} />
            <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-[11.5px] text-ink-2">ЛКМ — вращение · ПКМ — сдвиг · колесо — масштаб</div>
          </div>
        )}
        {!show3d && kind === 'crusher' && <Crusher sim={sim} onTruck={onTruck} />}
        {!show3d && kind === 'plant' && <Plant sim={sim} />}
        {!show3d && kind === 'garage' && <Garage sim={sim} onTruck={onTruck} />}
        {(kind === 'leach' || kind === 'waste') && <Dump sim={sim} kind={kind} onTruck={onTruck} />}
        {kind === 'stockpile' && <Stockpile sim={sim} />}
        {kind === 'sxew' && <SxEw sim={sim} />}
        {kind === 'tsf' && <Tailings sim={sim} />}
        {kind === 'conc' && <ConcStore sim={sim} />}
        {(kind === 'crusher' || kind === 'plant' || kind === 'garage') && <UnitStrip sim={sim} building={kind} />}
        {sensors.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {sensors.map((s) => (
              <span key={s.id} className="rounded-md bg-panel-2 px-2 py-1 text-[11.5px] text-ink-2" title={`${s.hardware} · ${s.location}`}>
                ◉ {s.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────── агрегаты здания ─────────────────────────────

const UNIT_OF: Record<string, (key: string) => string> = { power: (k) => (k === 'crusher-drive' ? 'kW' : 'MW') };
const UNITS_RU: Record<string, string> = {
  motor_current: 'A', hydraulic_pressure: 'bar', bearing_temp: 'C', vibration: 'mm/s', belt_speed: 'm/s', load: 't/h', mill_load: '%', speed: 'rpm',
  pulp_density: '%', water: 'm3/h', pressure: 'kPa', p80: 'um', froth_level: 'mm', air_flow: 'm3/min', reagent_dose: 'g/t', conc_grade: '% Cu',
  underflow_density: '%', rake_torque: '%', flow: 'l/min', dispensed: 'l', remaining: 'min',
};

/** Карточки агрегатов здания: состояние, ключевые датчики, тревога; клик — двойник агрегата. */
function UnitStrip({ sim, building }: { sim: Simulation; building: 'crusher' | 'plant' | 'garage' }) {
  const units = sim.equipment.units.filter((u) => u.def.building === building);
  const id = thingIds(sim.strategyName);
  return (
    <div className="mt-3">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Агрегаты · двойники в Ditto</div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-5">
        {units.map((u) => {
          const tone = u.alarm ? 'bad' : stateTone(u.state);
          return (
            <a
              key={u.def.key}
              href={`#/twins/${encodeURIComponent(id.unit(u.def.key))}`}
              className="rounded-lg border bg-panel-2/50 px-2.5 py-2 hover:border-amber-500"
              style={{ borderColor: u.alarm ? '#ef4444' : 'var(--color-line)' }}
              title="Открыть двойник агрегата"
            >
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TONE_COLOR[tone] }} />
                <span className="truncate text-[12.5px] font-semibold">{u.def.name}</span>
              </div>
              <div className="mt-0.5 text-[11px]" style={{ color: u.alarm ? '#ef4444' : 'var(--color-ink-3)' }}>
                {u.alarm ? `⚠ подшипник ${u.v.bearing_temp} °C — осмотр в пересменку` : UNIT_STATE_RU[u.state]}
              </div>
              <div className="mt-1 flex flex-col gap-0.5">
                {u.def.keyFeatures
                  .filter((k) => k !== 'state')
                  .map((k) => {
                    const raw = UNIT_OF[k]?.(u.def.key) ?? UNITS_RU[k];
                    const unit = raw ? (UNIT_LABEL[raw] ?? raw) : '';
                    return (
                      <div key={k} className="flex justify-between gap-2 text-[11.5px]">
                        <span className="truncate text-ink-3">{FEATURE_LABEL[k] ?? k}</span>
                        <span className="num shrink-0 text-ink">
                          {u.v[k] ?? '—'}
                          {unit && u.v[k] !== undefined && typeof u.v[k] === 'number' ? ` ${unit}` : ''}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────────── общие элементы схемы ─────────────────────────────

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-panel-2 px-3 py-2">
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className="num text-[17px] font-bold" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
    </div>
  );
}

function Stats({ children }: { children: ReactNode }) {
  return <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">{children}</div>;
}

/** Блок оборудования на схеме: рамка, название, строка значения. */
function Unit({ x, y, w, h, title, value, tone = C.line, children }: { x: number; y: number; w: number; h: number; title: string; value?: string; tone?: string; children?: ReactNode }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={10} fill={C.box} stroke={tone} strokeWidth={1.6} />
      <text x={x + w / 2} y={y + 20} textAnchor="middle" fontSize={13} fontWeight={700} fill={C.text}>
        {title}
      </text>
      {value && (
        <text x={x + w / 2} y={y + h - 12} textAnchor="middle" fontSize={12.5} fill={tone === C.line ? C.dim : tone} fontFamily="var(--font-mono)">
          {value}
        </text>
      )}
      {children}
    </g>
  );
}

/** Конвейер / трубопровод: при работе по нему «бежит» материал. */
function Flow({ d, running, color = C.ore, label, lx, ly }: { d: string; running: boolean; color?: string; label?: string; lx?: number; ly?: number }) {
  return (
    <g>
      <path d={d} fill="none" stroke={C.pipe} strokeWidth={9} strokeLinecap="round" />
      <path d={d} fill="none" stroke={running ? color : '#3b3f45'} strokeWidth={4} strokeLinecap="round" className={running ? 'mn-flow' : undefined} />
      {label && (
        <text x={lx} y={ly} textAnchor="middle" fontSize={11.5} fill={running ? C.text : C.dim} fontFamily="var(--font-mono)">
          {label}
        </text>
      )}
    </g>
  );
}

function SensorDot({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={5} fill="#38bdf8" />
      <circle cx={x} cy={y} r={9} fill="none" stroke="#38bdf8" strokeOpacity={0.4} />
      <text x={x + 13} y={y + 4} fontSize={10.5} fill="#7dd3fc">
        {label}
      </text>
    </g>
  );
}

function TruckChip({ sim, id, onTruck }: { sim: Simulation; id: number; onTruck: (id: number) => void }) {
  const t = sim.trucks[id];
  if (!t) return null;
  return (
    <button onClick={() => onTruck(id)} className="flex items-center gap-1.5 rounded-md bg-panel-2 px-2 py-1 text-[12px] hover:ring-1 hover:ring-amber-500" title="Показать на карте">
      <span className="h-2 w-2 rounded-full" style={{ background: TRUCK_COLOR[t.state] }} />
      <b>{t.name}</b>
      <span className="text-ink-3">{TRUCK_STATE_LABEL[t.state].toLowerCase()}</span>
    </button>
  );
}

// ───────────────────────────── дробилка ─────────────────────────────

function Crusher({ sim, onTruck }: { sim: Simulation; onTruck: (id: number) => void }) {
  const c = sim.crusher;
  const cfg = sim.cfg;
  const pct = c.binCapT > 0 ? Math.min(1, c.binT / c.binCapT) : 0;
  const sp = sim.stockpile;
  const starved = sp.t <= 0.01;
  const crushing = sp.crushing;
  const g = sim.binGrade;
  const inBand = Math.abs(g - cfg.grade.targetPct) <= cfg.grade.bandPct;
  const fillCol = pct > 0.85 ? C.warn : C.ok;
  const outTph = crushing ? Math.round(sp.lastIn * 3600) : 0;
  const minutesLeft = (sp.t / cfg.dumps.crusher.plantFeedTpm);
  return (
    <div className={starved ? 'mn-stopped' : ''}>
      <svg viewBox="0 0 1000 330" className="w-full">
        {/* площадка разгрузки */}
        <Unit x={20} y={30} w={210} h={120} title="Площадка разгрузки" value={`разгружается ${c.active.length} · ждут ${c.queue.length}`} tone={c.queue.length > 1 ? C.warn : C.line}>
          {Array.from({ length: cfg.dumps.crusher.bays }, (_, i) => {
            const a = c.active[i];
            return (
              <g key={i} transform={`translate(${125 - (cfg.dumps.crusher.bays * 100 - 10) / 2 + i * 100} 66)`}>
                <rect width={90} height={34} rx={6} fill={a ? '#3a2a12' : C.boxHi} stroke={a ? C.ore : C.line} />
                <text x={45} y={22} textAnchor="middle" fontSize={12} fill={a ? C.ore : C.dim} fontWeight={700}>
                  {a ? sim.trucks[a.truck]?.name : 'свободно'}
                </text>
              </g>
            );
          })}
        </Unit>
        <SensorDot x={36} y={170} label="RFID + лидар" />
        <Flow d="M125 150 L125 205 L270 205" running={crushing} label={crushing ? `руда ${fmtInt(cfg.truck.payloadT)} т/рейс` : 'нет разгрузки'} lx={195} ly={230} />

        {/* дробилка */}
        <Unit x={270} y={140} w={190} h={130} title="Конусная дробилка" value={crushing ? 'дробит' : c.binT > 0.01 ? 'склад полон' : 'ждёт руду'} tone={crushing ? C.ok : C.line}>
          <g transform="translate(365 205)">
            <polygon points="-38,-26 38,-26 18,30 -18,30" fill="#2b323b" stroke={C.pipe} />
            <g className={crushing ? 'mn-spin' : undefined}>
              <polygon points="0,-20 16,20 -16,20" fill={crushing ? '#6b7480' : '#454c55'} />
            </g>
          </g>
        </Unit>
        <SensorDot x={290} y={290} label="ток, давление, вибрация привода" />
        <Flow d="M460 205 L520 205" running={crushing} />

        {/* бункер */}
        <g>
          <rect x={520} y={40} width={150} height={230} rx={8} fill={C.box} stroke={fillCol} strokeWidth={1.8} />
          <rect x={524} y={44 + (1 - pct) * 222} width={142} height={pct * 222} rx={5} fill={fillCol} fillOpacity={0.35} />
          <text x={595} y={62} textAnchor="middle" fontSize={13} fontWeight={700} fill={C.text}>
            Приёмный бункер
          </text>
          <text x={595} y={150} textAnchor="middle" fontSize={30} fontWeight={800} fill={fillCol} fontFamily="var(--font-mono)">
            {Math.round(pct * 100)}%
          </text>
          <text x={595} y={176} textAnchor="middle" fontSize={13} fill={C.text} fontFamily="var(--font-mono)">
            {fmtInt(c.binT)} / {fmtInt(c.binCapT)} т
          </text>
          <text x={595} y={198} textAnchor="middle" fontSize={12.5} fill={inBand ? C.ok : C.warn} fontFamily="var(--font-mono)">
            {starved ? '—' : `${g.toFixed(3)} % Cu`}
          </text>
        </g>
        <SensorDot x={540} y={24} label="радарный уровнемер" />

        {/* питатель и конвейер */}
        <Flow d="M670 240 L960 240" running={crushing} label={crushing ? `${fmtInt(outTph)} т/ч → на склад` : 'конвейер на склад стоит'} lx={815} ly={226} />
        <SensorDot x={760} y={270} label="конвейерные весы" />
        <text x={960} y={265} textAnchor="end" fontSize={12} fill={C.dim}>
          склад →
        </text>
        <text x={815} y={90} textAnchor="middle" fontSize={13} fill={starved ? C.bad : minutesLeft < 30 ? C.warn : C.dim}>
          {starved ? 'ПРОСТОЙ: склад пуст, фабрика без руды' : `на складе ${fmtInt(sp.t)} т — фабрике на ${(minutesLeft / 60).toFixed(1)} ч`}
        </text>
      </svg>
      <Stats>
        <Stat label="Принято за смену" value={`${fmtInt(c.tonnes)} т`} />
        <Stat label="Простой фабрики без руды" value={`${(c.starvedSec / 60).toFixed(1)} мин`} tone={c.starvedSec > 0 ? C.bad : undefined} />
        <Stat label="Cu в бункере" value={c.binT <= 0.01 ? '—' : `${g.toFixed(3)} %`} tone={inBand ? C.ok : C.warn} />
        <Stat label="Цель по качеству" value={`${cfg.grade.targetPct} ± ${cfg.grade.bandPct} %`} />
      </Stats>
      {c.queue.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-3">
          Очередь на разгрузку: {c.queue.map((id) => <TruckChip key={id} sim={sim} id={id} onTruck={onTruck} />)}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── склад дроблёной руды ─────────────────────────────

function Stockpile({ sim }: { sim: Simulation }) {
  const sp = sim.stockpile;
  const cfg = sim.cfg;
  const frac = Math.min(1, sp.t / sp.capT);
  const feedTph = cfg.dumps.crusher.plantFeedTpm * 60;
  const hours = sp.t / feedTph;
  const empty = sp.t <= 0.01;
  const inflow = Math.round(sp.lastIn * 3600);
  const col = empty ? C.bad : hours < 0.5 ? C.warn : C.ok;
  // Конус: основание 520, высота по запасу.
  const H = 40 + 170 * Math.sqrt(frac);
  const W = 120 + 380 * Math.sqrt(frac);
  return (
    <div className={empty ? 'mn-stopped' : ''}>
      <svg viewBox="0 0 1000 330" className="w-full">
        <Flow d="M20 60 L440 60" running={sp.crushing} label={sp.crushing ? `с дробилки ${fmtInt(inflow)} т/ч` : 'отсыпки нет'} lx={200} ly={45} />
        <SensorDot x={60} y={90} label="весы отсыпки" />
        {sp.crushing && <path d="M440 64 L440 300" stroke={C.ore} strokeWidth={10} strokeDasharray="4 10" className="mn-flow slow" opacity={0.7} />}
        <polygon points={`${440 - W / 2},300 ${440},${300 - H} ${440 + W / 2},300`} fill={C.ore} fillOpacity={0.45} stroke={C.ore} />
        <line x1={150} y1={300} x2={760} y2={300} stroke={C.line} />
        <rect x={300} y={302} width={280} height={18} rx={4} fill={C.box} stroke={C.line} />
        <text x={440} y={315} textAnchor="middle" fontSize={11} fill={C.dim}>
          тоннель с питателями
        </text>
        <Flow d="M580 311 L980 311" running={!empty} label={empty ? 'фабрика без руды' : `на фабрику ${fmtInt(feedTph)} т/ч`} lx={780} ly={296} />
        <SensorDot x={640} y={250} label="весы питателей" />
        <SensorDot x={180} y={180} label="лидар объёма" />
        {sp.crushing && <SensorDot x={560} y={140} label={`пыль ${(2.5 + 6 * (1 - frac)).toFixed(1)} мг/м³ — водяная завеса`} />}
        <text x={440} y={300 - H / 2} textAnchor="middle" fontSize={24} fontWeight={800} fill={C.text} fontFamily="var(--font-mono)">
          {fmtInt(sp.t)} т
        </text>
        <text x={800} y={140} textAnchor="middle" fontSize={34} fontWeight={800} fill={col} fontFamily="var(--font-mono)">
          {hours.toFixed(1)} ч
        </text>
        <text x={800} y={165} textAnchor="middle" fontSize={13} fill={C.dim}>
          запас для фабрики
        </text>
      </svg>
      <Stats>
        <Stat label="На складе" value={`${fmtInt(sp.t)} / ${fmtInt(sp.capT)} т`} />
        <Stat label="Заполнение" value={`${Math.round(frac * 100)} %`} tone={col} />
        <Stat label="Cu в штабеле" value={empty ? '—' : `${sim.feedGrade.toFixed(3)} %`} />
        <Stat label="Отсыпано за смену" value={`${fmtInt(sp.inflowT)} т`} />
      </Stats>
      <div className="mt-2 text-[11.5px] text-ink-3">
        Склад — буфер между карьером и фабрикой: дробилка отсыпает руду с конвейера, фабрика забирает её питателями из тоннеля под штабелем. Активная ёмкость
        масштабирована под моделируемый сегмент парка (~1,5 ч работы фабрики).
      </div>
    </div>
  );
}

// ───────────────────────────── фабрика ─────────────────────────────

function Plant({ sim }: { sim: Simulation }) {
  const st = sim.stats;
  const cfg = sim.cfg;
  const running = sim.stockpile.t > 0.01;
  const feedTph = running ? cfg.dumps.crusher.plantFeedTpm * 60 : 0;
  const g = sim.feedGrade;
  const inBand = Math.abs(g - cfg.grade.targetPct) <= cfg.grade.bandPct;
  const recovery = st.cuFeedT > 0 ? (st.cuConcT / st.cuFeedT) * 100 : cfg.grade.recoveryMax * 100;
  const inBandPct = st.feedSec > 0 ? (st.feedInBandSec / st.feedSec) * 100 : 100;
  const tone = running ? C.ok : C.bad;
  return (
    <div className={running ? '' : 'mn-stopped'}>
      <svg viewBox="0 0 1000 330" className="w-full">
        <Flow d="M10 165 L120 165" running={running} label={running ? `${fmtInt(feedTph)} т/ч` : 'нет питания'} lx={65} ly={150} />
        <Unit x={120} y={110} w={150} h={110} title="Анализатор PGNAA" value={running ? `${g.toFixed(3)} % Cu` : '—'} tone={running ? (inBand ? C.ok : C.warn) : C.line} />
        <Flow d="M270 165 L310 165" running={running} />

        <Unit x={310} y={95} w={150} h={140} title="Мельница ПСИ" value={running ? 'измельчение' : 'стоит'} tone={tone}>
          <g transform="translate(385 165)">
            <circle r={34} fill="#2b323b" stroke={C.pipe} strokeWidth={2} />
            <g className="mn-spin">
              <line x1={-30} y1={0} x2={30} y2={0} stroke="#6b7480" strokeWidth={4} />
              <line x1={0} y1={-30} x2={0} y2={30} stroke="#6b7480" strokeWidth={4} />
            </g>
          </g>
        </Unit>
        <Flow d="M460 165 L500 165" running={running} color="#9ca3af" />
        <Unit x={500} y={95} w={140} h={140} title="Шаровая мельница" value="+ гидроциклоны" tone={tone}>
          <g transform="translate(570 165)">
            <circle r={30} fill="#2b323b" stroke={C.pipe} strokeWidth={2} />
            <g className="mn-spin">
              <circle cx={14} cy={0} r={6} fill="#6b7480" />
              <circle cx={-10} cy={10} r={5} fill="#6b7480" />
            </g>
          </g>
        </Unit>
        <Flow d="M640 165 L680 165" running={running} color="#9ca3af" />

        <Unit x={680} y={70} w={170} h={190} title="Флотация" value={`извлечение ${recovery.toFixed(1)} %`} tone={tone}>
          {[0, 1, 2, 3].map((i) => (
            <g key={i} transform={`translate(${700 + i * 38} 110)`}>
              <rect width={30} height={80} rx={4} fill="#1f3340" stroke="#2c5566" />
              {[0, 1, 2].map((b) => (
                <circle key={b} cx={8 + b * 7} cy={72} r={3} fill="#bfe7f5" className="mn-bubble" style={{ animationDelay: `${(i * 3 + b) * 0.17}s` }} />
              ))}
            </g>
          ))}
        </Unit>
        <Flow d="M850 120 L960 120" running={running} color={C.ore} label={`концентрат ${st.cuConcT.toFixed(1)} т Cu`} lx={905} ly={108} />
        <Flow d="M850 225 L960 225" running={running} color="#6b7480" label={`хвосты ${st.cuLossT.toFixed(2)} т Cu`} lx={905} ly={250} />
        <SensorDot x={130} y={250} label="конвейерные весы" />
        <SensorDot x={690} y={290} label="анализатор пульпы XRF" />
        {!running && (
          <text x={500} y={40} textAnchor="middle" fontSize={16} fontWeight={800} fill={C.bad}>
            ПРОСТОЙ ФАБРИКИ — В БУНКЕРЕ НЕТ РУДЫ
          </text>
        )}
      </svg>
      <Stats>
        <Stat label="Подано руды за смену" value={`${fmtInt(st.plantFeedT)} т`} />
        <Stat label="Медь в питании" value={`${st.cuFeedT.toFixed(1)} т`} />
        <Stat label="Медь в концентрате" value={`${st.cuConcT.toFixed(1)} т`} tone={C.ore} />
        <Stat label="Питание в коридоре качества" value={`${inBandPct.toFixed(1)} % времени`} tone={inBandPct >= 75 ? C.ok : C.warn} />
      </Stats>
      <div className="mt-2 text-[11.5px] text-ink-3">
        Внутри фабрика описана балансом меди: питание, содержание, извлечение, хвосты. Состояние мельниц и флотации показано по питанию фабрики.
      </div>
    </div>
  );
}

// ───────────────────────────── гараж ─────────────────────────────

function Garage({ sim, onTruck }: { sim: Simulation; onTruck: (id: number) => void }) {
  const slots = sim.slotOccupant;
  const P = sim.parking;
  const cols = Math.max(1, P.cols);
  const refuel = sim.trucks.filter((t) => t.state === 'refuel');
  const service = sim.trucks.filter((t) => t.state === 'service');
  const broken = sim.trucks.filter((t) => t.state === 'broken');
  const goingToGarage = sim.trucks.filter((t) => t.dest?.kind === 'garage' && t.state !== 'refuel' && t.state !== 'service');
  return (
    <div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="rounded-lg border border-line p-3">
          <div className="mb-2 flex items-baseline justify-between text-[13px] font-semibold">
            Стоянка <span className="text-[11.5px] font-normal text-ink-3">занято {slots.filter((s) => s !== null).length} из {slots.length} · индуктивные петли + RFID</span>
          </div>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {slots.map((occ, k) => {
              const t = occ !== null ? sim.trucks[occ] : null;
              return (
                <button
                  key={k}
                  disabled={!t}
                  onClick={() => t && onTruck(t.id)}
                  className={`flex h-12 flex-col items-center justify-center rounded border text-[11px] ${t ? 'border-line bg-panel-2 hover:ring-1 hover:ring-amber-500' : 'border-dashed border-line/70 text-ink-3'}`}
                >
                  <span className="text-[9.5px] text-ink-3">место {k + 1}</span>
                  {t ? (
                    <span className="flex items-center gap-1 font-bold">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: TRUCK_COLOR[t.state] }} />
                      {t.name}
                    </span>
                  ) : (
                    '—'
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <Bay title="Колонка АЗС" hint="расходомер + RFID" trucks={refuel} sim={sim} onTruck={onTruck} empty="никто не заправляется" tone={C.warn} />
          <Bay title="Ремонтные боксы (ППР)" hint="RFID на воротах" trucks={service} sim={sim} onTruck={onTruck} empty="боксы свободны" tone="#22d3ee" />
          <Bay title="Аварийный ремонт на трассе" hint="эвакуация, ремонт на месте" trucks={broken} sim={sim} onTruck={onTruck} empty="аварий нет" tone={C.bad} />
          <Bay title="Едут в гараж" hint="заправка или плановый ремонт" trucks={goingToGarage} sim={sim} onTruck={onTruck} empty="—" tone={C.dim} />
        </div>
      </div>
    </div>
  );
}

function Bay({ title, hint, trucks, sim, onTruck, empty, tone }: { title: string; hint: string; trucks: { id: number }[]; sim: Simulation; onTruck: (id: number) => void; empty: string; tone: string }) {
  return (
    <div className="rounded-lg border border-line p-3" style={{ borderLeft: `3px solid ${tone}` }}>
      <div className="mb-1.5 flex items-baseline justify-between text-[13px] font-semibold">
        {title} <span className="text-[11px] font-normal text-ink-3">{hint}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {trucks.length ? trucks.map((t) => <TruckChip key={t.id} sim={sim} id={t.id} onTruck={onTruck} />) : <span className="text-[12px] text-ink-3">{empty}</span>}
      </div>
    </div>
  );
}

// ───────────────────────────── выщелачивание и отвал ─────────────────────────────

const STAGE_RU: Record<CellStage, string> = { loading: 'отсыпка', rest: 'выдержка', irrigating: 'орошение', spent: 'отработана' };
const STAGE_COLOR: Record<CellStage, string> = { loading: '#d97706', rest: '#78716c', irrigating: '#0e7490', spent: '#44403c' };

/** Карты площадки, график орошения, раствор и завод SX-EW. */
function LeachCells({ sim }: { sim: Simulation }) {
  const L = sim.leach;
  const g = L.activeGroup(sim.now);
  const winS = IRRIGATION_WINDOW_H * 3600;
  const left = winS - (sim.now % winS);
  const cols = 7;
  const W = 128;
  const H = 92;
  return (
    <div className="mt-4">
      <div className="mb-1 text-[13px] font-semibold text-ink-1">Карты площадки и график орошения</div>
      <svg viewBox="0 0 1000 330" className="w-full">
        {L.cells.map((c, i) => {
          const x = 20 + (i % cols) * (W + 10);
          const y = 10 + Math.floor(i / cols) * (H + 12);
          const rec = c.cuT > 0 ? c.cuLeachedT / c.cuT : 0;
          const fill = c.stage === 'loading' ? Math.min(1, c.oreT / CELL_CAP_T) : 1;
          return (
            <g key={c.id} transform={`translate(${x} ${y})`}>
              <rect width={W} height={H} rx={6} fill={C.box} stroke={c.irrigated ? '#22d3ee' : C.line} strokeWidth={c.irrigated ? 2.5 : 1} />
              <rect x={0} y={H - H * fill} width={W} height={H * fill} rx={6} fill={STAGE_COLOR[c.stage]} fillOpacity={0.45} />
              {c.irrigated &&
                Array.from({ length: 12 }, (_, k) => <circle key={k} cx={12 + (k % 6) * 21} cy={40 + Math.floor(k / 6) * 16} r={2.2} fill="#67e8f9" />)}
              <text x={8} y={17} fontSize={12} fontWeight={700} fill={C.text}>
                {c.name}
              </text>
              <text x={W - 8} y={17} textAnchor="end" fontSize={10.5} fill={C.dim}>
                гр. {L.groupOf(c) + 1}
              </text>
              <text x={8} y={33} fontSize={11} fill={c.irrigated ? '#67e8f9' : C.dim}>
                {c.irrigated ? 'поливается' : STAGE_RU[c.stage]}
              </text>
              <text x={8} y={H - 22} fontSize={10.5} fill={C.dim}>
                {c.stage === 'loading' ? `${fmtInt(c.oreT / 1000)} из ${CELL_CAP_T / 1000} тыс. т` : c.stage === 'irrigating' || c.stage === 'spent' ? `${Math.round(c.daysLeached)} сут орошения` : 'разводка сети'}
              </text>
              <text x={8} y={H - 8} fontSize={10.5} fill={C.text}>
                {c.cuT > 0 ? `извлечено ${Math.round(rec * 100)} % Cu` : ''}
              </text>
            </g>
          );
        })}
        <SensorDot x={20 + 6 * (W + 10) + W / 2} y={10 + H + 12 + H / 2} label="расходомеры карт" />
        {/* раствор → пруд → SX-EW */}
        <g transform="translate(20 230)">
          <rect width={260} height={80} rx={8} fill={C.box} stroke="#0e7490" />
          <text x={130} y={22} textAnchor="middle" fontSize={12} fill={C.dim}>Пруд PLS</text>
          <text x={130} y={46} textAnchor="middle" fontSize={16} fontWeight={700} fill={C.text} fontFamily="var(--font-mono)">{fmtInt(L.plsM3h)} м³/ч</text>
          <text x={130} y={66} textAnchor="middle" fontSize={12} fill="#67e8f9">{L.plsGpl.toFixed(2)} г/л Cu</text>
          <line x1={260} y1={40} x2={350} y2={40} stroke="#0e7490" strokeWidth={3} markerEnd="url(#arr)" />
          <rect x={350} width={300} height={80} rx={8} fill={C.box} stroke="#b45309" />
          <text x={500} y={22} textAnchor="middle" fontSize={12} fill={C.dim}>SX-EW · ток серии {L.ewKA.toFixed(1)} кА</text>
          <text x={500} y={46} textAnchor="middle" fontSize={16} fontWeight={700} fill="#f59e0b" fontFamily="var(--font-mono)">{L.cathodeT.toFixed(1)} т катодов</text>
          <text x={500} y={66} textAnchor="middle" fontSize={12} fill={C.dim}>темп {fmtInt(L.cathodeTpd)} т/сут</text>
          <path d="M500 80 L500 92 L130 92 L130 80" fill="none" stroke="#155e75" strokeDasharray="5 4" />
          <text x={315} y={88} textAnchor="middle" fontSize={10.5} fill={C.dim}>рафинат — обратно на орошение</text>
          <text x={680} y={22} fontSize={12} fill={C.dim}>Сейчас поливается группа {g + 1} из {IRRIGATION_GROUPS}</text>
          <text x={680} y={42} fontSize={12} fill={C.dim}>смена группы через {Math.ceil(left / 60)} мин</text>
          <text x={680} y={62} fontSize={12} fill={C.dim}>кислоты за смену {fmtInt(L.acidT)} т</text>
        </g>
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={6} markerHeight={6} orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill="#0e7490" />
          </marker>
        </defs>
      </svg>
      <Stats>
        <Stat label="Медь перешла в раствор" value={`${L.cuLeachedT.toFixed(1)} т`} />
        <Stat label="Катодная медь" value={`${L.cathodeT.toFixed(1)} т`} tone={C.ok} />
        <Stat label="Карт в орошении" value={`${L.irrigatingCount} (поливается ${L.cells.filter((c) => c.irrigated).length})`} />
        <Stat label="Медь в PLS" value={`${L.plsGpl.toFixed(2)} г/л`} />
      </Stats>
      <div className="mt-2 text-[11.5px] text-ink-3">
        Карты, кривая извлечения (до ~70 % меди за полгода) и график полива — оценки по открытым данным о кучном выщелачивании. Рост штабеля по ярусам и химия раствора упрощены.
      </div>
    </div>
  );
}

function Dump({ sim, kind, onTruck }: { sim: Simulation; kind: 'leach' | 'waste'; onTruck: (id: number) => void }) {
  const mat = kind === 'leach' ? 'oxide' : 'waste';
  // Отвалов вскрыши несколько — показываем итог по всем (места разгрузки, очередь, тоннаж).
  const all = sim.dumps.filter((x) => x.material === mat);
  const d =
    all.length === 1
      ? all[0]
      : { ...all[0], bays: all.reduce((n, x) => n + x.bays, 0), active: all.flatMap((x) => x.active), queue: all.flatMap((x) => x.queue), tonnes: all.reduce((n, x) => n + x.tonnes, 0) };
  const plan = sim.cfg.planT[mat];
  const pct = plan > 0 ? Math.min(1.2, d.tonnes / plan) : 0;
  const color = MATERIAL_COLOR[mat];
  const shiftPct = sim.now / sim.cfg.shift.durationSec;
  const ahead = pct >= shiftPct;
  return (
    <div>
      <svg viewBox="0 0 1000 300" className="w-full">
        {/* места разгрузки */}
        {Array.from({ length: d.bays }, (_, i) => {
          const a = d.active[i];
          return (
            <g key={i} transform={`translate(${40 + i * 150} 30)`}>
              <rect width={130} height={60} rx={8} fill={a ? '#2c2a20' : C.box} stroke={a ? color : C.line} strokeWidth={1.5} />
              <text x={65} y={24} textAnchor="middle" fontSize={11.5} fill={C.dim}>
                место {i + 1}
              </text>
              <text x={65} y={46} textAnchor="middle" fontSize={14} fontWeight={700} fill={a ? color : C.dim}>
                {a ? sim.trucks[a.truck]?.name : 'свободно'}
              </text>
            </g>
          );
        })}
        <SensorDot x={40 + d.bays * 150 + 10} y={60} label="RFID + лидар" />
        {/* штабель */}
        <g transform="translate(40 120)">
          <line x1={0} y1={150} x2={920} y2={150} stroke={C.line} />
          <path d={`M0 150 L${120} ${150 - 120 * pct} L${800} ${150 - 120 * pct} L920 150 Z`} fill={color} fillOpacity={0.35} stroke={color} />
          <line x1={0} y1={150 - 120 * shiftPct} x2={920} y2={150 - 120 * shiftPct} stroke={C.warn} strokeDasharray="6 5" />
          <text x={915} y={150 - 120 * shiftPct - 6} textAnchor="end" fontSize={11} fill={C.warn}>
            по плану к этому часу
          </text>
          <text x={460} y={150 - 60 * pct + 6} textAnchor="middle" fontSize={22} fontWeight={800} fill={C.text} fontFamily="var(--font-mono)">
            {fmtInt(d.tonnes)} т
          </text>
        </g>
      </svg>
      <Stats>
        <Stat label={kind === 'leach' ? 'Оксидной руды уложено' : 'Вскрыши в отвале'} value={`${fmtInt(d.tonnes)} т`} />
        <Stat label="План смены" value={`${fmtInt(plan)} т`} />
        <Stat label="Выполнение плана" value={`${(pct * 100).toFixed(1)} %`} tone={ahead ? C.ok : C.warn} />
        <Stat label="Очередь на разгрузку" value={`${d.queue.length} самосв.`} tone={d.queue.length > 1 ? C.warn : undefined} />
      </Stats>
      {d.queue.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-3">
          Ждут: {d.queue.map((id) => <TruckChip key={id} sim={sim} id={id} onTruck={onTruck} />)}
        </div>
      )}
      {kind === 'leach' && <LeachCells sim={sim} />}
    </div>
  );
}

// ───────────────────────────── завод SX-EW ─────────────────────────────

/**
 * Оксидная ветка после площадки: продуктивный раствор → экстракция (SX) → электролиз (EW) → катоды.
 * Живые величины — из двойников `heap-leach` и `sxew`; концентрация электролита в модели не считается.
 */
function SxEw({ sim }: { sim: Simulation }) {
  const L = sim.leach;
  const on = L.plsM3h > 0;
  const cells = 16; // ванн на схеме; в серии их EW_CELLS
  return (
    <div>
      <svg viewBox="0 0 1000 420" className="w-full">
        <defs>
          <marker id="sxArr" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={6} markerHeight={6} orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill={C.pipe} />
          </marker>
        </defs>

        {/* пруд продуктивного раствора */}
        <g transform="translate(14 40)">
          <rect width={190} height={130} rx={8} fill={C.box} stroke="#1f8f72" strokeWidth={1.5} />
          <rect x={14} y={54} width={162} height={58} rx={5} fill="#1f8f72" fillOpacity={0.5} />
          <text x={95} y={24} textAnchor="middle" fontSize={12.5} fontWeight={700} fill={C.text}>Пруд PLS</text>
          <text x={95} y={44} textAnchor="middle" fontSize={11} fill={C.dim}>продуктивный раствор с карт</text>
          <text x={95} y={82} textAnchor="middle" fontSize={17} fontWeight={800} fill={C.text} fontFamily="var(--font-mono)">{fmtInt(L.plsM3h)} м³/ч</text>
          <text x={95} y={102} textAnchor="middle" fontSize={13} fill="#67e8f9">{L.plsGpl.toFixed(2)} г/л Cu</text>
        </g>
        <line x1={204} y1={105} x2={252} y2={105} stroke={C.pipe} strokeWidth={3} markerEnd="url(#sxArr)" />

        {/* экстракция */}
        <g transform="translate(256 20)">
          <rect width={330} height={190} rx={8} fill={C.box} stroke="#c9933f" strokeWidth={1.5} />
          <text x={165} y={24} textAnchor="middle" fontSize={12.5} fontWeight={700} fill={C.text}>Экстракция (SX) · миксер-отстойники</text>
          {/* две стадии */}
          <g transform="translate(16 40)">
            <rect width={140} height={62} rx={6} fill={C.boxHi} stroke={C.line} />
            <text x={70} y={20} textAnchor="middle" fontSize={11} fill={C.dim}>стадия 1</text>
            <text x={70} y={38} textAnchor="middle" fontSize={11.5} fill={C.text}>органика забирает</text>
            <text x={70} y={53} textAnchor="middle" fontSize={11.5} fill={C.text}>медь из раствора</text>
          </g>
          <g transform="translate(174 40)">
            <rect width={140} height={62} rx={6} fill={C.boxHi} stroke={C.line} />
            <text x={70} y={20} textAnchor="middle" fontSize={11} fill={C.dim}>стадия 2</text>
            <text x={70} y={38} textAnchor="middle" fontSize={11.5} fill={C.text}>кислота снимает</text>
            <text x={70} y={53} textAnchor="middle" fontSize={11.5} fill={C.text}>медь с органики</text>
          </g>
          {/* замкнутый контур органики */}
          <path d="M156 60 L174 60" stroke="#c9933f" strokeWidth={3} markerEnd="url(#sxArr)" />
          <path d="M244 112 L244 130 L86 130 L86 112" fill="none" stroke="#c9933f" strokeWidth={2.5} strokeDasharray="6 5" />
          <text x={165} y={146} textAnchor="middle" fontSize={11} fill="#c9933f">органика возвращается по кругу</text>
          <text x={165} y={170} textAnchor="middle" fontSize={11.5} fill={C.dim}>
            извлечение меди из раствора {Math.round(SX_EFFICIENCY * 100)} %
          </text>
        </g>
        <line x1={588} y1={105} x2={636} y2={105} stroke={C.pipe} strokeWidth={3} markerEnd="url(#sxArr)" />
        <text x={602} y={97} textAnchor="middle" fontSize={10} fill={C.dim}>электролит</text>

        {/* электролиз */}
        <g transform="translate(640 20)">
          <rect width={346} height={190} rx={8} fill={C.box} stroke="#b45309" strokeWidth={1.5} />
          <text x={173} y={24} textAnchor="middle" fontSize={12.5} fontWeight={700} fill={C.text}>Электролиз (EW) · ванны</text>
          {Array.from({ length: cells }, (_, i) => (
            <g key={i} transform={`translate(${16 + i * 20} 40)`}>
              <rect width={15} height={64} rx={2} fill={C.boxHi} stroke={C.line} />
              <rect x={3} y={6} width={9} height={52} rx={1} fill={on ? '#c2763a' : C.line} fillOpacity={on ? 0.9 : 0.4} />
            </g>
          ))}
          <text x={173} y={126} textAnchor="middle" fontSize={11} fill={C.dim}>на схеме {cells} ванн из {EW_CELLS} в серии</text>
          <text x={173} y={152} textAnchor="middle" fontSize={16} fontWeight={800} fill="#f59e0b" fontFamily="var(--font-mono)">
            {L.ewKA.toFixed(1)} кА
          </text>
          <text x={173} y={172} textAnchor="middle" fontSize={11.5} fill={C.dim}>ток серии — по нему и растёт медь на катодах</text>
        </g>

        {/* рафинат обратно и выход катодов */}
        <path d="M421 210 L421 250 L107 250 L107 174" fill="none" stroke="#4a86a8" strokeWidth={3} strokeDasharray="7 5" markerEnd="url(#sxArr)" />
        <text x={264} y={244} textAnchor="middle" fontSize={11.5} fill="#4a86a8">рафинат — обратно на орошение карт</text>

        <g transform="translate(640 280)">
          <rect width={346} height={118} rx={8} fill={C.boxHi} stroke="#c2763a" strokeWidth={1.5} />
          <text x={173} y={26} textAnchor="middle" fontSize={12} fill={C.dim}>Катодная медь 99,99 %</text>
          <text x={173} y={64} textAnchor="middle" fontSize={26} fontWeight={800} fill="#f59e0b" fontFamily="var(--font-mono)">
            {L.cathodeT.toFixed(1)} т
          </text>
          <text x={173} y={88} textAnchor="middle" fontSize={12} fill={C.dim}>за смену · темп {fmtInt(L.cathodeTpd)} т/сут</text>
          <text x={173} y={107} textAnchor="middle" fontSize={11.5} fill={C.text}>готовый металл, без медеплавильного завода</text>
        </g>
        <g transform="translate(14 280)">
          <rect width={600} height={118} rx={8} fill={C.box} stroke={C.line} />
          <text x={16} y={26} fontSize={12} fill={C.dim}>Как это работает</text>
          <text x={16} y={50} fontSize={12} fill={C.text}>Раствор с карт слабый. Органика собирает из него только медь и отдаёт её</text>
          <text x={16} y={70} fontSize={12} fill={C.text}>в крепкий электролит — раствор очищается и концентрируется. Дальше ток</text>
          <text x={16} y={90} fontSize={12} fill={C.text}>осаждает медь на катодах ровным слоем; листы снимают раз в несколько суток.</text>
          <text x={16} y={110} fontSize={11.5} fill={C.dim}>Концентрация электролита и состав органики в модели не считаются.</text>
        </g>
      </svg>
      <Stats>
        <Stat label="Медь перешла в раствор" value={`${L.cuLeachedT.toFixed(1)} т`} />
        <Stat label="Катодная медь за смену" value={`${L.cathodeT.toFixed(1)} т`} tone={C.ok} />
        <Stat label="Ток серии электролиза" value={`${L.ewKA.toFixed(1)} кА`} />
        <Stat label="Серной кислоты за смену" value={`${fmtInt(L.acidT)} т`} />
      </Stats>
      <div className="mt-2 text-[11.5px] text-ink-3">
        Завод питается раствором с площадки выщелачивания — самосвалы сюда не ездят. Параметры (извлечение на экстракции, число ванн) — оценки по открытым данным.
      </div>
    </div>
  );
}

// ───────────────────────────── хвостохранилище ─────────────────────────────

/**
 * Разрез чаши: ограждающая дамба, намытый пляж, пруд оборотной воды и запас до гребня.
 * Всё живое — из двойника `tailings`; фильтрационный расчёт в модели не ведётся.
 */
function Tailings({ sim }: { sim: Simulation }) {
  const t = sim.tailings;
  const G = 330; // отметка естественного рельефа на схеме
  const PX = 5.6; // пикселей на метр по высоте
  const yOf = (m: number) => G - m * PX;
  const crest = yOf(t.crestM);
  const beach = yOf(t.beachM);
  const pond = yOf(t.beachM + t.pondM);
  // Внутренний откос дамбы: от гребня (430) к подошве (560) — на нём лежит урез воды.
  const slopeX = (y: number) => 430 + (130 * (y - crest)) / (G - crest);
  const tone = t.status === 'alarm' ? C.bad : t.status === 'watch' ? C.warn : C.ok;
  const statusRu = t.status === 'alarm' ? 'запас до гребня ниже нормы' : t.status === 'watch' ? 'под наблюдением' : 'в норме';
  return (
    <div>
      <svg viewBox="0 0 1000 400" className="w-full">
        <defs>
          <marker id="tsfArr" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={6} markerHeight={6} orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill={C.pipe} />
          </marker>
          <marker id="tsfArrW" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={6} markerHeight={6} orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill="#4fb3c4" />
          </marker>
        </defs>

        {/* подача пульпы с фабрики */}
        <g transform="translate(14 8)">
          <rect width={250} height={66} rx={8} fill={C.box} stroke={C.line} />
          <text x={12} y={21} fontSize={12} fill={C.dim}>С фабрики по пульпопроводу</text>
          <text x={12} y={44} fontSize={16} fontWeight={800} fill={C.text} fontFamily="var(--font-mono)">{fmtInt(t.pulpM3h)} м³/ч</text>
          <text x={12} y={60} fontSize={11.5} fill={C.dim}>{fmtInt(t.solidsTph)} т/ч твёрдого · {SOLIDS_PCT} % в пульпе</text>
        </g>
        <path d={`M264 41 L300 41 L300 ${crest - 13}`} fill="none" stroke={C.pipe} strokeWidth={3} markerEnd="url(#tsfArr)" />

        {/* заполнение чаши */}
        <g transform="translate(700 8)">
          <rect width={286} height={66} rx={8} fill={C.box} stroke={C.line} />
          <text x={12} y={21} fontSize={12} fill={C.dim}>Заполнение чаши</text>
          <rect x={12} y={30} width={262} height={13} rx={6.5} fill={C.boxHi} />
          <rect x={12} y={30} width={Math.max(4, (262 * t.fillPct) / 100)} height={13} rx={6.5} fill="#a16207" />
          <text x={12} y={59} fontSize={11.5} fill={C.text}>
            {t.fillPct.toFixed(1)} % · {Math.round(t.storedT / 1e6)} из {CAPACITY_MT} млн т
          </text>
        </g>

        {/* естественный рельеф, тело дамбы, пляж и пруд */}
        <line x1={20} y1={G} x2={980} y2={G} stroke={C.line} strokeWidth={2} />
        <path d={`M120 ${G} L300 ${crest} L430 ${crest} L560 ${G} Z`} fill="#8d7a62" fillOpacity={0.55} stroke="#b3a287" strokeWidth={1.5} />
        <path d={`M560 ${G} L700 ${beach} L980 ${beach - 46} L980 ${G} Z`} fill="#c4b9a4" fillOpacity={0.5} stroke="#c4b9a4" />
        <path d={`M${slopeX(pond)} ${pond} L700 ${pond} L700 ${beach} L560 ${G} Z`} fill="#2d6f7d" fillOpacity={0.8} stroke="#4fb3c4" />

        {/* отметки */}
        <text x={400} y={crest - 12} textAnchor="middle" fontSize={11.5} fill={C.dim}>гребень дамбы · {t.crestM.toFixed(1)} м (проект {CREST_FINAL_M} м)</text>
        <text x={592} y={pond - 12} fontSize={12} fill="#7fdbe8">пруд · {t.pondM.toFixed(2)} м</text>
        <text x={870} y={beach + 48} textAnchor="middle" fontSize={12} fill="#4a4232">намытые хвосты · пляж {t.beachM.toFixed(1)} м</text>

        {/* запас до гребня — главный показатель */}
        <line x1={470} y1={crest} x2={980} y2={crest} stroke={C.warn} strokeDasharray="7 5" />
        <line x1={745} y1={crest} x2={745} y2={pond} stroke={tone} strokeWidth={2} />
        <path d={`M739 ${crest + 7} L745 ${crest} L751 ${crest + 7}`} fill="none" stroke={tone} strokeWidth={2} />
        <path d={`M739 ${pond - 7} L745 ${pond} L751 ${pond - 7}`} fill="none" stroke={tone} strokeWidth={2} />
        <text x={757} y={(crest + pond) / 2} fontSize={13} fontWeight={700} fill={tone}>запас до гребня {t.freeboardM.toFixed(1)} м</text>
        <text x={757} y={(crest + pond) / 2 + 17} fontSize={11} fill={C.dim}>норма — не меньше {FREEBOARD_MIN_M} м</text>

        {/* выпуски пульпы по гребню */}
        {[0, 1, 2].map((i) => (
          <g key={i} transform={`translate(${344 + i * 30} ${crest})`}>
            <rect x={-3} y={-9} width={6} height={11} fill="#7f8893" />
            <path d={`M0 2 L${7 + i} 17`} stroke="#9aa1a9" strokeWidth={1.5} />
          </g>
        ))}

        {/* пьезометры в теле дамбы */}
        {[0, 1, 2].map((i) => (
          <g key={i} transform={`translate(${285 + i * 58} ${crest + 26 + i * 14})`}>
            <line x1={0} y1={-16} x2={0} y2={24} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="3 3" />
            <circle cx={0} cy={24} r={4} fill="#f59e0b" />
          </g>
        ))}
        <text x={250} y={G - 12} fontSize={11} fill="#f59e0b">пьезометры: насыщение {Math.round(t.piezoPct)} %</text>

        {/* дренаж у низовой подошвы */}
        <g transform={`translate(22 ${G - 86})`}>
          <rect width={74} height={34} rx={5} fill={C.box} stroke={C.line} />
          <text x={37} y={15} textAnchor="middle" fontSize={10.5} fill={C.dim}>замерный лоток</text>
          <text x={37} y={29} textAnchor="middle" fontSize={12} fontWeight={700} fill={C.text}>{Math.round(t.seepageLpm)} л/мин</text>
          <text x={37} y={48} textAnchor="middle" fontSize={10.5} fill={C.dim}>фильтрация в дренаж</text>
        </g>

        {/* водозаборная башня и оборотная вода на фабрику */}
        <rect x={694} y={pond - 42} width={13} height={G - pond + 42} fill="#b8b5ad" />
        <path d={`M700 ${pond - 42} L700 118 L330 118`} fill="none" stroke="#4fb3c4" strokeWidth={3} strokeDasharray="8 5" markerEnd="url(#tsfArrW)" />
        <text x={515} y={110} textAnchor="middle" fontSize={12} fill="#4fb3c4">оборотная вода на фабрику · {fmtInt(t.reclaimM3h)} м³/ч</text>
        <text x={700} y={G + 17} textAnchor="middle" fontSize={11} fill={C.dim}>водозаборная башня</text>
        <text x={975} y={G + 17} textAnchor="end" fontSize={11} fill={C.dim}>естественный рельеф</text>
      </svg>
      <Stats>
        <Stat label="Уложено хвостов за смену" value={`${fmtInt(t.tailsT)} т`} />
        <Stat label="Воды пришло с пульпой" value={`${fmtInt(t.waterInM3)} м³`} />
        <Stat label="Вернулось на фабрику" value={`${fmtInt(t.reclaimM3)} м³`} tone={C.ok} />
        <Stat label="Забрано свежей воды" value={`${fmtInt(t.makeupM3)} м³`} tone={C.warn} />
        <Stat label="Состояние дамбы" value={statusRu} tone={tone} />
      </Stats>
      <div className="mt-2 text-[11.5px] text-ink-3">
        Контур чаши — настоящий (OpenStreetMap), ёмкость и отметки — оценки. Фильтрационный расчёт и устойчивость откосов в модели не считаются: показаны те величины, которые на реальной дамбе снимают приборами.
      </div>
    </div>
  );
}

// ───────────────────────────── склад концентрата ─────────────────────────────

/** Фабрика → крытый склад → погрузка в вагоны → состав на станцию. Всё живое из двойника. */
function ConcStore({ sim }: { sim: Simulation }) {
  const c = sim.concentrate;
  const prog = c.loadingProgress;
  const loading = c.loadLeft > 0;
  return (
    <div>
      <svg viewBox="0 0 1000 340" className="w-full">
        <defs>
          <marker id="cArr" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={6} markerHeight={6} orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill={C.pipe} />
          </marker>
        </defs>

        {/* с фабрики */}
        <g transform="translate(14 14)">
          <rect width={196} height={92} rx={8} fill={C.box} stroke={C.line} />
          <text x={14} y={24} fontSize={12} fill={C.dim}>С фабрики после сушки</text>
          <text x={14} y={52} fontSize={18} fontWeight={800} fill={C.text} fontFamily="var(--font-mono)">{fmtInt(c.producedT)} т</text>
          <text x={14} y={72} fontSize={11.5} fill={C.dim}>выпущено за смену</text>
          <text x={14} y={86} fontSize={11.5} fill="#f59e0b">концентрат ~{Math.round(CONC_GRADE * 100)} % меди</text>
        </g>
        <line x1={210} y1={60} x2={256} y2={60} stroke={C.pipe} strokeWidth={3} markerEnd="url(#cArr)" />

        {/* крытый склад */}
        <g transform="translate(260 14)">
          <rect width={250} height={132} rx={8} fill={C.box} stroke="#92400e" strokeWidth={1.5} />
          <text x={125} y={24} textAnchor="middle" fontSize={12.5} fontWeight={700} fill={C.text}>Крытый склад</text>
          {/* штабель концентрата */}
          <path d="M26 112 L80 72 L170 72 L224 112 Z" fill="#4a3f33" />
          <text x={125} y={100} textAnchor="middle" fontSize={17} fontWeight={800} fill="#f0d8b0" fontFamily="var(--font-mono)">{fmtInt(c.stockT)} т</text>
          <text x={125} y={126} textAnchor="middle" fontSize={11.5} fill={C.dim}>готово к отгрузке</text>
          <SensorDot x={228} y={40} label="весы и лазерный сканер штабеля" />
        </g>

        {/* галерея со склада и течка над тем вагоном, который грузится сейчас */}
        <path d={`M385 146 L385 170 L${90 + c.wagons * 160} 170 L${90 + c.wagons * 160} 190`} fill="none" stroke={C.pipe} strokeWidth={4} markerEnd="url(#cArr)" />
        <text x={Math.min(820, 102 + c.wagons * 160)} y={166} fontSize={11.5} fill={loading ? '#f59e0b' : C.dim}>
          {loading ? `грузится · ${Math.round(prog * 100)} %` : 'подача вагона'}
        </text>

        {/* путь и сцепка */}
        <line x1={14} y1={266} x2={986} y2={266} stroke={C.line} strokeWidth={3} />
        {Array.from({ length: TRAIN_WAGONS }, (_, i) => {
          const full = i < c.wagons ? 1 : i === c.wagons ? prog : 0;
          return (
            <g key={i} transform={`translate(${20 + i * 160} 200)`}>
              <rect width={140} height={46} rx={4} fill={C.boxHi} stroke={full > 0 ? '#92400e' : C.line} strokeWidth={full > 0 ? 2 : 1} />
              <rect x={6} y={6 + 34 * (1 - full)} width={128} height={34 * full} fill="#4a3f33" />
              <circle cx={32} cy={54} r={8} fill={C.line} />
              <circle cx={108} cy={54} r={8} fill={C.line} />
              <text x={70} y={32} textAnchor="middle" fontSize={11.5} fill={full > 0.5 ? '#f0d8b0' : C.dim}>
                {full >= 1 ? `${WAGON_T} т` : full > 0 ? `${Math.round(full * WAGON_T)} т` : 'порожний'}
              </text>
            </g>
          );
        })}
        <text x={500} y={300} textAnchor="middle" fontSize={12} fill={C.dim}>вагон ~{WAGON_T} т · в составе {TRAIN_WAGONS} вагонов (масштаб сегмента)</text>
        <SensorDot x={120} y={288} label="вагонные весы, RFID вагонов" />

        {/* отправленные составы */}
        <g transform="translate(700 14)">
          <rect width={286} height={132} rx={8} fill={C.boxHi} stroke="#c2763a" strokeWidth={1.5} />
          <text x={143} y={26} textAnchor="middle" fontSize={12} fill={C.dim}>Отправлено на станцию</text>
          <text x={143} y={66} textAnchor="middle" fontSize={28} fontWeight={800} fill="#f59e0b" fontFamily="var(--font-mono)">
            {c.trains}
          </text>
          <text x={143} y={88} textAnchor="middle" fontSize={12} fill={C.dim}>составов за смену</text>
          <text x={143} y={112} textAnchor="middle" fontSize={13} fill={C.text}>
            {fmtInt(c.shippedT)} т · ~{fmtInt(c.cuShippedT)} т меди
          </text>
        </g>
      </svg>
      <Stats>
        <Stat label="На складе" value={`${fmtInt(c.stockT)} т`} />
        <Stat label="Вагонов в составе" value={`${c.wagons} из ${TRAIN_WAGONS}`} tone={c.wagons > 0 ? C.ok : undefined} />
        <Stat label="Выпущено за смену" value={`${fmtInt(c.producedT)} т`} />
        <Stat label="Медь в отгруженном" value={`${fmtInt(c.cuShippedT)} т`} />
      </Stats>
      <div className="mt-2 text-[11.5px] text-ink-3">
        Состав масштабирован под моделируемый сегмент парка: на реальном комбинате в составе десятки вагонов. Содержание меди в концентрате — по открытым данным.
      </div>
    </div>
  );
}
