/**
 * Цвета интерфейса. Категориальные палитры для графиков проверены валидатором
 * (тёмная поверхность #14181d: светлота, хрома, различимость при дальтонизме, контраст).
 */
import type { Material, StrategyName, TruckState } from '../sim';

export const STRATEGY_COLOR: Record<StrategyName, string> = {
  fixed: '#3987e5',
  smart: '#d95926',
};

/** Группы состояний для графиков и легенды карты. */
export type StateGroup = 'loading' | 'loaded' | 'empty' | 'dumping' | 'waiting' | 'service';

export const STATE_GROUPS: { key: StateGroup; label: string; color: string; states: TruckState[] }[] = [
  { key: 'loading', label: 'Погрузка', color: '#9085e9', states: ['loading'] },
  { key: 'loaded', label: 'Гружёный рейс', color: '#d95926', states: ['loaded'] },
  { key: 'empty', label: 'Порожний рейс', color: '#199e70', states: ['empty'] },
  { key: 'dumping', label: 'Разгрузка', color: '#3987e5', states: ['dumping'] },
  { key: 'waiting', label: 'Очередь / простой', color: '#c98500', states: ['queue', 'idle'] },
  { key: 'service', label: 'Заправка / ремонт', color: '#d55181', states: ['refuel', 'service', 'broken'] },
];

export const TRUCK_COLOR: Record<TruckState, string> = {
  loading: '#9085e9',
  loaded: '#d95926',
  empty: '#199e70',
  dumping: '#3987e5',
  queue: '#c98500',
  idle: '#8a8f98',
  refuel: '#d55181',
  service: '#22d3ee',
  broken: '#e5484d',
};

export const MATERIAL_COLOR: Record<Material, string> = {
  sulfide: '#e0b341',
  oxide: '#2bb39a',
  waste: '#9c8f80',
};

export const EXCAVATOR_SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'];

export const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
};
