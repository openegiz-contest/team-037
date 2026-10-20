/**
 * Сценарии «что если» — одна реализация для сервиса-симулятора (команды из двойника
 * org.aktogay:control) и для автономного режима интерфейса. Сценарий всегда применяется
 * ко всем моделям сразу, чтобы сравнение стратегий оставалось честным.
 */
import { SKY, type Sky } from '../sim/weather';
import type { Simulation } from '../sim/engine';

/** Команда в признаке command двойника управления. */
export interface Command {
  value: string;
  /** Объект сценария: номер экскаватора, участка дороги или id взрыва. */
  /** Параметр сценария: номер объекта или, для погоды, название явления. */
  arg?: number | string;
  /** Длительность сценария, мин (поломка, перекрытие). По умолчанию — DEFAULT_DUR. */
  dur?: number;
  /** Номер команды: повтор с тем же номером не выполняется. */
  seq?: number;
  seed?: number;
  trucks?: number;
  /** Новый парк техники (reset): см. platform/fleet.ts. */
  fleet?: unknown;
  /** Месяц года для погоды и сезона (команда reset). */
  month?: number;
}

export const DEFAULT_DUR = { breakdown: 50, close_road: 40, drill_down: 240, weather: 60, power_cut: 25, storm_water: 180, leach_stop: 180 } as const;
export const DUR_RANGE = { breakdown: [10, 180], close_road: [10, 120], drill_down: [30, 600], weather: [15, 360], power_cut: [5, 120], storm_water: [15, 240], leach_stop: [30, 720] } as const;

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
    case 'power_cut': {
      const dur = clampDur('power_cut', c.dur);
      for (const s of sims) s.injectPowerCut(dur * 60);
      return `отключение электроснабжения на ${dur} мин`;
    }
    case 'storm_water': {
      const dur = clampDur('storm_water', c.dur);
      // arg: 0 — ливень, 1 — сильное снеготаяние; приток в пруд, м³/ч.
      const rate = a >= 1 ? 70_000 : 120_000;
      for (const s of sims) s.injectStormWater(rate, dur * 60);
      return `${a >= 1 ? 'снеготаяние' : 'ливень'}: приток ${rate.toLocaleString('ru-RU')} м³/ч в пруд на ${dur} мин`;
    }
    case 'leach_stop': {
      const dur = clampDur('leach_stop', c.dur);
      for (const s of sims) s.injectLeachStop(dur * 60);
      return `орошение карт остановлено на ${dur} мин`;
    }
    case 'weather': {
      const sky = String(c.arg ?? 'blizzard') as Sky;
      if (!(sky in SKY)) return null;
      const dur = clampDur('weather', c.dur);
      for (const s of sims) s.weather.force(s, sky, dur * 60);
      return `погода: ${SKY[sky].ru} на ${dur} мин`;
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
    case 'drill_down': {
      // arg: 0 — БУ-1, 1 — БУ-2, 2 — оба станка.
      const dur = clampDur('drill_down', c.dur);
      const ids = a === 2 ? [0, 1] : [a];
      for (const s of sims) for (const i of ids) s.drill.breakRig(i, dur * 60);
      const names = ids.map((i) => ref.drill.rigs[i]?.name).join(' и ');
      for (const s of sims) s.addLog(`Поломка бурового станка ${names}, ремонт ~${dur} мин — бурение блоков остановлено`, 'alarm');
      return `поломка бурового станка ${names} на ${dur} мин`;
    }
    case 'drill_repair': {
      const ok = sims.map((s) => s.drill.repairRig(a)).some(Boolean);
      return ok ? `отмена поломки ${ref.drill.rigs[a]?.name}` : `${ref.drill.rigs[a]?.name ?? a} не в ремонте`;
    }
    case 'cancel_all':
      for (const s of sims) {
        s.drill.rigs.forEach((g) => s.drill.repairRig(g.id));
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
  kind: 'breakdown' | 'closure' | 'blast' | 'drill' | 'nostock';
  /** Команда отмены и её аргумент (нет — отклонение снимается само). */
  undo: { value: string; arg: number } | null;
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
  for (const g of sim.drill.rigs) {
    if (g.state !== 'broken') continue;
    out.push({
      kind: 'drill',
      undo: { value: 'drill_repair', arg: g.id },
      title: `Поломка бурового станка ${g.name}`,
      detail: g.target !== null ? `Блок у ${sim.excavators[g.target]?.name}: ${sim.drill.blocks[g.target].holesDone}/${sim.drill.blocks[g.target].holesTotal} скважин` : 'Бурение остановлено',
      leftSec: Math.max(0, g.brokenLeft),
    });
  }
  for (const ex of sim.excavators) {
    if (ex.state !== 'nostock') continue;
    out.push({
      kind: 'nostock',
      undo: null,
      title: `${ex.name}: нет взорванной массы`,
      detail: 'Экскаватор стоит до взрыва обуренного блока',
      leftSec: 0,
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
