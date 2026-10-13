/**
 * Сценарии «что если» — одна реализация для сервиса-симулятора (команды из двойника
 * org.aktogay:control) и для автономного режима интерфейса. Сценарий всегда применяется
 * ко всем моделям сразу, чтобы сравнение стратегий оставалось честным.
 */
import type { Simulation } from '../sim/engine';

/** Команда в признаке command двойника управления. */
export interface Command {
  value: string;
  /** Объект сценария: номер экскаватора, участка дороги или id взрыва. */
  arg?: number;
  /** Длительность сценария, мин (поломка, перекрытие). По умолчанию — DEFAULT_DUR. */
  dur?: number;
  /** Номер команды: повтор с тем же номером не выполняется. */
  seq?: number;
  seed?: number;
  trucks?: number;
}

export const DEFAULT_DUR = { breakdown: 50, close_road: 40 } as const;
export const DUR_RANGE = { breakdown: [10, 180], close_road: [10, 120] } as const;

const clampDur = (kind: keyof typeof DUR_RANGE, v: number | undefined) => {
  const [lo, hi] = DUR_RANGE[kind];
  const d = Number(v ?? DEFAULT_DUR[kind]);
  return Math.max(lo, Math.min(hi, Number.isFinite(d) ? d : DEFAULT_DUR[kind]));
};

/**
 * Применить сценарий к моделям. Возвращает описание для журнала или null, если команда
 * не сценарная (пауза, скорость, сброс — их обрабатывает тот, кто ведёт время).
 */
export function applyScenario(sims: Simulation[], c: Command): string | null {
  const a = Number(c.arg ?? 0);
  const ref = sims[0];
  if (!ref) return null;
  switch (c.value) {
    case 'breakdown': {
      const ex = ref.excavators[a];
      if (!ex) return null;
      const dur = clampDur('breakdown', c.dur);
      for (const s of sims) s.injectExcavatorBreakdown(a, dur * 60);
      return `поломка экскаватора ${ex.name} на ${dur} мин`;
    }
    case 'repair': {
      const ok = sims.map((s) => s.repairExcavator(a)).some(Boolean);
      return ok ? `отмена поломки ${ref.excavators[a]?.name ?? a}` : `${ref.excavators[a]?.name ?? a} не в ремонте`;
    }
    case 'close_road': {
      const g = ref.layout.closureGroups[a];
      if (!g) return null;
      const dur = clampDur('close_road', c.dur);
      const ok = sims.map((s) => s.injectRoadClosure(a, dur * 60)).every(Boolean);
      return ok ? `перекрыт ${g.label} на ${dur} мин` : `нельзя перекрыть ${g.label}: сеть дорог разорвётся или участок уже закрыт`;
    }
    case 'open_road': {
      const ok = sims.map((s) => s.openRoad(a)).some(Boolean);
      return ok ? `открыт ${ref.layout.closureGroups[a]?.label ?? a}` : 'участок не был закрыт';
    }
    case 'blast': {
      const ex = ref.excavators[a];
      if (!ex) return null;
      for (const s of sims) s.scheduleBlast(a, s.cfg.blasting.warnMin * 60);
      return `объявлен взрыв у ${ex.name} через ${ref.cfg.blasting.warnMin} мин`;
    }
    case 'cancel_blast': {
      const ok = sims.map((s) => s.cancelBlast(a)).some(Boolean);
      return ok ? `отменён взрыв #${a}` : `взрыв #${a} уже завершён`;
    }
    case 'cancel_all':
      for (const s of sims) {
        s.excavators.forEach((ex) => s.repairExcavator(ex.id));
        s.layout.closureGroups.forEach((_, g) => s.openRoad(g));
        s.blasts.filter((b) => b.phase === 'warning' || b.phase === 'active').forEach((b) => s.cancelBlast(b.id));
      }
      return 'все сценарии отменены';
    default:
      return null;
  }
}

/** Что сейчас нарушает нормальную работу рудника (по одной модели — события у всех общие). */
export interface ActiveDeviation {
  kind: 'breakdown' | 'closure' | 'blast';
  /** Команда отмены и её аргумент. */
  undo: { value: string; arg: number };
  title: string;
  detail: string;
  /** Осталось, с (до конца поломки/закрытия/оцепления или до взрыва). */
  leftSec: number;
  phase?: 'warning' | 'active';
}

export function activeDeviations(sim: Simulation): ActiveDeviation[] {
  const out: ActiveDeviation[] = [];
  for (const ex of sim.excavators) {
    if (ex.state !== 'broken') continue;
    out.push({
      kind: 'breakdown',
      undo: { value: 'repair', arg: ex.id },
      title: `Поломка экскаватора ${ex.name}`,
      detail: 'Экскаватор стоит, его самосвалы ждут или перераспределяются',
      leftSec: Math.max(0, ex.brokenLeft),
    });
  }
  const groups = sim.layout.closureGroups;
  for (const c of sim.closures) {
    const g = groups.findIndex((x) => x.label === c.label);
    if (g < 0) continue; // закрытие из-за взрыва показываем вместе со взрывом
    out.push({
      kind: 'closure',
      undo: { value: 'open_road', arg: g },
      title: `Перекрыт ${c.label}`,
      detail: 'Маршруты строятся в объезд',
      leftSec: Math.max(0, c.until - sim.now),
    });
  }
  for (const b of sim.blasts) {
    if (b.phase !== 'warning' && b.phase !== 'active') continue;
    const names = b.exIds.map((i) => sim.excavators[i]?.name).filter(Boolean).join(', ');
    out.push({
      kind: 'blast',
      undo: { value: 'cancel_blast', arg: b.id },
      title: `${b.label} #${b.id}${b.manual ? '' : ' (плановый)'}`,
      detail: b.phase === 'warning' ? `Предупреждение, техника выводится из зоны ${b.radius} м${names ? ` · ${names}` : ''}` : `Оцепление ${b.radius} м${names ? ` · стоят ${names}` : ''}`,
      leftSec: Math.max(0, b.phase === 'warning' ? b.t - sim.now : b.t + b.dur - sim.now),
      phase: b.phase,
    });
  }
  return out;
}

/** Короткие строки для статуса двойника управления. */
export function activeScenarioLabels(sim: Simulation): string[] {
  return activeDeviations(sim).map((d) => d.title);
}
