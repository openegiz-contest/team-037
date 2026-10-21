/**
 * КПП и автовесы на въезде в комбинат.
 *
 * Через КПП ходит всё, что не рудничный самосвал: вахтовые автобусы в пересменку, реагенты, кислота, шары
 * для мельниц, дизельное топливо, запчасти и вывоз отходов. Каждый грузовик взвешивается на въезде и на
 * выезде (разница — масса груза), автобусы проходят проверку пропусков. Автовесы электронные: при
 * потере питания они переходят на ручное взвешивание по одной полосе — и очередь растёт.
 *
 * Поток грузовиков — детерминированная суточная кривая (днём больше, ночью меньше) и зависит от погоды;
 * цифры — оценки порядка величины для комбината такого размера. Случайностей нет, на добычу и
 * бенчмарк модуль не влияет.
 */
import type { Simulation } from './engine';
import { SHIFT_START_HOUR } from './weather';

/** Полос взвешивания и время взвешивания одной машины, с: автоматика и ручной режим. */
export const KPP_LANES = 2;
export const WEIGH_AUTO_SEC = 75;
export const WEIGH_MANUAL_SEC = 210;
/** Средняя масса груза и порожнего грузовика, т (оценка). */
export const CARGO_T = 24;
/** Поток грузовых машин на въезд, машин/ч: днём и ночью (оценка). */
const CARGO_DAY_PH = 26;
const CARGO_NIGHT_PH = 7;

/** Грузопоток на заданный час суток (машин/ч): плавный подъём к утру, спад к ночи. */
export function cargoPerHour(hour: number): number {
  const day = Math.max(0, Math.sin(((hour - 6) / 24) * 2 * Math.PI)); // максимум около полудня
  return CARGO_NIGHT_PH + (CARGO_DAY_PH - CARGO_NIGHT_PH) * day;
}

export class Checkpoint {
  /** Машин в очереди на взвешивание (дробная — копится плавно). */
  queue = 0;
  /** Взвешиваний, пропущенных автобусов и принятых грузов за смену. */
  weighings = 0;
  busPasses = 0;
  cargoVehicles = 0;
  cargoT = 0;
  /** Режим автовесов и сколько полос открыто. */
  mode: 'auto' | 'manual' = 'auto';
  lanesOpen = KPP_LANES;
  /** Поток на въезд сейчас, машин/ч, и оценка ожидания в очереди, мин. */
  arrivalsPh = 0;
  waitMin = 0;
  /** Самая длинная очередь за смену. */
  peakQueue = 0;

  update(sim: Simulation, dt: number): void {
    const hour = (SHIFT_START_HOUR + sim.now / 3600) % 24;
    const w = sim.weather;
    const cut = sim.powerCutLeft > 0;
    this.mode = cut ? 'manual' : 'auto';
    this.lanesOpen = cut ? 1 : KPP_LANES;
    // Непогода: грузовики идут реже и медленнее; автобусы идут всегда.
    const cargoPh = cargoPerHour(hour) * w.speedFactor;
    const busPh = (sim.camp.buses * 3600) / 1200;
    this.arrivalsPh = cargoPh + busPh;
    const busCheckedPerSec = busPh / 3600;
    this.busPasses += busCheckedPerSec * dt;
    // Автобусы проходят у турникета КПП за секунды и очередь на автовесах не занимают.
    const cargoIn = (cargoPh / 3600) * dt;
    this.cargoVehicles += cargoIn;
    this.cargoT += cargoIn * CARGO_T;
    const cap = (this.lanesOpen * 3600) / (cut ? WEIGH_MANUAL_SEC : WEIGH_AUTO_SEC); // машин/ч
    const served = Math.min(this.queue + cargoIn, (cap / 3600) * dt);
    this.queue = Math.max(0, this.queue + cargoIn - served);
    this.weighings += served * 2; // въезд и выезд
    this.waitMin = this.queue / (cap / 60);
    this.peakQueue = Math.max(this.peakQueue, this.queue);
  }

  /** Пропускная способность автовесов, машин/ч. */
  get capacityPh(): number {
    return (this.lanesOpen * 3600) / (this.mode === 'manual' ? WEIGH_MANUAL_SEC : WEIGH_AUTO_SEC);
  }
}

/** Направление дороги в точке КПП (единичный вектор вдоль ближайшего отрезка служебной дороги). */
export function kppDirection(site: { x: number; y: number }, roads: { pts: [number, number][] }[]): { ux: number; uy: number } {
  let best = { d: Infinity, ux: 1, uy: 0 };
  for (const r of roads)
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, ay] = r.pts[i];
      const [bx, by] = r.pts[i + 1];
      const vx = bx - ax;
      const vy = by - ay;
      const l2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((site.x - ax) * vx + (site.y - ay) * vy) / l2));
      const d = Math.hypot(site.x - (ax + t * vx), site.y - (ay + t * vy));
      if (d < best.d) best = { d, ux: vx / Math.sqrt(l2), uy: vy / Math.sqrt(l2) };
    }
  return { ux: best.ux, uy: best.uy };
}
