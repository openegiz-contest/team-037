/**
 * Датчики самосвалов и прогноз отказов (предиктивная диагностика).
 *
 * Физика: температура двигателя идёт к «целевой» для режима (гружёный > порожний > холостой ход)
 * с постоянной времени ~10 мин. Перед отказом (за `precursor` секунд) один из параметров начинает
 * дрейфовать в зависимости от типа неисправности. Внезапные отказы (precursor = 0) не предсказуемы.
 *
 * Детектор (модельный подход цифрового двойника): двойник знает, какой ДОЛЖНА быть температура
 * и вибрация в текущем режиме, и смотрит на невязку «измерено − ожидается». Невязки нормируются,
 * сглаживаются, по истории за 15 мин оценивается тренд и время до отказа.
 */
import type { SimConfig } from './config';
import { hash01 } from './rng';
import type { FailureType, Health, Sensors, Truck, TruckState } from './types';

const TYRE_NOMINAL = 6.3;

function targetTemp(s: TruckState): number {
  switch (s) {
    case 'loaded':
      return 94;
    case 'empty':
      return 86;
    case 'queue':
    case 'loading':
    case 'dumping':
    case 'idle':
      return 79;
    default:
      return 52; // двигатель заглушен: заправка, ремонт
  }
}

function moving(s: TruckState): boolean {
  return s === 'loaded' || s === 'empty';
}

function expectedVibration(s: TruckState): number {
  return moving(s) ? 3.0 : s === 'loading' || s === 'dumping' ? 2.6 : 1.2;
}

export function initialSensors(): Sensors {
  return { tempC: 52, expectedTempC: 52, coreC: 52, vibration: 1.2, tyreBar: TYRE_NOMINAL, log: [] };
}

export function initialHealth(): Health {
  return { score: 0, risk: 0, etaMin: null, alert: false, alertAt: null, sign: null, history: [] };
}

/** Степень деградации 0…1 из-за ближайшей неисправности. */
export function degradation(t: Truck, now: number): { d: number; type: FailureType | null } {
  const f = t.breakdowns[0];
  if (!f || f.precursor <= 0) return { d: 0, type: null };
  const start = f.t - f.precursor;
  if (now < start) return { d: 0, type: null };
  return { d: Math.min(1, (now - start) / f.precursor), type: f.type };
}

/** Опрос датчиков (каждые cfg.health.sensorEverySec секунд). */
export function updateSensors(cfg: SimConfig, seed: number, t: Truck, now: number): void {
  const dt = cfg.health.sensorEverySec;
  const k = 1 - Math.exp(-dt / 600);
  const { d, type } = degradation(t, now);
  const target = targetTemp(t.state);
  const s = t.sensors;

  let tempOffset = 0;
  let vibOffset = 0;
  let tyreDrop = 0;
  if (type === 'engine') {
    tempOffset = 24 * Math.pow(d, 1.5);
    vibOffset = 1.5 * d * d;
  } else if (type === 'hydraulic') {
    vibOffset = 8 * d * d;
    tempOffset = 5 * d;
  } else if (type === 'tyre') {
    tyreDrop = 1.8 * d;
    vibOffset = 2 * d * d;
  }

  const b = t.benign;
  if (b && now >= b.start && now < b.start + b.dur) tempOffset += b.ampC * Math.sin((Math.PI * (now - b.start)) / b.dur);

  s.coreC += (target + tempOffset - s.coreC) * k;
  s.expectedTempC += (target - s.expectedTempC) * k;
  const n = (salt: number) => 2 * hash01(seed, t.id, Math.floor(now / dt), salt) - 1;
  s.tempC = s.coreC + 0.5 * n(1);
  s.vibration = Math.max(0, expectedVibration(t.state) + vibOffset + 0.3 * n(2));
  s.tyreBar = TYRE_NOMINAL - tyreDrop + 0.05 * n(3);
  if (now % 60 === 0) {
    s.log.push([s.tempC, s.expectedTempC, s.vibration]);
    if (s.log.length > 60) s.log.shift();
  }
}

/**
 * Детектор (раз в минуту). Возвращает true, если тревога только что поднялась.
 */
export function runDetector(cfg: SimConfig, t: Truck, now: number): boolean {
  const s = t.sensors;
  const h = t.health;
  if (t.state === 'broken' || t.state === 'service' || t.state === 'refuel' || (t.state === 'idle' && now < t.departAt)) return false;

  const rT = (s.tempC - s.expectedTempC) / 24;
  const rV = (s.vibration - expectedVibration(t.state)) / 8;
  const rP = (TYRE_NOMINAL - s.tyreBar) / 1.8;
  const raw = Math.max(0, rT, rV, rP);
  h.sign = raw < 0.05 ? null : rT >= rV && rT >= rP ? 'engine' : rV >= rP ? 'hydraulic' : 'tyre';
  h.score = h.score + 0.3 * (raw - h.score);
  h.history.push(h.score);
  if (h.history.length > 15) h.history.shift();

  // Тренд — наклон линейной регрессии индекса по минутам.
  const n = h.history.length;
  let slope = 0;
  if (n >= 5) {
    const mx = (n - 1) / 2;
    const my = h.history.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    h.history.forEach((y, x) => {
      num += (x - mx) * (y - my);
      den += (x - mx) * (x - mx);
    });
    slope = num / den;
  }
  h.etaMin = slope > 0.002 && h.score > 0.08 ? Math.max(1, (1 - h.score) / slope) : null;
  h.risk = Math.round(100 / (1 + Math.exp(-12 * (h.score - cfg.health.alertScore))));

  if (!h.alert && h.score >= cfg.health.alertScore && slope > 0) {
    h.alert = true;
    h.alertAt = now;
    return true;
  }
  return false;
}

export function resetHealth(t: Truck): void {
  t.health = initialHealth();
  t.serviceRequested = false;
}
