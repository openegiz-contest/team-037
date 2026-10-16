/**
 * Раздел «Диспетчер»: пульт смены. Приказы самосвалам (к экскаватору, на заправку, стоять),
 * сообщения водителям — в терминалы кабин, ответы водителей. Приказы идут через двойник
 * управления в Ditto и выполняются моделью реального карьера.
 */
import { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import type { Session } from '../platform/accounts';
import { orderLabel, type DispatchCommand, type DispatchState, type OrderCode } from '../platform/dispatch';
import type { Selection } from '../render/drawMine';
import { MATERIAL_SHORT, type Simulation, type TruckState } from '../sim';
import { hhmm } from '../sim/causality';
import { TRUCK_COLOR } from '../ui/theme';

export const STATE_RU: Record<TruckState, string> = {
  idle: 'на стоянке',
  empty: 'порожний рейс',
  queue: 'в очереди',
  loading: 'погрузка',
  loaded: 'гружёный рейс',
  dumping: 'разгрузка',
  refuel: 'заправка',
  service: 'плановый ремонт',
  broken: 'поломка',
};

const TEMPLATES = [
  'Взрыв через 15 минут — покинуть опасную зону, ждать отбоя',
  'Гололёд на восточном съезде — скорость не выше 20 км/ч',
  'Перерыв на обед по графику: первая группа — сейчас',
  'После рейса — к экскаватору по заданию в терминале',
];

/** Куда сейчас едет / где стоит самосвал — по данным модели. */
export function whereLabel(sim: Simulation, i: number): string {
  const t = sim.trucks[i];
  const d = t.dest;
  if (!d) return '—';
  if (d.kind === 'excavator') return sim.excavators[d.id]?.name ?? '—';
  if (d.kind === 'dump') return sim.dumps[d.id]?.name ?? '—';
  return d.purpose === 'service' ? 'ремонтный бокс' : 'гараж / АЗС';
}

interface Props {
  sim: Simulation;
  state: DispatchState;
  send: (c: DispatchCommand) => void;
  session: Session;
  now: number;
  onLocate: (sel: Selection) => void;
  onLogout: () => void;
}

export function DispatchPage({ sim, state, send, session, now, onLocate, onLogout }: Props) {
  const [to, setTo] = useState<number | 'all'>('all');
  const [text, setText] = useState('');
  const [flash, setFlash] = useState('');
  const orders = Object.entries(state.orders);
  const moving = sim.trucks.filter((t) => t.state === 'empty' || t.state === 'loaded').length;
  const queued = sim.trucks.filter((t) => t.state === 'queue').length;
  const parked = sim.trucks.filter((t) => t.state === 'idle' || t.state === 'refuel' || t.state === 'service' || t.state === 'broken').length;
  const unread = state.messages.reduce((n, m) => n + (m.to === 'all' ? sim.trucks.length - m.read.length : m.read.length ? 0 : 1), 0);

  const assign = (truck: number, order: OrderCode) => {
    send({ value: 'assign', truck, order });
    setFlash(`${sim.trucks[truck].name}: ${orderLabel(sim, order)}`);
  };
  const sendMsg = () => {
    if (!text.trim()) return;
    send({ value: 'message', to, text, from: session.name });
    setFlash(`Сообщение ${to === 'all' ? 'всем' : sim.trucks[to].name} отправлено`);
    setText('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-5">
      <PageHeader
        title="Диспетчер"
        subtitle="Пульт смены. Система сама назначает каждый рейс; диспетчер может вмешаться — отправить самосвал к нужному экскаватору, на заправку или поставить на стоянку — и написать водителям в терминал кабины. Приказы проходят через двойник управления в Ditto."
        now={now}
      >
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="rounded-md border border-line px-2.5 py-1.5 text-ink-2">{session.name}</span>
          <button onClick={onLogout} className="rounded-md border border-line px-2.5 py-1.5 text-ink-3 hover:text-ink">
            Выйти
          </button>
        </div>
      </PageHeader>

      {flash && <div className="panel border-amber-500/40 px-4 py-2 text-[13px] text-amber-200">✓ {flash}</div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="В рейсе" value={moving} hint="порожние и гружёные" />
        <Tile label="В очередях" value={queued} hint="у экскаваторов и разгрузки" tone={queued > 4 ? '#f59e0b' : undefined} />
        <Tile label="На стоянке / в ремонте" value={parked} hint="заправка, ППР, поломки" />
        <Tile label="Приказов диспетчера" value={orders.length} hint={orders.length ? 'система их не перебивает' : 'всё ведёт система'} tone={orders.length ? '#38bdf8' : undefined} />
        <Tile label="Не прочитано водителями" value={unread} hint="сообщений в терминалах" tone={unread ? '#f59e0b' : undefined} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {sim.excavators.map((e) => {
          const manual = Object.values(state.orders).filter((o) => o === `ex:${e.id}`).length;
          return (
            <div key={e.id} className="panel px-3 py-2.5">
              <div className="flex items-center justify-between">
                <b className="text-[14px]">{e.name}</b>
                <span className="text-[11.5px] text-ink-3">{MATERIAL_SHORT[e.material]}</span>
              </div>
              <div className={`mt-0.5 text-[12.5px] ${e.state === 'broken' ? 'text-red-400' : 'text-ink-2'}`}>
                {e.state === 'broken' ? 'поломка' : e.state === 'blast' ? 'оцепление' : e.state === 'nostock' ? 'нет взорванной массы' : e.loading !== null ? 'грузит' : 'ждёт самосвал'}
              </div>
              <div className="num mt-1 text-[12px] text-ink-3">
                очередь {e.queue.length}
                {manual > 0 && <span className="text-sky-300"> · по приказу {manual}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section className="panel flex flex-col">
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-[14px] font-semibold">Самосвалы и приказы</h3>
            <div className="mt-0.5 text-[12px] text-ink-3">«Система» — назначает умная диспетчеризация. Приказ к экскаватору держится, пока не вернёте «Система»; гружёный выполнит его после разгрузки.</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-ink-3">
                  <th className="px-4 py-2 font-medium">Самосвал</th>
                  <th className="px-2 py-2 font-medium">Состояние</th>
                  <th className="px-2 py-2 font-medium">Цель</th>
                  <th className="px-2 py-2 font-medium">Приказ</th>
                  <th className="px-2 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {sim.trucks.map((t, i) => {
                  const code = (state.orders[i] ?? 'auto') as OrderCode;
                  return (
                    <tr key={t.id} className="border-t border-line/60">
                      <td className="px-4 py-1.5">
                        <div className="font-semibold">{t.name}</div>
                        <div className="text-[11.5px] text-ink-3">{t.driver.name}</div>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="flex items-center gap-1.5 whitespace-nowrap">
                          <span className="h-2 w-2 rounded-full" style={{ background: TRUCK_COLOR[t.state] }} />
                          {STATE_RU[t.state]}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-ink-2">{whereLabel(sim, i)}</td>
                      <td className="px-2 py-1.5">
                        <select
                          value={code}
                          onChange={(e) => assign(i, e.target.value as OrderCode)}
                          className={`rounded-md border bg-panel-2 px-2 py-1 text-[12.5px] ${code === 'auto' ? 'border-line text-ink-2' : 'border-sky-500/60 text-sky-200'}`}
                        >
                          <option value="auto">Система (авто)</option>
                          {sim.excavators.map((e) => (
                            <option key={e.id} value={`ex:${e.id}`} disabled={e.state === 'broken'}>
                              к {e.name} · {MATERIAL_SHORT[e.material]}
                              {e.state === 'broken' ? ' (поломка)' : ''}
                            </option>
                          ))}
                          <option value="refuel">На заправку</option>
                          <option value="hold">Стоять на стоянке</option>
                        </select>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button onClick={() => onLocate({ kind: 'truck', id: t.id })} className="text-[12px] text-ink-3 hover:text-amber-300">
                          на карте ›
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="flex flex-col gap-4">
          <section className="panel px-4 py-3">
            <h3 className="text-[14px] font-semibold">Сообщение в терминал</h3>
            <div className="mt-2 flex gap-2">
              <select value={String(to)} onChange={(e) => setTo(e.target.value === 'all' ? 'all' : Number(e.target.value))} className="rounded-md border border-line bg-panel-2 px-2 py-1.5 text-[13px]">
                <option value="all">Всем водителям</option>
                {sim.trucks.map((t, i) => (
                  <option key={t.id} value={i}>
                    {t.name} · {t.driver.name}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={200}
              rows={3}
              placeholder="Текст сообщения"
              className="mt-2 block w-full resize-none rounded-md border border-line bg-panel-2 px-3 py-2 text-[13px] outline-none focus:border-amber-500"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {TEMPLATES.map((tpl) => (
                <button key={tpl} onClick={() => setText(tpl)} className="rounded border border-line px-2 py-0.5 text-[11.5px] text-ink-3 hover:text-ink">
                  {tpl.split(' — ')[0]}
                </button>
              ))}
            </div>
            <button onClick={sendMsg} disabled={!text.trim()} className="mt-3 w-full rounded-md bg-amber-500 px-3 py-1.5 text-[13.5px] font-semibold text-black disabled:opacity-40">
              Отправить
            </button>
          </section>

          <section className="panel flex flex-col">
            <div className="border-b border-line px-4 py-2.5">
              <h3 className="text-[13px] font-semibold">Сообщения и ответы водителей</h3>
            </div>
            <div className="max-h-[420px] overflow-y-auto px-4 py-2 text-[12.5px]">
              {[...state.events.map((e) => ({ kind: 'event' as const, t: e.t, id: e.id, e })), ...state.messages.map((m) => ({ kind: 'msg' as const, t: m.t, id: m.id, m }))]
                .sort((a, b) => b.id - a.id)
                .slice(0, 30)
                .map((row) =>
                  row.kind === 'msg' ? (
                    <div key={`m${row.id}`} className="border-b border-line/50 py-1.5">
                      <div className="flex justify-between text-[11px] text-ink-3">
                        <span>
                          {hhmm(row.t / 60)} · → {row.m.to === 'all' ? 'всем' : sim.trucks[row.m.to]?.name}
                        </span>
                        <span className={row.m.read.length ? 'text-emerald-400' : ''}>
                          {row.m.to === 'all' ? `прочитали ${row.m.read.length}/${sim.trucks.length}` : row.m.read.length ? '✓ прочитано' : 'не прочитано'}
                        </span>
                      </div>
                      <div className="text-ink-2">{row.m.text}</div>
                    </div>
                  ) : (
                    <div key={`e${row.id}`} className="border-b border-line/50 py-1.5">
                      <div className="text-[11px] text-ink-3">{hhmm(row.t / 60)} · от водителя</div>
                      <div className={row.e.kind === 'fault' ? 'text-red-300' : row.e.kind === 'refuel' ? 'text-amber-200' : 'text-emerald-300'}>
                        {sim.trucks[row.e.truck]?.name}: {row.e.text}
                      </div>
                    </div>
                  ),
                )}
              {state.messages.length + state.events.length === 0 && <div className="py-3 text-ink-3">Пока пусто. Отправьте сообщение или откройте терминал водителя.</div>}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: number; hint: string; tone?: string }) {
  return (
    <div className="panel px-4 py-3">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className="num mt-1 text-[24px] font-bold" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      <div className="text-[11.5px] text-ink-3">{hint}</div>
    </div>
  );
}
