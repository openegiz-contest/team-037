import { describe, expect, it } from 'vitest';
import { Simulation } from '..';
import { parseObservation, skyFromCode } from '../liveWeather';

const mk = () => new Simulation({ seed: 7, truckCount: 20, strategy: 'smart' });
const current = (temperature_2m: number, wind_speed_10m: number, weather_code: number) => ({
  current: { time: '2026-10-23T09:30', temperature_2m, wind_speed_10m, weather_code },
});

describe('живая погода: разбор наблюдения', () => {
  it('коды WMO переводятся в состояние неба', () => {
    expect(skyFromCode(0, 5, 3)).toBe('clear');
    expect(skyFromCode(3, 5, 3)).toBe('cloudy');
    expect(skyFromCode(48, -3, 2)).toBe('fog');
    expect(skyFromCode(61, 8, 4)).toBe('rain');
    expect(skyFromCode(95, 12, 4)).toBe('rain');
    expect(skyFromCode(73, -6, 4)).toBe('snow');
    expect(skyFromCode(73, -6, 14)).toBe('blizzard'); // снег с сильным ветром
    expect(skyFromCode(0, 20, 16)).toBe('dust'); // сухо, тепло и ветрено
    expect(skyFromCode(0, 35, 3)).toBe('heat');
  });

  it('ответ сервиса разбирается, мусор отбрасывается', () => {
    expect(parseObservation(current(5.3, 4.6, 1))).toEqual({ sky: 'clear', tempC: 5.3, windMs: 4.6, at: '2026-10-23T09:30' });
    expect(parseObservation(null)).toBeNull();
    expect(parseObservation({})).toBeNull();
    expect(parseObservation({ current: { temperature_2m: 'нет', wind_speed_10m: 4, weather_code: 0 } })).toBeNull();
    expect(parseObservation(current(999, 4, 0))).toBeNull();
    expect(parseObservation(current(5, -3, 0))).toBeNull();
  });
});

describe('живая погода: модель', () => {
  it('по умолчанию погода берётся из климатических норм', () => {
    const s = mk();
    s.advance(3600);
    expect(s.weather.observed).toBeNull();
  });

  it('наблюдение задаёт небо, температуру и ветер и держится до следующего', () => {
    const s = mk();
    s.weather.observe(s, { sky: 'blizzard', tempC: -18, windMs: 14, at: '2026-10-23T09:30' });
    s.advance(2 * 3600);
    expect(s.weather.sky).toBe('blizzard');
    expect(s.weather.tempC).toBe(-18);
    expect(s.weather.windMs).toBe(14);
    expect(s.weather.blastOk).toBe(false); // метель и сильный ветер — взрывать нельзя
    expect(s.weather.speedFactor).toBeLessThan(0.6);
    expect(s.weather.irrigationOn).toBe(false); // мороз: орошение карт стоит
    s.weather.observe(s, { sky: 'clear', tempC: 9, windMs: 3, at: '2026-10-23T10:30' });
    s.advance(600);
    expect(s.weather.sky).toBe('clear');
    expect(s.weather.tempC).toBe(9);
  });

  it('сценарий «вызвать погоду» имеет приоритет, после него возвращается наблюдение', () => {
    const s = mk();
    s.weather.observe(s, { sky: 'clear', tempC: 10, windMs: 3, at: '2026-10-23T09:30' });
    s.weather.force(s, 'dust', 600);
    s.advance(300);
    expect(s.weather.sky).toBe('dust');
    s.advance(600);
    expect(s.weather.sky).toBe('clear');
    expect(s.weather.tempC).toBe(10);
  });

  it('живая погода не меняет остальные случайные события смены', () => {
    const a = mk();
    const b = mk();
    b.weather.observe(b, { sky: 'clear', tempC: 10, windMs: 3, at: '2026-10-23T09:30' });
    a.advance(4 * 3600);
    b.advance(4 * 3600);
    // одинаковый seed: те же поломки и взрывы, различается только погода и её следствия
    expect(b.stats.unplannedFailures).toBe(a.stats.unplannedFailures);
    expect(b.blasts.length).toBe(a.blasts.length);
  });
});
