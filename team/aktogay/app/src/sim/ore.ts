/**
 * Качество руды (содержание меди) и извлечение на обогатительной фабрике.
 *
 * Содержание Cu в забое меняется по ходу отработки блока (рудное тело неоднородно):
 * базовое значение + медленная волна с периодом в несколько часов. Фабрика работает лучше всего,
 * когда питание ровное и близко к целевому: отклонение снижает извлечение меди в концентрат.
 */
import type { SimConfig } from './config';
import type { Excavator } from './types';

/** Содержание меди в забое экскаватора в момент времени, %. */
export function gradeAt(ex: Excavator, now: number): number {
  if (ex.gradeBase <= 0) return 0;
  const g = ex.gradeBase + ex.gradeAmp * Math.sin((2 * Math.PI * now) / ex.gradePeriodSec + ex.gradePhase);
  return Math.max(0.05, g);
}

/** Извлечение меди в концентрат (доля) при заданном содержании в питании. */
export function recovery(cfg: SimConfig, gradePct: number): number {
  const dev = Math.abs(gradePct - cfg.grade.targetPct);
  return Math.max(0.5, cfg.grade.recoveryMax - cfg.grade.recoveryPenaltyPerPct * dev);
}

export function inBand(cfg: SimConfig, gradePct: number): boolean {
  return Math.abs(gradePct - cfg.grade.targetPct) <= cfg.grade.bandPct;
}
