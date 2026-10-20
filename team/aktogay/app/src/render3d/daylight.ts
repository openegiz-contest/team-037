/**
 * День и ночь на сцене. Солнце ходит по небу так, как оно ходит над Актогаем: положение
 * считается по широте рудника и дню года, поэтому летом смена идёт почти целиком при свете,
 * а зимой начинается и заканчивается в темноте.
 *
 * Формулы — стандартные астрономические (склонение солнца и часовой угол), без уравнения
 * времени и атмосферной рефракции: для освещения сцены этой точности достаточно.
 */
import * as THREE from 'three';
import { GEO_REF } from '../geo/geoRef';

/** День года для середины каждого месяца. */
const DAY_OF_YEAR = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Высота и азимут солнца, градусы. Азимут отсчитывается от севера по часовой стрелке. */
export function sunAngles(month: number, hour: number, latDeg = GEO_REF.lat): { elevDeg: number; azDeg: number } {
  const n = DAY_OF_YEAR[Math.min(11, Math.max(0, Math.round(month) - 1))];
  const decl = rad(23.44 * Math.sin(rad((360 / 365) * (284 + n))));
  const H = rad(15 * (hour - 12));
  const phi = rad(latDeg);
  const sinEl = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
  const el = Math.asin(Math.min(1, Math.max(-1, sinEl)));
  const cosAz = (Math.sin(decl) - Math.sin(phi) * sinEl) / (Math.cos(phi) * Math.cos(el) || 1e-6);
  let az = Math.acos(Math.min(1, Math.max(-1, cosAz)));
  if (H > 0) az = 2 * Math.PI - az; // после полудня солнце на западе
  return { elevDeg: deg(el), azDeg: deg(az) };
}

/** Ночное небо сцены, дневное и закатное — к ним подмешивается погодная дымка. */
const NIGHT_SKY = new THREE.Color('#0a1526');
const DAY_SKY = new THREE.Color('#86a6cd');
const DUSK_SKY = new THREE.Color('#c0744a');
const SUN_HIGH = new THREE.Color('#ffe2b8');
const SUN_LOW = new THREE.Color('#ff9a4e');
const MOON = new THREE.Color('#9fb6d8');

export interface DaylightState {
  /** Направление на солнце в координатах сцены (x — восток, z — юг). */
  dir: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiIntensity: number;
  sky: THREE.Color;
  /** Насколько сейчас светло: 0 — ночь, 1 — день. */
  dayK: number;
  /** Насколько включено искусственное освещение: 0 — выключено, 1 — полностью. */
  lampsK: number;
}

/** Состояние освещения на заданный час местного времени. */
export function daylight(month: number, hour: number): DaylightState {
  const { elevDeg, azDeg } = sunAngles(month, hour);
  // Сумерки: от −6° (ещё темно) до +8° (уже день).
  const dayK = smooth(-6, 8, elevDeg);
  const duskK = dayK * (1 - smooth(0, 14, elevDeg));

  const sky = NIGHT_SKY.clone().lerp(DAY_SKY, dayK).lerp(DUSK_SKY, duskK * 0.7);
  const sunColor = SUN_LOW.clone().lerp(SUN_HIGH, smooth(0, 20, elevDeg));
  // Ночью «солнце» — слабый холодный свет луны, чтобы сцена не стала чёрной.
  const night = 1 - dayK;
  sunColor.lerp(MOON, night * 0.85);

  const a = rad(azDeg);
  const e = rad(Math.max(elevDeg, 6)); // ночью источник держим над горизонтом — иначе тени ложатся плашмя
  const dir = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));

  return {
    dir,
    sunColor,
    sunIntensity: 0.22 + 2.4 * dayK,
    hemiIntensity: 0.3 + 0.95 * dayK,
    sky,
    dayK,
    lampsK: 1 - smooth(0.18, 0.5, dayK),
  };
}

/** Часы и минуты местного времени для подписи. */
export function clockRu(hour: number): string {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const m = Math.floor((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
