/**
 * Парк техники карьера: число самосвалов и состав экскаваторов. Один формат для интерфейса
 * (раздел «Оборудование»), сервиса-симулятора (команда reset { fleet }) и статуса двойника
 * управления — чтобы локальная модель в браузере строилась ровно так же, как на стенде.
 *
 * Изменения парка вводятся с начала новой смены — как на предприятии: новую машину ставят в наряд.
 */
import { DEFAULT_CONFIG, makeConfig, type ExcavatorSpec, type SimConfig } from '../sim/config';
import type { Material } from '../sim/types';

export interface Fleet {
  trucks: number;
  excavators: ExcavatorSpec[];
}

export const TRUCKS_RANGE = [5, 30] as const;
export const MAX_EXCAVATORS = 8;
/** Минимальный угол между забоями на одном горизонте, градусы. */
export const MIN_FACE_GAP_DEG = 30;

/** Модели экскаваторов по ёмкости ковша (типовые классы, без марок). */
export const EXCAVATOR_MODELS: { id: string; name: string; rateTpm: number }[] = [
  { id: 'b16', name: 'ковш 16 м³', rateTpm: 38 },
  { id: 'b22', name: 'ковш 22 м³', rateTpm: 44 },
  { id: 'b28', name: 'ковш 28 м³', rateTpm: 50 },
];

export const RING_LABEL: Record<number, string> = { 1: 'верхний горизонт', 2: 'средний горизонт', 3: 'дно карьера' };

/** Выработки, куда можно поставить экскаватор. */
export const PIT_LABEL = DEFAULT_CONFIG.pits.map((p) => p.name);
/** Сколько горизонтов (кольцевых берм ниже бровки) у выработки. */
export const ringsOf = (pit: number) => (DEFAULT_CONFIG.pits[pit] ?? DEFAULT_CONFIG.pits[0]).ringLevels.length - 1;
/** Подпись горизонта с учётом выработки (в малых — средний и дно). */
export function ringLabel(pit: number, ring: number): string {
  const n = ringsOf(pit);
  if (ring >= n) return 'дно';
  if (n === 2) return 'средний горизонт';
  return RING_LABEL[ring] ?? `горизонт ${ring}`;
}

/** Содержание Cu в новом забое: глубже — богаче (оценка по профилю месторождения). */
export function defaultGrade(material: Material, ring: number): number {
  if (material === 'waste') return 0;
  if (material === 'oxide') return 0.3;
  return ring >= 3 ? 0.42 : ring === 2 ? 0.29 : 0.27;
}

export const defaultFleet = (trucks = 20): Fleet => ({ trucks, excavators: DEFAULT_CONFIG.excavators.map((e) => ({ ...e })) });

export function fleetConfig(f: Fleet): SimConfig {
  return makeConfig({ excavators: f.excavators.map((e) => ({ ...e })) });
}

/** Подпись для сравнения «тот же ли парк». */
export const fleetKey = (f: Fleet) => JSON.stringify([f.trucks, f.excavators.map((e) => [e.name, e.material, e.pit ?? 0, e.ring, e.angleDeg, e.rateTpm])]);

/** Следующее свободное имя экскаватора: Э-6, Э-7… */
export function nextExcavatorName(f: Fleet): string {
  const used = new Set(f.excavators.map((e) => e.name));
  for (let i = 1; ; i++) if (!used.has(`Э-${i}`)) return `Э-${i}`;
}

const angDiff = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

/** Проверка парка; пустой список — всё в порядке. */
export function validateFleet(f: Fleet): string[] {
  const err: string[] = [];
  if (!Number.isInteger(f.trucks) || f.trucks < TRUCKS_RANGE[0] || f.trucks > TRUCKS_RANGE[1]) err.push(`Самосвалов должно быть от ${TRUCKS_RANGE[0]} до ${TRUCKS_RANGE[1]}`);
  if (f.excavators.length > MAX_EXCAVATORS) err.push(`Экскаваторов не больше ${MAX_EXCAVATORS}`);
  for (const m of ['sulfide', 'oxide', 'waste'] as Material[]) {
    if (!f.excavators.some((e) => e.material === m)) err.push(`Нужен хотя бы один экскаватор на материале «${m === 'sulfide' ? 'сульфид' : m === 'oxide' ? 'оксид' : 'вскрыша'}»`);
  }
  f.excavators.forEach((a, i) => {
    const pit = a.pit ?? 0;
    if (pit < 0 || pit >= DEFAULT_CONFIG.pits.length) err.push(`${a.name}: нет такой выработки`);
    if (a.ring < 1 || a.ring > ringsOf(pit)) err.push(`${a.name}: горизонт 1–${ringsOf(pit)}`);
    f.excavators.slice(i + 1).forEach((b) => {
      if ((b.pit ?? 0) === pit && a.ring === b.ring && angDiff(a.angleDeg, b.angleDeg) < MIN_FACE_GAP_DEG)
        err.push(`${a.name} и ${b.name} слишком близко на одном горизонте (нужно ≥ ${MIN_FACE_GAP_DEG}°)`);
    });
  });
  return err;
}

/** Приведение присланного по сети парка к допустимому виду (на стороне сервиса). */
export function sanitizeFleet(raw: unknown, fallback: Fleet): Fleet {
  const r = raw as Partial<Fleet> | null;
  if (!r || typeof r !== 'object') return fallback;
  const trucks = Math.round(Number(r.trucks ?? fallback.trucks));
  const excavators = Array.isArray(r.excavators)
    ? r.excavators.slice(0, MAX_EXCAVATORS).map((e, i) => {
        const material = (['sulfide', 'oxide', 'waste'] as const).includes(e?.material as Material) ? (e.material as Material) : 'waste';
        const name = String(e?.name ?? `Э-${i + 1}`).slice(0, 8);
        // Парк, сохранённый до появления трёх выработок (без pit): места известных экскаваторов — по умолчанию.
        const legacy = e?.pit === undefined ? DEFAULT_CONFIG.excavators.find((d) => d.name === name) : undefined;
        const pit = Math.min(DEFAULT_CONFIG.pits.length - 1, Math.max(0, Math.round(Number(legacy?.pit ?? e?.pit) || 0)));
        const ring = Math.min(ringsOf(pit), Math.max(1, Math.round(Number(legacy?.ring ?? e?.ring) || 1)));
        const angle = Number(legacy?.angleDeg ?? e?.angleDeg) || 0;
        return {
          name,
          material,
          rateTpm: Math.min(80, Math.max(20, Number(e?.rateTpm) || 44)),
          gradePct: Number.isFinite(Number(e?.gradePct)) ? Number(e.gradePct) : defaultGrade(material, ring),
          ring,
          angleDeg: ((Math.round(angle) % 360) + 360) % 360,
          pit,
        };
      })
    : fallback.excavators;
  const f = { trucks, excavators };
  return validateFleet(f).length ? fallback : f;
}
