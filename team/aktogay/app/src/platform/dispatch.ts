/**
 * Диспетчерская смены: приказы самосвалам, сообщения водителям («рация» в терминале) и ответы
 * водителей. На стенде команды идут через двойник управления в Ditto, сервис применяет их к
 * реальному карьеру и публикует состояние обратно (признак dispatch двойника управления).
 * Без стенда та же логика работает в браузере на локальной модели.
 */
import type { ManualOrder, Simulation } from '../sim/engine';

/** Код приказа: «авто» (система), «стоять», «заправка» или к экскаватору ex:<номер>. */
export type OrderCode = 'auto' | 'hold' | 'refuel' | `ex:${number}`;

export interface DispatchMessage {
  id: number;
  /** Время модели, с. */
  t: number;
  /** Номер самосвала (индекс) или «всем». */
  to: number | 'all';
  from: string;
  text: string;
  /** Кто из водителей подтвердил «прочитал» (индексы самосвалов). */
  read: number[];
}

export type DriverEventKind = 'accept' | 'refuel' | 'fault';

export interface DriverEvent {
  id: number;
  t: number;
  truck: number;
  kind: DriverEventKind;
  text: string;
}

export interface DispatchState {
  /** Действующие приказы: индекс самосвала → код (кроме «авто»). */
  orders: Record<string, OrderCode>;
  messages: DispatchMessage[];
  events: DriverEvent[];
  seq: number;
}

export const emptyDispatch = (): DispatchState => ({ orders: {}, messages: [], events: [], seq: 0 });

export interface DispatchCommand {
  value: 'assign' | 'message' | 'ack' | 'driver';
  truck?: number;
  order?: OrderCode;
  to?: number | 'all';
  text?: string;
  from?: string;
  msg?: number;
  kind?: DriverEventKind;
}

export const DISPATCH_COMMANDS = new Set(['assign', 'message', 'ack', 'driver']);
const KEEP = 40;

export function orderLabel(sim: Simulation, code: OrderCode | undefined): string {
  if (!code || code === 'auto') return 'система';
  if (code === 'hold') return 'стоять на стоянке';
  if (code === 'refuel') return 'на заправку';
  const ex = sim.excavators[Number(code.slice(3))];
  return ex ? `к ${ex.name}` : 'система';
}

function toManual(code: OrderCode): ManualOrder | 'refuel' | null {
  if (code === 'auto') return null;
  if (code === 'hold') return { kind: 'hold' };
  if (code === 'refuel') return 'refuel';
  return { kind: 'excavator', id: Number(code.slice(3)) };
}

const validTruck = (sim: Simulation, i: unknown): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < sim.trucks.length;
const clean = (s: unknown, max = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Применить команду диспетчерской. Возвращает описание для журнала или null, если команда неверна. */
export function applyDispatch(st: DispatchState, sim: Simulation, c: DispatchCommand): string | null {
  switch (c.value) {
    case 'assign': {
      if (!validTruck(sim, c.truck)) return null;
      const code = (c.order ?? 'auto') as OrderCode;
      if (code.startsWith('ex:') && !sim.excavators[Number(code.slice(3))]) return null;
      const text = sim.applyManual(c.truck, toManual(code));
      if (code === 'auto' || code === 'refuel') delete st.orders[c.truck];
      else st.orders[c.truck] = code;
      return `Диспетчер: ${text}`;
    }
    case 'message': {
      const text = clean(c.text);
      if (!text) return null;
      const to = c.to === 'all' || c.to === undefined ? 'all' : validTruck(sim, c.to) ? c.to : null;
      if (to === null) return null;
      st.messages.push({ id: ++st.seq, t: Math.round(sim.now), to, from: clean(c.from, 40) || 'Диспетчер', text, read: [] });
      if (st.messages.length > KEEP) st.messages.shift();
      const who = to === 'all' ? 'всем' : sim.trucks[to].name;
      sim.addLog(`Диспетчер → ${who}: ${text}`, 'info');
      return `сообщение ${who}`;
    }
    case 'ack': {
      if (!validTruck(sim, c.truck)) return null;
      const m = st.messages.find((x) => x.id === c.msg);
      if (!m || (m.to !== 'all' && m.to !== c.truck)) return null;
      if (!m.read.includes(c.truck)) m.read.push(c.truck);
      return `${sim.trucks[c.truck].name} прочитал сообщение`;
    }
    case 'driver': {
      if (!validTruck(sim, c.truck)) return null;
      const t = sim.trucks[c.truck];
      let text: string;
      if (c.kind === 'accept') text = 'принял задание';
      else if (c.kind === 'refuel') {
        sim.applyManual(c.truck, 'refuel');
        text = 'просит заправку — отправлен на АЗС';
      } else if (c.kind === 'fault') {
        t.serviceRequested = true; // после рейса — в ремонтный бокс на осмотр
        text = 'сообщил о неисправности — после рейса в ремонтный бокс';
        sim.addLog(`Водитель ${t.driver.name} (${t.name}): неисправность — направлен на осмотр`, 'warn');
      } else return null;
      st.events.push({ id: ++st.seq, t: Math.round(sim.now), truck: c.truck, kind: c.kind, text });
      if (st.events.length > KEEP) st.events.shift();
      return `${t.name}: ${text}`;
    }
  }
  return null;
}
