/**
 * Раздел «Оборудование»: парк техники карьера. Карточки экскаваторов и самосвалов с текущим
 * состоянием, добавление и вывод машин. Изменения копятся в черновике и вводятся с начала новой
 * смены (на стенде — команда reset { fleet } в двойник управления; симулятор пересоздаёт двойники).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import {
  defaultGrade,
  EXCAVATOR_MODELS,
  fleetKey,
  MAX_EXCAVATORS,
  MIN_FACE_GAP_DEG,
  nextExcavatorName,
  PIT_LABEL,
  ringLabel,
  ringsOf,
  TRUCKS_RANGE,
  validateFleet,
  type Fleet,
} from '../platform/fleet';
import { EXCAVATOR_SENSORS, TRUCK_SENSORS } from '../platform/sensors';
import { MATERIAL_SHORT, TRUCK_STATE_LABEL, type Material, type Simulation } from '../sim';
import type { ExcavatorSpec } from '../sim/config';
import { fmtInt } from '../ui/format';
import { MATERIAL_COLOR, TRUCK_COLOR } from '../ui/theme';
import { stateTone, TONE_COLOR, VALUE_LABEL } from '../ui/twinLabels';

interface Props {
  /** Парк, который работает сейчас. */
  fleet: Fleet;
  /** Реальный карьер (для живого состояния машин). */
  sim: Simulation;
  platform: boolean;
  now: number;
  running: boolean;
  onToggleRun: () => void;
  onApply: (f: Fleet) => void;
  onLocate: (sel: { kind: 'truck' | 'excavator'; id: number }) => void;
}

const MATERIALS: Material[] = ['sulfide', 'oxide', 'waste'];

export function FleetPage({ fleet, sim, platform, now, running, onToggleRun, onApply, onLocate }: Props) {
  const [draft, setDraft] = useState<Fleet>(() => structuredClone(fleet));
  const base = useRef(fleetKey(fleet));
  // Парк применён (или пришёл со стенда) — черновик подтягивается, если его не правили.
  useEffect(() => {
    const k = fleetKey(fleet);
    if (k !== base.current) {
      setDraft((d) => (fleetKey(d) === base.current ? structuredClone(fleet) : d));
      base.current = k;
    }
  }, [fleet]);

  const [form, setForm] = useState<{ material: Material; pit: number; ring: number; angleDeg: number; model: string } | null>(null);
  const changed = fleetKey(draft) !== fleetKey(fleet);
  const errors = validateFleet(draft);
  const formSpec: ExcavatorSpec | null = form
    ? {
        name: nextExcavatorName(draft),
        material: form.material,
        ring: form.ring,
        angleDeg: form.angleDeg,
        pit: form.pit,
        rateTpm: EXCAVATOR_MODELS.find((m) => m.id === form.model)!.rateTpm,
        gradePct: defaultGrade(form.material, form.ring),
      }
    : null;
  const formErrors = formSpec ? validateFleet({ ...draft, excavators: [...draft.excavators, formSpec] }).filter((e) => e.includes(formSpec.name) || e.includes('не больше')) : [];

  const currentNames = new Set(fleet.excavators.map((e) => e.name));
  const draftNames = new Set(draft.excavators.map((e) => e.name));
  const removedEx = fleet.excavators.filter((e) => !draftNames.has(e.name));
  const dTrucks = draft.trucks - fleet.trucks;

  const removeEx = (name: string) => setDraft((d) => ({ ...d, excavators: d.excavators.filter((e) => e.name !== name) }));
  const canRemove = (e: ExcavatorSpec) => draft.excavators.filter((x) => x.material === e.material).length > 1;

  const summary = useMemo(() => {
    const parts: string[] = [];
    if (dTrucks) parts.push(`${dTrucks > 0 ? '+' : '−'}${Math.abs(dTrucks)} самосв.`);
    const added = draft.excavators.filter((e) => !currentNames.has(e.name)).map((e) => e.name);
    if (added.length) parts.push(`+ ${added.join(', ')}`);
    if (removedEx.length) parts.push(`− ${removedEx.map((e) => e.name).join(', ')}`);
    return parts.join(' · ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, fleet]);

  const busyTrucks = sim.trucks.filter((t) => t.state === 'broken' || t.state === 'service').length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-5">
      <PageHeader
        title="Оборудование"
        subtitle={
          <>
            Парк техники карьера. Машины можно добавлять и выводить из работы — изменения вводятся с начала новой смены, как на предприятии: новую
            машину ставят в наряд на смену. {platform ? 'На стенде симулятор создаст и удалит двойники в Ditto.' : ''}
          </>
        }
        now={now}
        running={running}
        onToggleRun={onToggleRun}
      />

      {/* Сводка и применение */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-[1fr_1fr_1fr_1.6fr]">
        <Tile label="Самосвалов в смене" value={String(fleet.trucks)} hint={`${busyTrucks} в ремонте · грузоподъёмность ${fmtInt(fleet.trucks * sim.cfg.truck.payloadT)} т`} />
        <Tile
          label="Экскаваторов"
          value={String(fleet.excavators.length)}
          hint={MATERIALS.map((m) => `${MATERIAL_SHORT[m]} ${fleet.excavators.filter((e) => e.material === m).length}`).join(' · ')}
        />
        <Tile label="Погрузка, т/мин" value={String(fleet.excavators.reduce((s, e) => s + e.rateTpm, 0))} hint="суммарная производительность экскаваторов" />
        <div className={`panel flex flex-col justify-between gap-2 px-4 py-3 ${changed ? 'border-amber-500/60' : ''}`}>
          <div>
            <div className="text-[11.5px] text-ink-3">Черновик изменений</div>
            <div className="mt-0.5 text-[15px] font-semibold">{changed ? summary || 'изменено' : 'Нет изменений — парк совпадает с текущей сменой'}</div>
            {errors.length > 0 && <div className="mt-1 text-[12px] text-red-400">{errors[0]}</div>}
          </div>
          <div className="flex gap-2">
            <button
              disabled={!changed || errors.length > 0}
              onClick={() => onApply(structuredClone(draft))}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-[13px] font-bold text-black hover:bg-amber-400 disabled:opacity-40"
            >
              ↺ Применить — новая смена
            </button>
            <button disabled={!changed} onClick={() => setDraft(structuredClone(fleet))} className="rounded-lg bg-panel-2 px-3 py-1.5 text-[13px] font-semibold text-ink-2 hover:text-ink disabled:opacity-40">
              Отменить черновик
            </button>
          </div>
        </div>
      </div>

      {/* Экскаваторы */}
      <section className="panel">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <h3 className="text-[15px] font-semibold">Экскаваторы</h3>
          <span className="text-[12px] text-ink-3">
            {draft.excavators.length} из {MAX_EXCAVATORS} · {EXCAVATOR_SENSORS.length} датчиков на каждом
          </span>
        </div>
        <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid content-start gap-2 sm:grid-cols-2 2xl:grid-cols-3">
            {[...draft.excavators, ...removedEx].map((e) => {
              const live = sim.excavators.find((x) => x.name === e.name);
              const isNew = !currentNames.has(e.name);
              const isRemoved = !draftNames.has(e.name);
              const model = EXCAVATOR_MODELS.find((m) => m.rateTpm === e.rateTpm);
              return (
                <div
                  key={e.name}
                  className={`flex flex-col gap-2 rounded-xl border p-3 ${isRemoved ? 'border-dashed border-red-500/50 opacity-55' : isNew ? 'border-dashed border-amber-500/70 bg-amber-500/5' : 'border-line bg-panel-2/50'}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[13px] font-bold text-black" style={{ background: MATERIAL_COLOR[e.material] }}>
                      {e.name}
                    </span>
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="text-[14px] font-semibold">
                        {MATERIAL_SHORT[e.material]} · {model?.name ?? `${e.rateTpm} т/мин`}
                      </div>
                      <div className="text-[12px] text-ink-3">
                        {PIT_LABEL[e.pit ?? 0]} · {ringLabel(e.pit ?? 0, e.ring)} · {e.angleDeg}° · {e.rateTpm} т/мин
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[12px]">
                    {isRemoved ? (
                      <span className="text-red-400">будет выведен со следующей смены</span>
                    ) : isNew ? (
                      <span className="text-amber-300">новый — в работе со следующей смены</span>
                    ) : live ? (
                      <>
                        <span className="h-2 w-2 rounded-full" style={{ background: TONE_COLOR[stateTone(live.state)] }} />
                        <span className="text-ink-2">{VALUE_LABEL[live.state]}</span>
                        <span className="text-ink-3">· очередь {live.queue.length} · {fmtInt(live.tonnes)} т</span>
                      </>
                    ) : null}
                  </div>
                  <div className="mt-auto flex gap-2">
                    {isRemoved ? (
                      <button onClick={() => setDraft((d) => ({ ...d, excavators: [...d.excavators, e] }))} className="text-[12px] font-semibold text-emerald-300 hover:underline">
                        ↶ Вернуть
                      </button>
                    ) : (
                      <>
                        {live && !isNew && (
                          <button onClick={() => onLocate({ kind: 'excavator', id: live.id })} className="text-[12px] font-semibold text-ink-2 hover:text-amber-300">
                            ◎ На карте
                          </button>
                        )}
                        <button
                          onClick={() => removeEx(e.name)}
                          disabled={!canRemove(e)}
                          title={canRemove(e) ? '' : 'На каждом материале нужен хотя бы один экскаватор'}
                          className="ml-auto text-[12px] font-semibold text-red-400 hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
                        >
                          {isNew ? '✕ Убрать' : '− Вывести из работы'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            {!form && draft.excavators.length < MAX_EXCAVATORS && (
              <button
                onClick={() => setForm({ material: 'waste', pit: 0, ring: 2, angleDeg: freeAngle(draft, 0, 2), model: 'b22' })}
                className="grid min-h-[132px] place-items-center rounded-xl border border-dashed border-line text-[14px] font-semibold text-ink-2 hover:border-amber-500 hover:text-amber-300"
              >
                + Добавить экскаватор
              </button>
            )}
          </div>

          {/* Мини-карта карьера и форма нового экскаватора */}
          <div className="flex flex-col gap-3">
            <PitMap
              sim={sim}
              draft={draft}
              currentNames={currentNames}
              pending={formSpec}
              pit={form?.pit ?? 0}
              onPick={form ? (ring, angleDeg) => setForm({ ...form, ring, angleDeg }) : undefined}
            />
            {form && formSpec && (
              <div className="rounded-xl border border-amber-500/50 bg-amber-500/5 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[14px] font-semibold">Новый экскаватор {formSpec.name}</span>
                  <button onClick={() => setForm(null)} className="text-ink-3 hover:text-ink">
                    ✕
                  </button>
                </div>
                <Field label="Материал">
                  {MATERIALS.map((m) => (
                    <Choice key={m} active={form.material === m} onClick={() => setForm({ ...form, material: m })} color={MATERIAL_COLOR[m]}>
                      {MATERIAL_SHORT[m]}
                    </Choice>
                  ))}
                </Field>
                <Field label="Выработка">
                  {PIT_LABEL.map((name, pi) => (
                    <Choice key={name} active={form.pit === pi} onClick={() => { const ring = Math.min(form.ring, ringsOf(pi)); setForm({ ...form, pit: pi, ring, angleDeg: freeAngle(draft, pi, ring, form.angleDeg) }); }}>
                      {name}
                    </Choice>
                  ))}
                </Field>
                <Field label="Горизонт">
                  {Array.from({ length: ringsOf(form.pit) }, (_, k) => k + 1).map((r) => (
                    <Choice key={r} active={form.ring === r} onClick={() => setForm({ ...form, ring: r, angleDeg: freeAngle(draft, form.pit, r, form.angleDeg) })}>
                      {ringLabel(form.pit, r)}
                    </Choice>
                  ))}
                </Field>
                <Field label={`Место забоя: ${form.angleDeg}° (или клик по карте)`}>
                  <input
                    type="range"
                    min={0}
                    max={350}
                    step={10}
                    value={form.angleDeg}
                    onChange={(e) => setForm({ ...form, angleDeg: Number(e.target.value) })}
                    className="w-full accent-amber-500"
                  />
                </Field>
                <Field label="Модель">
                  {EXCAVATOR_MODELS.map((m) => (
                    <Choice key={m.id} active={form.model === m.id} onClick={() => setForm({ ...form, model: m.id })}>
                      {m.name} · {m.rateTpm} т/мин
                    </Choice>
                  ))}
                </Field>
                <div className="mt-2 text-[12px] text-ink-3">
                  Содержание Cu в забое (оценка): {formSpec.gradePct ? `${formSpec.gradePct}%` : '— (вскрыша)'} · датчиков: {EXCAVATOR_SENSORS.length}
                </div>
                {formErrors.length > 0 && <div className="mt-2 text-[12px] text-red-400">{formErrors[0]}</div>}
                <button
                  disabled={formErrors.length > 0}
                  onClick={() => {
                    setDraft((d) => ({ ...d, excavators: [...d.excavators, formSpec] }));
                    setForm(null);
                  }}
                  className="mt-3 w-full rounded-lg bg-amber-500 py-2 text-[13px] font-bold text-black hover:bg-amber-400 disabled:opacity-40"
                >
                  + Добавить в черновик
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Самосвалы */}
      <section className="panel">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <h3 className="text-[15px] font-semibold">Самосвалы</h3>
          <span className="text-[12px] text-ink-3">
            {draft.trucks} (от {TRUCKS_RANGE[0]} до {TRUCKS_RANGE[1]}) · класс {sim.cfg.truck.payloadT} т · {TRUCK_SENSORS.length} датчиков на каждом
          </span>
          <div className="ml-auto flex gap-2">
            <button
              disabled={draft.trucks <= TRUCKS_RANGE[0]}
              onClick={() => setDraft((d) => ({ ...d, trucks: d.trucks - 1 }))}
              className="rounded-lg bg-panel-2 px-3 py-1.5 text-[13px] font-semibold text-red-400 ring-1 ring-line hover:bg-red-500/10 disabled:opacity-40"
            >
              − Вывести №{100 + draft.trucks}
            </button>
            <button
              disabled={draft.trucks >= TRUCKS_RANGE[1]}
              onClick={() => setDraft((d) => ({ ...d, trucks: d.trucks + 1 }))}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-[13px] font-bold text-black hover:bg-amber-400 disabled:opacity-40"
            >
              + Добавить самосвал №{101 + draft.trucks}
            </button>
          </div>
        </div>
        <div className="grid gap-2 p-4 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-6">
          {Array.from({ length: Math.max(draft.trucks, fleet.trucks) }, (_, i) => {
            const t = sim.trucks[i];
            const isNew = i >= fleet.trucks;
            const isRemoved = i >= draft.trucks;
            const fuelPct = t ? (t.fuelL / sim.cfg.truck.fuelTankL) * 100 : 100;
            return (
              <div
                key={i}
                className={`flex flex-col gap-1 rounded-lg border px-3 py-2 ${isRemoved ? 'border-dashed border-red-500/50 opacity-55' : isNew ? 'border-dashed border-amber-500/70 bg-amber-500/5' : 'border-line bg-panel-2/50'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-bold">№{101 + i}</span>
                  {t && !isNew && (
                    <button onClick={() => onLocate({ kind: 'truck', id: i })} className="text-[11.5px] text-ink-3 hover:text-amber-300" title="Показать на карте">
                      ◎
                    </button>
                  )}
                </div>
                {isRemoved ? (
                  <span className="text-[11.5px] text-red-400">выводится со следующей смены</span>
                ) : isNew || !t ? (
                  <span className="text-[11.5px] text-amber-300">новый — со следующей смены</span>
                ) : (
                  <>
                    <span className="flex items-center gap-1.5 text-[12px] text-ink-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: TRUCK_COLOR[t.state] }} />
                      {TRUCK_STATE_LABEL[t.state]}
                    </span>
                    <span className="num text-[11.5px] text-ink-3">
                      {fmtInt(t.loadT)} т · топливо {Math.round(fuelPct)}%{t.health.alert ? ' · ⚡' : ''}
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/** Свободный угол на горизонте (не ближе MIN_FACE_GAP_DEG к другим забоям). */
function freeAngle(f: Fleet, pit: number, ring: number, prefer = 0): number {
  const taken = f.excavators.filter((e) => (e.pit ?? 0) === pit && e.ring === ring).map((e) => e.angleDeg);
  const ok = (a: number) => taken.every((t) => Math.abs(((((a - t) % 360) + 540) % 360) - 180) >= MIN_FACE_GAP_DEG);
  for (let k = 0; k < 36; k++) {
    for (const a of [prefer + k * 10, prefer - k * 10]) {
      const n = ((a % 360) + 360) % 360;
      if (ok(n)) return n;
    }
  }
  return prefer;
}

/** Вид карьера сверху: горизонты, забои и место нового экскаватора. Клик задаёт горизонт и угол. */
function PitMap({
  sim,
  draft,
  currentNames,
  pending,
  onPick,
  pit,
}: {
  sim: Simulation;
  draft: Fleet;
  currentNames: Set<string>;
  pending: ExcavatorSpec | null;
  onPick?: (ring: number, angleDeg: number) => void;
  pit: number;
}) {
  const P = sim.cfg.pits[pit] ?? sim.cfg.pits[0];
  const a = P.semiMajorM;
  const b = P.semiMinorM;
  const rr = (P.rotDeg * Math.PI) / 180;
  /** Координаты модели → локальные координаты выработки (как в её собственной системе). */
  const local = (x: number, y: number) => {
    const dx = x - P.cx;
    const dy = y - P.cy;
    return { x: dx * Math.cos(rr) + dy * Math.sin(rr), y: -dx * Math.sin(rr) + dy * Math.cos(rr) };
  };
  const W = 340;
  const H = 210;
  const k = Math.min((W - 30) / (2 * a), (H - 30) / (2 * b));
  const scales = (sim.layout.pits[pit] ?? sim.layout.pits[0]).ringScales;
  const pos = (ring: number, deg: number) => {
    const s = scales[ring] - 0.045;
    const t = (deg * Math.PI) / 180;
    return { x: W / 2 + Math.cos(t) * a * s * k, y: H / 2 + Math.sin(t) * b * s * k };
  };
  const live = new Map(sim.excavators.map((e) => [e.name, e]));
  const marks = draft.excavators.filter((e) => (e.pit ?? 0) === pit).map((e) => {
    const l = live.get(e.name);
    const lp = l ? local(l.x, l.y) : null;
    const p = lp && currentNames.has(e.name) ? { x: W / 2 + lp.x * k, y: H / 2 + lp.y * k } : pos(e.ring, e.angleDeg);
    return { e, p, isNew: !currentNames.has(e.name) };
  });
  const click = (ev: React.MouseEvent<SVGSVGElement>) => {
    if (!onPick) return;
    const r = ev.currentTarget.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * W - W / 2;
    const y = ((ev.clientY - r.top) / r.height) * H - H / 2;
    const deg = Math.round(((((Math.atan2(y / b, x / a) * 180) / Math.PI) % 360) + 360) % 360 / 10) * 10 % 360;
    const rel = Math.hypot(x / (a * k), y / (b * k));
    let ring = 1;
    let best = Infinity;
    for (let i = 1; i < scales.length; i++) {
      const d = Math.abs(scales[i] - rel);
      if (d < best) {
        best = d;
        ring = i;
      }
    }
    onPick(ring, deg);
  };
  return (
    <div className="scene-ui rounded-xl border border-line bg-[#0d1013] p-2">
      <div className="mb-1 flex items-center justify-between px-1 text-[11.5px] text-ink-3">
        <span>{P.name} сверху · горизонты и забои</span>
        {onPick && <span className="text-amber-300">клик — выбрать место</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className={`w-full ${onPick ? 'cursor-crosshair' : ''}`} onClick={click}>
        {scales.map((s, i) => (
          <ellipse key={i} cx={W / 2} cy={H / 2} rx={a * s * k} ry={b * s * k} fill={i === 0 ? '#2a2418' : 'none'} stroke={i === 0 ? '#5c5040' : '#4a4234'} strokeWidth={i === 0 ? 1.5 : 1} strokeDasharray={i === 0 ? undefined : '3 3'} />
        ))}
        {marks.map(({ e, p, isNew }) => (
          <g key={e.name}>
            <circle cx={p.x} cy={p.y} r={7} fill={MATERIAL_COLOR[e.material]} stroke={isNew ? '#f59e0b' : '#0d1013'} strokeWidth={isNew ? 2 : 1.5} strokeDasharray={isNew ? '2 2' : undefined} />
            <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize={10} fill="#e8eaed" fontWeight={600}>
              {e.name}
            </text>
          </g>
        ))}
        {pending &&
          (() => {
            const p = pos(pending.ring, pending.angleDeg);
            return (
              <g>
                <circle cx={p.x} cy={p.y} r={11} fill="none" stroke="#f59e0b" strokeWidth={2} className="blink" />
                <circle cx={p.x} cy={p.y} r={6} fill={MATERIAL_COLOR[pending.material]} />
                <text x={p.x} y={p.y + 22} textAnchor="middle" fontSize={10} fill="#fbbf24" fontWeight={700}>
                  {pending.name}
                </text>
              </g>
            );
          })()}
      </svg>
      <div className="flex flex-wrap gap-3 px-1 text-[11px] text-ink-3">
        {MATERIALS.map((m) => (
          <span key={m} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: MATERIAL_COLOR[m] }} />
            {MATERIAL_SHORT[m]}
          </span>
        ))}
        <span>пунктир — новый</span>
      </div>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="panel px-4 py-3">
      <div className="text-[11.5px] text-ink-3">{label}</div>
      <div className="num mt-0.5 text-[24px] font-bold">{value}</div>
      <div className="truncate text-[11.5px] text-ink-3" title={hint}>
        {hint}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <div className="mb-1 text-[11.5px] text-ink-3">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Choice({ active, onClick, color, children }: { active: boolean; onClick: () => void; color?: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] font-semibold ${active ? 'border-amber-500 bg-amber-500/15 text-ink' : 'border-line text-ink-2 hover:border-ink-3'}`}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      {children}
    </button>
  );
}
