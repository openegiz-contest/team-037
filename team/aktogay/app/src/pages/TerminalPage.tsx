/**
 * Раздел «Терминал водителя»: планшет в кабине самосвала. Текущее задание от системы диспетчеризации
 * (или приказ диспетчера), кнопки ответа, сообщения диспетчера, топливо, груз, усталость.
 */
import { useState } from 'react';
import type { Session } from '../platform/accounts';
import { orderLabel, type DispatchCommand, type DispatchState, type OrderCode } from '../platform/dispatch';
import { activeScenarioLabels } from '../platform/scenarios';
import { FATIGUE_ALERT, MATERIAL_SHORT, type Simulation } from '../sim';
import { hhmm } from '../sim/causality';
import { TRUCK_COLOR } from '../ui/theme';
import { fmtInt } from '../ui/format';
import { STATE_RU } from './DispatchPage';

interface Props {
  sim: Simulation;
  state: DispatchState;
  send: (c: DispatchCommand) => void;
  session: Session;
  onLogout: () => void;
}

const MATERIAL_RU = { sulfide: 'сульфидная руда', oxide: 'оксидная руда', waste: 'вскрыша' } as const;

/** Задание крупно: что делать сейчас. */
function task(sim: Simulation, i: number): { title: string; detail: string } {
  const t = sim.trucks[i];
  const d = t.dest;
  const g = sim.layout.graph;
  const left = d ? Math.hypot(g.nodes[sim.destinationNode(d)].x - t.x, g.nodes[sim.destinationNode(d)].y - t.y) : 0;
  const km = left > 50 ? ` · ${(left / 1000).toFixed(1)} км` : '';
  switch (t.state) {
    case 'empty':
      if (d?.kind === 'excavator') {
        const ex = sim.excavators[d.id];
        return { title: `Езжай к ${ex.name}`, detail: `забой: ${MATERIAL_RU[ex.material]}${km}` };
      }
      if (d?.kind === 'garage') return { title: d.purpose === 'service' ? 'В ремонтный бокс' : 'В гараж / на АЗС', detail: `своё место на стоянке${km}` };
      return { title: 'Порожний рейс', detail: km.slice(3) };
    case 'queue': {
      if (d?.kind === 'excavator') {
        const ex = sim.excavators[d.id];
        const pos = ex.queue.indexOf(t.id);
        return { title: `Очередь у ${ex.name}`, detail: pos > 0 ? `перед вами ${pos}` : 'вы следующий' };
      }
      return { title: 'Очередь на разгрузку', detail: d?.kind === 'dump' ? sim.dumps[d.id].name : '' };
    }
    case 'loading':
      return { title: 'Погрузка', detail: d?.kind === 'excavator' ? `${sim.excavators[d.id].name} · стоять под ковшом` : '' };
    case 'loaded':
      return { title: `Вези: ${t.material ? MATERIAL_RU[t.material] : 'груз'}`, detail: `${d?.kind === 'dump' ? sim.dumps[d.id].name : ''}${km}` };
    case 'dumping':
      return { title: 'Разгрузка', detail: d?.kind === 'dump' ? sim.dumps[d.id].name : '' };
    case 'refuel':
      return { title: 'Заправка', detail: 'колонка АЗС у гаража' };
    case 'service':
      return { title: 'Плановый ремонт', detail: 'ремонтный бокс — ждите механика' };
    case 'broken':
      return { title: 'Поломка', detail: 'стоять, ждать ремонтную бригаду' };
    case 'idle':
      return { title: 'На стоянке', detail: sim.manual.get(i)?.kind === 'hold' ? 'приказ диспетчера: стоять до отмены' : 'ожидание выезда на линию' };
  }
}

export function TerminalPage({ sim, state, send, session, onLogout }: Props) {
  const i = session.truck ?? 0;
  const t = sim.trucks[i];
  const [sent, setSent] = useState('');
  if (!t) return <div className="p-6 text-ink-3">Самосвала с таким номером нет в текущем парке.</div>;
  const job = task(sim, i);
  const order = state.orders[i] as OrderCode | undefined;
  const inbox = state.messages.filter((m) => m.to === 'all' || m.to === i).slice().reverse();
  const unread = inbox.filter((m) => !m.read.includes(i));
  const fuelPct = Math.round((t.fuelL / sim.cfg.truck.fuelTankL) * 100);
  const fatigue = Math.round(t.driverStats.fatigue);
  const warnings = activeScenarioLabels(sim);

  const driver = (kind: 'accept' | 'refuel' | 'fault', label: string) => {
    send({ value: 'driver', truck: i, kind });
    setSent(label);
  };

  return (
    <div className="flex h-full min-h-0 justify-center overflow-y-auto p-5">
      <div className="w-full max-w-[980px] rounded-[22px] border-[10px] border-[#1b1e24] bg-[#0b0d11] p-4 text-[#e7eaee] shadow-2xl">
        {/* Строка статуса планшета */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3 text-[13px]">
          <div className="flex items-center gap-3">
            <span className="rounded-md bg-amber-500 px-2 py-0.5 text-[13px] font-bold text-black">{t.name}</span>
            <span className="text-white/70">{t.driver.name}</span>
            <span className="flex items-center gap-1.5 text-white/60">
              <span className="h-2 w-2 rounded-full" style={{ background: TRUCK_COLOR[t.state] }} />
              {STATE_RU[t.state]}
            </span>
          </div>
          <div className="flex items-center gap-3 text-white/60">
            <span className="num">смена {hhmm(sim.now / 60)}</span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> связь
            </span>
            <button onClick={onLogout} className="rounded border border-white/15 px-2 py-0.5 hover:bg-white/10">
              Выйти
            </button>
          </div>
        </div>

        {warnings.length > 0 && (
          <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[14px] text-red-200">⚠ {warnings.join(' · ')}</div>
        )}

        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          {/* Задание */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-[12px] uppercase tracking-wider text-white/50">Задание</div>
            <div className="mt-1 text-[38px] font-bold leading-tight">{job.title}</div>
            <div className="mt-1 text-[17px] text-white/70">{job.detail}</div>
            <div className="mt-3 text-[13px]">
              {order ? (
                <span className="rounded-md border border-sky-400/50 bg-sky-500/10 px-2 py-1 text-sky-200">Приказ диспетчера: {orderLabel(sim, order)}</span>
              ) : (
                <span className="text-white/50">Назначает система диспетчеризации</span>
              )}
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <button onClick={() => driver('accept', 'Задание принято')} className="rounded-xl bg-emerald-500 px-3 py-4 text-[16px] font-bold text-black hover:bg-emerald-400">
                ✓ Принял
              </button>
              <button onClick={() => driver('refuel', 'Запрос заправки отправлен')} className="rounded-xl bg-amber-500 px-3 py-4 text-[16px] font-bold text-black hover:bg-amber-400">
                Заправка
              </button>
              <button onClick={() => driver('fault', 'Неисправность передана диспетчеру')} className="rounded-xl bg-red-500 px-3 py-4 text-[16px] font-bold text-black hover:bg-red-400">
                ⚠ Неисправность
              </button>
            </div>
            {sent && <div className="mt-2 text-[13px] text-emerald-300">✓ {sent} — диспетчер видит в пульте</div>}
          </div>

          {/* Приборы */}
          <div className="grid grid-cols-2 gap-2">
            <Gauge label="Топливо" value={`${fuelPct} %`} sub={`${fmtInt(t.fuelL)} л`} tone={fuelPct < 25 ? '#f59e0b' : undefined} />
            <Gauge label="Груз" value={`${fmtInt(t.loadT)} т`} sub={t.material ? MATERIAL_SHORT[t.material] : 'порожний'} />
            <Gauge label="Рейсов за смену" value={String(t.trips)} sub={`${fmtInt(t.tonnes)} т перевезено`} />
            <Gauge
              label="Усталость (камера)"
              value={`${fatigue} %`}
              sub={fatigue >= FATIGUE_ALERT ? 'нужна пауза 15 мин' : fatigue >= 55 ? 'следите за собой' : 'в норме'}
              tone={fatigue >= FATIGUE_ALERT ? '#ef4444' : fatigue >= 55 ? '#f59e0b' : undefined}
            />
            <Gauge label="Двигатель" value={`${Math.round(t.engineH)} мч`} sub={`до ТО ${Math.round(t.serviceInH)} мч`} />
            <Gauge label="Риск отказа" value={`${t.health.risk} %`} sub={t.health.alert ? 'назначен осмотр' : 'по датчикам в норме'} tone={t.health.alert ? '#f59e0b' : undefined} />
          </div>
        </div>

        {/* Сообщения */}
        <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center justify-between">
            <div className="text-[12px] uppercase tracking-wider text-white/50">Сообщения диспетчера</div>
            {unread.length > 0 && <span className="rounded-full bg-amber-500 px-2 text-[12px] font-bold text-black">{unread.length} новых</span>}
          </div>
          <div className="mt-2 max-h-[260px] space-y-2 overflow-y-auto">
            {inbox.length === 0 && <div className="text-[14px] text-white/40">Сообщений нет</div>}
            {inbox.map((m) => {
              const isRead = m.read.includes(i);
              return (
                <div key={m.id} className={`flex items-start justify-between gap-3 rounded-lg px-3 py-2 ${isRead ? 'bg-white/[0.02] text-white/60' : 'border border-amber-500/40 bg-amber-500/10'}`}>
                  <div>
                    <div className="text-[11.5px] text-white/50">
                      {hhmm(m.t / 60)} · {m.from}
                      {m.to === 'all' ? ' · всем' : ''}
                    </div>
                    <div className="text-[16px]">{m.text}</div>
                  </div>
                  {!isRead && (
                    <button onClick={() => send({ value: 'ack', truck: i, msg: m.id })} className="shrink-0 rounded-lg bg-white/10 px-3 py-2 text-[14px] font-semibold hover:bg-white/20">
                      Прочитал
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Gauge({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="text-[11.5px] text-white/50">{label}</div>
      <div className="num text-[24px] font-bold" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      <div className="text-[12px] text-white/50">{sub}</div>
    </div>
  );
}
