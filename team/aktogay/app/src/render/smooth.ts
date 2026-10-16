/**
 * Плавное движение техники на стенде (режим «OpenEgiz · Ditto»).
 *
 * Сервис публикует положение раз в секунду, и признаки машин приходят по SSE не одной пачкой, а по
 * одной в течение секунды. Поэтому у каждой машины своя интерполяция: от того места, где она сейчас
 * нарисована, к новой точке — с постоянной скоростью за время между её обновлениями. Так нет ни
 * рывков в конечную точку, ни остановок, когда приходят данные другой машины.
 * Вызов идемпотентен в пределах кадра: 3D-сцена и 2D-схема могут спрашивать одно и то же.
 */
import type { Simulation } from '../sim';

interface Track {
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  t0: number;
  dur: number;
  last: number;
  x: number;
  y: number;
}

const tracks = new WeakMap<Simulation, Track[]>();
/** Дальше этого — не едем, а переставляем (новая смена, сброс). */
const TELEPORT_M = 600;

/**
 * Отображаемая позиция самосвала i и направление текущего отрезка (для курса машины).
 * Время берём из одних часов (performance.now), кто бы ни спрашивал — 3D-сцена или 2D-схема: иначе
 * разница часов давала откат на кадр назад, и машина разворачивалась на месте.
 */
export function smoothTruck(sim: Simulation, i: number, tx: number, ty: number, _now?: number): { x: number; y: number; dx: number; dy: number } {
  const now = performance.now();
  let list = tracks.get(sim);
  if (!list) tracks.set(sim, (list = []));
  let s = list[i];
  if (!s) {
    s = list[i] = { fx: tx, fy: ty, tx, ty, t0: now, dur: 1000, last: now, x: tx, y: ty };
    return { x: tx, y: ty, dx: 0, dy: 0 };
  }
  if (tx !== s.tx || ty !== s.ty) {
    const gap = now - s.last;
    // Чуть дольше среднего промежутка: машина не успевает «доехать и встать» до следующей точки.
    s.dur = Math.min(2500, Math.max(250, 0.6 * s.dur + 0.4 * gap * 1.18));
    s.last = now;
    if (Math.hypot(tx - s.x, ty - s.y) > TELEPORT_M) {
      s.x = tx;
      s.y = ty;
    }
    s.fx = s.x;
    s.fy = s.y;
    s.tx = tx;
    s.ty = ty;
    s.t0 = now - 16; // продолжаем движение в этом же кадре, без остановки на стыке
  }
  const k = Math.max(0, Math.min(1, (now - s.t0) / s.dur));
  s.x = s.fx + (s.tx - s.fx) * k;
  s.y = s.fy + (s.ty - s.fy) * k;
  return { x: s.x, y: s.y, dx: s.tx - s.fx, dy: s.ty - s.fy };
}

/** Модель на стенде (данные из Ditto), а не локальный расчёт. */
export const isLive = (sim: Simulation) => sim.alphaOverride !== null;
