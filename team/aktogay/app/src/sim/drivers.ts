/**
 * Водители самосвалов: у каждого свой стиль — темп на съездах, экономичность, аккуратность.
 * Черты генерируются из seed (вымышленные люди, имена условные) и влияют на модель:
 *   rampSkill  — скорость на спиральных съездах (уверенность на уклоне),
 *   fuelFactor — расход топлива (плавность разгона и торможения),
 *   safety     — вероятность резких торможений и опасных сближений.
 * Двойник видит не черты, а их следы в телеметрии (скорость на съездах по GNSS, расход по датчику
 * топлива, резкие торможения по акселерометру) и по ним строит рейтинг.
 */
import type { Truck } from './types';

export interface DriverTraits {
  name: string;
  /** Множитель скорости на съездах, 0.9…1.1 (в среднем 1 — калибровка модели не меняется). */
  rampSkill: number;
  /** Множитель расхода топлива, 0.9…1.12. */
  fuelFactor: number;
  /** Аккуратность 0.55…0.98: чем выше, тем реже резкие торможения. */
  safety: number;
  /** Стаж, лет (для карточки). */
  years: number;
}

/** Накопленная телеметрия водителя за смену. */
export interface DriverStats {
  /** Время движения по съездам, с, и пройдено по ним, м. */
  rampSec: number;
  rampDistM: number;
  /** Пробег за смену, м. */
  distM: number;
  /** Топливо, израсходованное в движении за смену, л (без холостого хода в очередях). */
  fuelUsedL: number;
  /** Резкие торможения / опасные сближения. */
  harsh: number;
  /** Время с последнего события (чтобы не считать одно торможение много раз), с. */
  harshCooldown: number;
  /** Усталость по камере в кабине, 0–100 %. */
  fatigue: number;
  /** Индивидуальная скорость накопления усталости, %/ч за рулём. */
  fatigueRate: number;
  /** Эпизоды «микросна» / закрытых глаз, зафиксированные камерой. */
  fatigueEvents: number;
  fatigueCooldown: number;
  /** Когда последний раз писали в журнал о водителе, с модели. */
  fatigueLoggedAt: number;
  /** Предупреждения системы предотвращения столкновений (сближение с машиной впереди). */
  cas: number;
  casCooldown: number;
}

// Условные имена (вымышленные водители модели).
const NAMES = [
  'Ерлан Б.', 'Асхат К.', 'Дмитрий С.', 'Нурлан Ж.', 'Бауыржан Т.', 'Сергей П.', 'Айдос М.', 'Ринат Г.', 'Талгат О.', 'Олег В.',
  'Марат Е.', 'Даурен А.', 'Виктор Л.', 'Ержан Н.', 'Канат Р.', 'Алексей Ф.', 'Жандос И.', 'Руслан Д.', 'Арман Ш.', 'Игорь Х.',
  'Самат У.', 'Мейрам З.', 'Андрей Ч.', 'Бекзат Ю.', 'Ильяс Ц.', 'Павел Я.', 'Галым Э.', 'Нурбек В.', 'Евгений Ж.', 'Тимур К.',
];

export function makeDriver(i: number, rnd: () => number): DriverTraits {
  const skill = rnd(); // общая «опытность» связывает черты: опытные чаще и быстрые, и аккуратные
  const r = (lo: number, hi: number, w: number) => lo + (hi - lo) * (w * skill + (1 - w) * rnd());
  return {
    name: NAMES[i % NAMES.length],
    rampSkill: r(0.9, 1.1, 0.6),
    fuelFactor: 1.12 - (1.12 - 0.9) * (0.4 * skill + 0.6 * rnd()),
    safety: r(0.55, 0.98, 0.5),
    years: Math.round(1 + 19 * (0.7 * skill + 0.3 * rnd())),
  };
}

export const emptyDriverStats = (): DriverStats => ({
  rampSec: 0,
  rampDistM: 0,
  distM: 0,
  fuelUsedL: 0,
  harsh: 0,
  harshCooldown: 0,
  fatigue: 0,
  fatigueRate: 6,
  fatigueEvents: 0,
  fatigueCooldown: 0,
  fatigueLoggedAt: -1e9,
  cas: 0,
  casCooldown: 0,
});

/** Порог усталости, после которого двойник рекомендует паузу, %. */
export const FATIGUE_ALERT = 75;

// ───────────────────────────── рейтинг ─────────────────────────────

export interface DriverRating {
  truckId: number;
  name: string;
  years: number;
  /** Средняя скорость на съездах, км/ч (по GNSS). */
  rampKmh: number | null;
  /** Расход в движении, л на 100 км. */
  fuelL100: number | null;
  /** Резких торможений на 100 км. */
  harsh100: number | null;
  /** Усталость сейчас, %, и эпизоды по камере за смену. */
  fatigue: number;
  fatigueEvents: number;
  /** Предупреждения CAS за смену. */
  cas: number;
  /** Перевезено, т/ч работы. */
  tph: number;
  /** Оценки 0–100 и итог. */
  scores: { ramp: number; fuel: number; safety: number; output: number };
  total: number;
  /** Где лучше использовать. */
  advice: string;
  /** Достаточно ли данных (пробег ≥ 15 км). */
  enough: boolean;
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/** Оценка 0–100 относительно парка: 50 — средний, ±1,5σ — края. */
function relScore(v: number, all: number[], higherIsBetter: boolean): number {
  const m = mean(all);
  const sd = Math.sqrt(mean(all.map((x) => (x - m) ** 2))) || 1e-9;
  const z = (v - m) / sd;
  const s = 50 + (higherIsBetter ? z : -z) * (50 / 1.5);
  return Math.round(Math.max(0, Math.min(100, s)));
}

/** Рейтинг водителей по телеметрии смены. */
export function rateDrivers(trucks: Truck[], shiftSec: number): DriverRating[] {
  const rows = trucks.map((t) => {
    const s = t.driverStats;
    const km = s.distM / 1000;
    const workH = shiftSec / 3600;
    return {
      t,
      km,
      rampKmh: s.rampSec > 60 ? (s.rampDistM / s.rampSec) * 3.6 : null,
      fuelL100: km > 1 ? (s.fuelUsedL / km) * 100 : null,
      harsh100: km > 1 ? (s.harsh / km) * 100 : null,
      tph: workH > 0.2 ? t.tonnes / workH : 0,
    };
  });
  const ok = rows.filter((r) => r.km >= 15);
  const pool = ok.length >= 3 ? ok : rows;
  const vals = (f: (r: (typeof rows)[number]) => number | null) => pool.map(f).filter((x): x is number => x !== null);
  const rampAll = vals((r) => r.rampKmh);
  const fuelAll = vals((r) => r.fuelL100);
  const harshAll = vals((r) => r.harsh100);
  const tphAll = vals((r) => r.tph);

  const out = rows.map((r) => {
    const scores = {
      ramp: r.rampKmh !== null && rampAll.length ? relScore(r.rampKmh, rampAll, true) : 50,
      fuel: r.fuelL100 !== null && fuelAll.length ? relScore(r.fuelL100, fuelAll, false) : 50,
      safety: r.harsh100 !== null && harshAll.length ? relScore(r.harsh100, harshAll, false) : 50,
      output: tphAll.length ? relScore(r.tph, tphAll, true) : 50,
    };
    const total = Math.round(0.3 * scores.ramp + 0.25 * scores.fuel + 0.3 * scores.safety + 0.15 * scores.output);
    let advice: string;
    if (scores.ramp >= 60 && scores.safety >= 55) advice = 'Глубокие забои: длинные спуски по съездам с грузом';
    else if (scores.safety < 25) advice = 'Короткие плечи на верхних горизонтах; инструктаж по безопасному вождению';
    else if (scores.fuel < 25) advice = 'Обучение экономичному вождению (плавный разгон, накат)';
    else if (scores.ramp < 40) advice = 'Верхние горизонты и вскрыша: меньше уклонов';
    else advice = 'Любой маршрут';
    return {
      truckId: r.t.id,
      name: r.t.driver.name,
      years: r.t.driver.years,
      rampKmh: r.rampKmh,
      fuelL100: r.fuelL100,
      harsh100: r.harsh100,
      fatigue: Math.round(r.t.driverStats.fatigue),
      fatigueEvents: r.t.driverStats.fatigueEvents,
      cas: r.t.driverStats.cas,
      tph: r.tph,
      scores,
      total,
      advice,
      enough: r.km >= 15,
    };
  });
  return out.sort((a, b) => b.total - a.total);
}

/** Кого ставить на сложные съезды: лучшие по темпу на уклоне среди аккуратных. */
export function rampPicks(rating: DriverRating[], n = 5): DriverRating[] {
  return rating
    .filter((r) => r.enough && r.scores.safety >= 45)
    .sort((a, b) => b.scores.ramp + 0.5 * b.scores.safety - (a.scores.ramp + 0.5 * a.scores.safety))
    .slice(0, n);
}
