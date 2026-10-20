/**
 * Погода и сезон. У Актогая резко континентальный климат: зимой до −30…−40 °C, летом за +35,
 * сильные ветры, весной и летом пыль, зимой метели. Погода — не украшение: она меняет скорость
 * возки, видимость, работу дробилки на подмёрзшей руде, скорость кучного выщелачивания,
 * водный баланс хвостохранилища и возможность взрывать.
 *
 * Месячные нормы — оценки по открытым климатическим данным востока Казахстана, не данные
 * метеостанции рудника. Коэффициенты влияния — тоже оценки, они собраны в этом файле.
 * Погода внутри смены разыгрывается отдельным потоком случайных чисел, поэтому добавление
 * модуля не сдвинуло остальные потоки модели.
 */
import type { Simulation } from './engine';
import { Rng, subSeed } from './rng';

export type Sky = 'clear' | 'cloudy' | 'rain' | 'snow' | 'blizzard' | 'fog' | 'dust' | 'heat';
export type Season = 'winter' | 'spring' | 'summer' | 'autumn';

/** Как состояние неба влияет на возку и видимость. */
export const SKY: Record<Sky, { speed: number; visM: number; ru: string }> = {
  clear: { speed: 1, visM: 20000, ru: 'ясно' },
  cloudy: { speed: 1, visM: 15000, ru: 'облачно' },
  rain: { speed: 0.92, visM: 4000, ru: 'дождь' },
  snow: { speed: 0.84, visM: 1200, ru: 'снег' },
  blizzard: { speed: 0.5, visM: 180, ru: 'метель' },
  fog: { speed: 0.76, visM: 350, ru: 'туман' },
  dust: { speed: 0.82, visM: 800, ru: 'пыльная буря' },
  heat: { speed: 0.97, visM: 12000, ru: 'жара' },
};

/** Среднемесячная температура, °C, и ветер, м/с (оценки по открытым климатическим данным). */
const MONTH: { tC: number; wind: number; evap: number }[] = [
  { tC: -13, wind: 3.6, evap: 0.15 }, // январь
  { tC: -12, wind: 3.8, evap: 0.15 },
  { tC: -4, wind: 4.4, evap: 0.4 },
  { tC: 7, wind: 4.6, evap: 1.0 },
  { tC: 14, wind: 4.2, evap: 1.6 },
  { tC: 20, wind: 3.8, evap: 2.4 },
  { tC: 22, wind: 3.4, evap: 2.6 },
  { tC: 20, wind: 3.4, evap: 2.3 },
  { tC: 14, wind: 3.8, evap: 1.5 },
  { tC: 5, wind: 4.2, evap: 0.8 }, // октябрь
  { tC: -5, wind: 4.2, evap: 0.3 },
  { tC: -11, wind: 3.8, evap: 0.15 },
];

/** Какая погода вероятна в этом сезоне. */
const WEIGHTS: Record<Season, Partial<Record<Sky, number>>> = {
  winter: { clear: 0.34, cloudy: 0.34, snow: 0.22, blizzard: 0.06, fog: 0.04 },
  spring: { clear: 0.4, cloudy: 0.3, rain: 0.15, dust: 0.1, fog: 0.05 },
  summer: { clear: 0.5, cloudy: 0.2, heat: 0.2, dust: 0.08, rain: 0.02 },
  autumn: { clear: 0.36, cloudy: 0.32, rain: 0.14, snow: 0.08, fog: 0.06, dust: 0.04 },
};

export const SEASON_RU: Record<Season, string> = { winter: 'зима', spring: 'весна', summer: 'лето', autumn: 'осень' };
export const MONTH_RU = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

export function seasonOf(month: number): Season {
  if (month === 12 || month <= 2) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'autumn';
}

/** Смена начинается в 8 утра — от этого считается суточный ход температуры и положение солнца. */
export const SHIFT_START_HOUR = 8;
/** Как долго держится одна погода, с. */
const SPELL_MIN = 30 * 60;
const SPELL_MAX = 75 * 60;
/** Ветер, при котором взрывать нельзя (пылегазовое облако сносит), м/с. */
export const BLAST_WIND_MS = 12;
/** Ниже этой температуры орошение карт выщелачивания останавливают, °C. */
export const LEACH_FROST_C = -5;

export class Weather {
  readonly month: number;
  readonly season: Season;
  sky: Sky = 'clear';
  tempC = 0;
  windMs = 0;
  /** Сценарий «вызвать погоду»: сколько ещё держать принудительную погоду, с. */
  forcedLeft = 0;
  private until = 0;
  private readonly rng: Rng;

  constructor(seed: number, month: number) {
    this.month = Math.min(12, Math.max(1, Math.round(month)));
    this.season = seasonOf(this.month);
    this.rng = new Rng(subSeed(seed, 9900));
    this.sky = this.roll();
    this.until = SPELL_MIN;
    this.refresh(0);
  }

  private roll(): Sky {
    const w = WEIGHTS[this.season];
    const total = Object.values(w).reduce((a, b) => a + (b ?? 0), 0);
    let x = this.rng.next() * total;
    for (const [k, v] of Object.entries(w)) {
      x -= v ?? 0;
      if (x <= 0) return k as Sky;
    }
    return 'clear';
  }

  /** Температура и ветер на момент времени смены. */
  private refresh(now: number): void {
    const hour = (SHIFT_START_HOUR + now / 3600) % 24;
    const norm = MONTH[this.month - 1];
    // Максимум около 15:00, минимум под утро.
    const diurnal = 6 * Math.sin((2 * Math.PI * (hour - 9)) / 24);
    const skyT = this.sky === 'blizzard' ? -4 : this.sky === 'heat' ? 6 : this.sky === 'clear' ? 1 : this.sky === 'fog' ? -1 : 0;
    this.tempC = norm.tC + diurnal + skyT;
    this.windMs = norm.wind + (this.sky === 'blizzard' ? 9 : this.sky === 'dust' ? 6 : this.sky === 'heat' ? -1 : 0);
  }

  update(sim: Simulation, dt: number): void {
    if (this.forcedLeft > 0) {
      this.forcedLeft -= dt;
      if (this.forcedLeft <= 0) {
        this.forcedLeft = 0;
        this.set(sim, this.roll());
        this.until = sim.now + SPELL_MIN;
      }
    } else if (sim.now >= this.until) {
      const next = this.roll();
      this.until = sim.now + SPELL_MIN + this.rng.next() * (SPELL_MAX - SPELL_MIN);
      if (next !== this.sky) this.set(sim, next);
    }
    this.refresh(sim.now);
  }

  private set(sim: Simulation, sky: Sky): void {
    if (sky === this.sky) return;
    this.sky = sky;
    this.refresh(sim.now);
    const bad = sky === 'blizzard' || sky === 'dust' || sky === 'fog';
    sim.addLog(`Погода: ${SKY[sky].ru}, ${Math.round(this.tempC) || 0} °C, ветер ${Math.round(this.windMs)} м/с${bad ? ' — ограничение скорости' : ''}`, bad ? 'warn' : 'info');
  }

  /** Принудительная погода — сценарий «что если» из интерфейса. */
  force(sim: Simulation, sky: Sky, sec: number): void {
    this.forcedLeft = sec;
    this.set(sim, sky);
  }

  get visibilityM(): number {
    return SKY[this.sky].visM;
  }

  /** Во сколько раз медленнее едут самосвалы. */
  get speedFactor(): number {
    return SKY[this.sky].speed * (this.tempC < -25 ? 0.93 : 1);
  }

  /** Подмёрзшая и сырая руда зависает в приёмном бункере — дробилка выдаёт меньше. */
  get crusherFactor(): number {
    if (this.tempC <= -2 && (this.sky === 'snow' || this.sky === 'blizzard')) return 0.78;
    if (this.sky === 'rain' && this.tempC < 6) return 0.9;
    return 1;
  }

  /** Холод сильно замедляет выщелачивание; в мороз орошение останавливают. */
  get leachFactor(): number {
    if (!this.irrigationOn) return 0;
    return Math.min(1.3, Math.max(0.12, 2 ** ((this.tempC - 20) / 14)));
  }

  get irrigationOn(): boolean {
    return this.tempC >= LEACH_FROST_C;
  }

  /** Испарение с зеркала пруда относительно среднегодового. */
  get evapFactor(): number {
    return MONTH[this.month - 1].evap;
  }

  /** Весеннее снеготаяние поднимает пруд хвостохранилища, м³/ч. */
  get meltM3h(): number {
    return this.month === 3 ? 900 : this.month === 4 ? 500 : 0;
  }

  /** Можно ли взрывать: при сильном ветре облако сносит, в метель и туман оцепление не выставить. */
  get blastOk(): boolean {
    return this.windMs < BLAST_WIND_MS && this.sky !== 'blizzard' && this.sky !== 'fog';
  }

  get ru(): string {
    return SKY[this.sky].ru;
  }
}
