/**
 * Мост «интерфейс ↔ OpenEgiz»: читает двойников рудника из Eclipse Ditto (начальный снимок через
 * поиск + поток изменений Server-Sent Events) и отправляет команды «что если» в двойник управления.
 * Запросы идут на /ditto/… того же сервера — nginx интерфейса проксирует их к Ditto платформы.
 */
import { Simulation } from '../sim/engine';
import type { Kpis } from '../sim/kpi';
import type { StrategyName } from '../sim/types';
import { CONTROL_ID, hydrate, SITE_NS, VARIANTS, variantNs } from './twins';

type Props = Record<string, unknown>;

export interface ControlStatus {
  value: string;
  speed: number;
  seed: number;
  trucks: number;
  sim_time: number;
  finished: boolean;
  active_scenarios: string[];
  last_scenario: string;
  /** Последние команды: [время модели, с; описание]. */
  history?: [number, string][];
}

const BASE = 'ditto/api/2';
const NAMESPACES = [SITE_NS, ...VARIANTS.map(variantNs)].join(',');

export class PlatformBridge {
  readonly things = new Map<string, Props>();
  /** Атрибуты двойников (имя, тип, связи) — меняются только при создании. */
  readonly attrs = new Map<string, Props>();
  /** Когда приходило последнее изменение каждого двойника (performance.now()). */
  readonly updatedAt = new Map<string, number>();
  /** Счётчик полученных событий — для показателя «обновлений в секунду». */
  events = 0;
  sims: Record<StrategyName, Simulation> | null = null;
  kpis: Record<StrategyName, Kpis | null> = { fixed: null, smart: null };
  status: ControlStatus | null = null;
  connected = false;
  /** Время последнего применения данных двойников (для плавной интерполяции между публикациями). */
  lastHydrate = 0;
  /** Интервал публикации симулятора, мс (оценивается по приходу данных). */
  interval = 1000;
  private dirtySince = 0;
  private es: EventSource | null = null;
  private seq = Date.now();
  onReset: (() => void) | null = null;

  /** Есть ли платформа: двойник управления доступен через прокси. */
  static async detect(): Promise<PlatformBridge | null> {
    try {
      const r = await fetch(`${BASE}/things/${CONTROL_ID}`, { headers: { Accept: 'application/json' } });
      if (!r.ok) return null;
      const b = new PlatformBridge();
      await b.start();
      return b;
    } catch {
      return null;
    }
  }

  async start(): Promise<void> {
    await this.snapshot();
    this.connectStream();
  }

  private async snapshot(): Promise<void> {
    let cursor: string | null = null;
    const seen = new Set<string>();
    let complete = true;
    do {
      const opts: string = cursor ? `size(200),cursor(${cursor})` : 'size(200)';
      const r = await fetch(`${BASE}/search/things?namespaces=${NAMESPACES}&option=${opts}&fields=thingId,attributes,features`);
      if (!r.ok) {
        complete = false;
        break;
      }
      const body = (await r.json()) as { items: { thingId: string; attributes?: Props; features?: Props }[]; cursor?: string };
      for (const it of body.items) {
        seen.add(it.thingId);
        this.things.set(it.thingId, it.features ?? {});
        this.attrs.set(it.thingId, it.attributes ?? {});
      }
      cursor = body.cursor ?? null;
    } while (cursor);
    // Двойники, удалённые после уменьшения парка, убираем из карты.
    if (complete) {
      for (const id of [...this.things.keys()]) if (!seen.has(id)) this.things.delete(id);
      for (const id of [...this.attrs.keys()]) if (!seen.has(id)) this.attrs.delete(id);
    }
    this.dirtySince = performance.now();
  }

  private connectStream(): void {
    this.es?.close();
    const es = new EventSource(`${BASE}/things?namespaces=${NAMESPACES}&fields=thingId,features`);
    this.es = es;
    es.onopen = () => (this.connected = true);
    es.onerror = () => {
      this.connected = false;
    };
    es.onmessage = (e) => {
      if (!e.data) return;
      try {
        const d = JSON.parse(e.data) as { thingId?: string; features?: Props };
        if (!d.thingId || !d.features) return;
        const cur = this.things.get(d.thingId) ?? {};
        this.things.set(d.thingId, { ...cur, ...d.features });
        this.updatedAt.set(d.thingId, performance.now());
        this.events++;
        if (!this.attrs.has(d.thingId)) this.scheduleSnapshot();
        if (!this.dirtySince) this.dirtySince = performance.now();
      } catch {
        /* пропускаем повреждённое событие */
      }
    };
  }

  private snapshotTimer = 0;
  /** Перечитать всех двойников (появились новые или сменился состав парка). */
  private scheduleSnapshot(): void {
    if (this.snapshotTimer) return;
    this.snapshotTimer = window.setTimeout(() => {
      this.snapshotTimer = 0;
      void this.snapshot();
    }, 1500);
  }

  private readStatus(): ControlStatus | null {
    const ctl = this.things.get(CONTROL_ID) as { status?: { properties?: ControlStatus } } | undefined;
    return ctl?.status?.properties ?? null;
  }

  /**
   * Вызывать каждый кадр: применяет накопившиеся изменения пакетом (публикация симулятора приходит
   * пачкой сообщений) и пересоздаёт локальные модели, если сменились seed или число самосвалов.
   */
  pump(now: number): boolean {
    if (!this.dirtySince || now - this.dirtySince < 120) return false;
    this.dirtySince = 0;
    this.status = this.readStatus();
    const seed = this.status?.seed ?? 42;
    const trucks = this.status?.trucks ?? 20;
    if (!this.sims || this.sims.smart.seed !== seed || this.sims.smart.trucks.length !== trucks) {
      this.sims = {
        fixed: new Simulation({ seed, truckCount: trucks, strategy: 'fixed' }),
        smart: new Simulation({ seed, truckCount: trucks, strategy: 'smart' }),
      };
      this.onReset?.();
      this.scheduleSnapshot();
    }
    for (const v of VARIANTS) this.kpis[v] = hydrate(this.sims[v], v, this.things);
    if (this.lastHydrate) this.interval = Math.min(3000, Math.max(300, 0.7 * this.interval + 0.3 * (now - this.lastHydrate)));
    this.lastHydrate = now;
    return true;
  }

  /** Доля пути между двумя публикациями — для интерполяции положения техники. */
  alpha(now: number): number {
    return Math.min(1, (now - this.lastHydrate) / this.interval);
  }

  /** Отправить команду симулятору: меняем признак command двойника управления в Ditto. */
  async send(value: string, arg?: number, extra: Record<string, number> = {}): Promise<boolean> {
    const body = { value, arg: arg ?? 0, seq: ++this.seq, ...extra };
    try {
      const r = await fetch(`${BASE}/things/${CONTROL_ID}/features/command/properties`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return r.ok;
    } catch {
      return false;
    }
  }
}
