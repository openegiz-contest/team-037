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
import { fmtInt } from '../ui/format';
import { MATERIAL_COLOR, TRUCK_COLOR } from '../ui/theme';

const TITLE: Record<BuildingKind, string> = {
  crusher: 'Первичная дробилка ККД',
  plant: 'Обогатительная фабрика',
  garage: 'Гараж, АЗС и стоянка',
  leach: 'Площадка кучного выщелачивания',
  waste: 'Отвал вскрыши',
};
const TWIN_KIND: Record<BuildingKind, string> = { crusher: 'crusher', plant: 'concentrator', garage: 'garage', leach: 'heap-leach', waste: 'waste-dump' };

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
  const has3d = (kind === 'crusher' || kind === 'plant') && webglAvailable();
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
      <div className={`min-h-0 flex-1 p-3 ${show3d ? 'flex flex-col' : 'overflow-auto'}`}>
        {show3d && (
          <div className="relative min-h-0 flex-1">
            <Interior3D sim={sim} kind={kind as 'crusher' | 'plant'} light={light} />
            <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-[11.5px] text-ink-2">ЛКМ — вращение · ПКМ — сдвиг · колесо — масштаб</div>
          </div>
        )}
        {!show3d && kind === 'crusher' && <Crusher sim={sim} onTruck={onTruck} />}
        {!show3d && kind === 'plant' && <Plant sim={sim} />}
        {kind === 'garage' && <Garage sim={sim} onTruck={onTruck} />}
        {(kind === 'leach' || kind === 'waste') && <Dump sim={sim} kind={kind} onTruck={onTruck} />}
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
  const starved = c.binT <= 0.01;
  const crushing = c.active.length > 0;
  const g = sim.binGrade;
  const inBand = Math.abs(g - cfg.grade.targetPct) <= cfg.grade.bandPct;
  const fillCol = pct < 0.2 ? C.bad : pct < 0.45 ? C.warn : C.ok;
  const outTph = starved ? 0 : cfg.dumps.crusher.plantFeedTpm * 60;
  const minutesLeft = starved ? 0 : c.binT / cfg.dumps.crusher.plantFeedTpm;
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
        <Unit x={270} y={140} w={190} h={130} title="Конусная дробилка" value={starved ? 'ждёт руду' : crushing ? 'дробит' : 'вхолостую'} tone={crushing ? C.ok : starved ? C.bad : C.line}>
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
            Бункер
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
        <Flow d="M670 240 L960 240" running={!starved} label={starved ? 'конвейер стоит' : `${fmtInt(outTph)} т/ч → на фабрику`} lx={815} ly={226} />
        <SensorDot x={760} y={270} label="конвейерные весы" />
        <text x={960} y={265} textAnchor="end" fontSize={12} fill={C.dim}>
          ОФ →
        </text>
        <text x={815} y={90} textAnchor="middle" fontSize={13} fill={starved ? C.bad : minutesLeft < 20 ? C.warn : C.dim}>
          {starved ? 'ПРОСТОЙ: фабрика без руды' : `запаса руды на ${Math.round(minutesLeft)} мин работы фабрики`}
        </text>
      </svg>
      <Stats>
        <Stat label="Принято за смену" value={`${fmtInt(c.tonnes)} т`} />
        <Stat label="Простой без руды" value={`${(c.starvedSec / 60).toFixed(1)} мин`} tone={c.starvedSec > 0 ? C.bad : undefined} />
        <Stat label="Cu в бункере" value={starved ? '—' : `${g.toFixed(3)} %`} tone={inBand ? C.ok : C.warn} />
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

// ───────────────────────────── фабрика ─────────────────────────────

function Plant({ sim }: { sim: Simulation }) {
  const st = sim.stats;
  const cfg = sim.cfg;
  const running = sim.crusher.binT > 0.01;
  const feedTph = running ? cfg.dumps.crusher.plantFeedTpm * 60 : 0;
  const g = sim.binGrade;
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

function Dump({ sim, kind, onTruck }: { sim: Simulation; kind: 'leach' | 'waste'; onTruck: (id: number) => void }) {
  const d = sim.dumps[kind === 'leach' ? 1 : 2];
  const mat = kind === 'leach' ? 'oxide' : 'waste';
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
      {kind === 'leach' && (
        <div className="mt-2 text-[11.5px] text-ink-3">Орошение штабеля раствором и извлечение меди из оксидной руды в модели не считаются — показан учёт отсыпки.</div>
      )}
    </div>
  );
}
