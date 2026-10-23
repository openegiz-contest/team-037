/**
 * Живая погода рудника (по желанию): вместо климатических норм двойник берёт фактическую погоду
 * в точке Актогая из открытого сервиса Open-Meteo. Так же в жизни работает метеостанция рудника:
 * двойник получает наблюдение и пересчитывает по нему скорость возки, работу дробилки, орошение
 * карт и разрешение на взрывные работы.
 *
 * Включается переменной окружения `AKTOGAY_LIVE_WEATHER=1`. Выключено — остаются нормы ERA5
 * 2015–2024, то есть без интернета стенд работает как прежде. Если запрос не удался или ответ
 * странный, модель молча остаётся на нормах: наблюдение не применяется.
 *
 * Наблюдение — снимок: температура и ветер держатся до следующего запроса (раз в 10 минут), суточный
 * ход к ним не добавляется. Случайный поток погоды при этом не трогается, поэтому включение живой
 * погоды не сдвигает остальные случайные события смены.
 */
import { GEO_REF } from '../geo/geoRef';
import type { Sky } from './weather';

/** Наблюдение метеостанции: что именно приняла модель. */
export interface Observation {
  sky: Sky;
  tempC: number;
  windMs: number;
  /** Время наблюдения по данным сервиса, ISO-строка (UTC). */
  at: string;
}

export const LIVE_URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${GEO_REF.lat}&longitude=${GEO_REF.lon}` +
  '&current=temperature_2m,wind_speed_10m,weather_code&wind_speed_unit=ms&timezone=UTC';

/** Как часто опрашивать сервис, мс (у него данные обновляются примерно раз в 15 минут). */
export const LIVE_EVERY_MS = 10 * 60 * 1000;

/** Ветер, с которого поднимается пыль (сухо и тепло), и ветер метели, м/с. */
const DUST_WIND_MS = 11;
const BLIZZARD_WIND_MS = 10;
/** С этой температуры день считается жарким. */
const HEAT_C = 32;

/**
 * Код погоды WMO → состояние неба модели. Коды: 0 ясно, 1–3 облачность, 45/48 туман,
 * 51–57 морось, 61–67 дождь, 71–77 снег, 80–82 ливни, 85/86 снежные заряды, 95–99 гроза.
 */
export function skyFromCode(code: number, tempC: number, windMs: number): Sky {
  const snow = (code >= 71 && code <= 77) || code === 85 || code === 86 || ((code === 66 || code === 67) && tempC < 0);
  const rain = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99);
  if (code === 45 || code === 48) return 'fog';
  if (snow) return windMs >= BLIZZARD_WIND_MS ? 'blizzard' : 'snow';
  if (rain) return 'rain';
  // Сухая погода: сильный ветер поднимает пыль, в жару — «жара».
  if (windMs >= DUST_WIND_MS && tempC > 5) return 'dust';
  if (tempC >= HEAT_C) return 'heat';
  return code === 0 || code === 1 ? 'clear' : 'cloudy';
}

/** Разобрать ответ Open-Meteo. Вернёт null, если полей нет или числа не похожи на погоду. */
export function parseObservation(json: unknown): Observation | null {
  const c = (json as { current?: Record<string, unknown> } | null)?.current;
  if (!c) return null;
  const tempC = Number(c.temperature_2m);
  const windMs = Number(c.wind_speed_10m);
  const code = Number(c.weather_code);
  const at = typeof c.time === 'string' ? c.time : '';
  if (!Number.isFinite(tempC) || !Number.isFinite(windMs) || !Number.isFinite(code)) return null;
  if (tempC < -70 || tempC > 60 || windMs < 0 || windMs > 60) return null;
  return { sky: skyFromCode(code, tempC, windMs), tempC, windMs, at };
}

/** Запросить текущую погоду. Любая ошибка — null: модель остаётся на климатических нормах. */
export async function fetchObservation(timeoutMs = 10_000): Promise<Observation | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(LIVE_URL, { signal: ctl.signal, headers: { 'User-Agent': 'aktogay-digital-twin/1.0 (contest prototype)' } });
    if (!r.ok) return null;
    return parseObservation(await r.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
