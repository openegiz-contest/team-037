/** Погода в шапке: что за бортом и как это сейчас влияет на работу. */
import type { Simulation } from '../sim';
import { SEASON_RU, SHIFT_START_HOUR, type Sky } from '../sim/weather';
import { clockRu, daylight } from '../render3d/daylight';

const ICON: Record<Sky, string> = {
  clear: '☀',
  cloudy: '☁',
  rain: '☔',
  snow: '❄',
  blizzard: '❆',
  fog: '▒',
  dust: '≈',
  heat: '▲',
};

export function WeatherChip({ sim }: { sim: Simulation }) {
  const w = sim.weather;
  const slow = w.speedFactor < 0.99;
  // Местное время смены и светло ли сейчас — солнце считается по широте рудника.
  const hour = SHIFT_START_HOUR + sim.now / 3600;
  const night = daylight(w.month, hour).dayK < 0.35;
  const title =
    `${SEASON_RU[w.season]}, ${w.ru}. Видимость ${w.visibilityM >= 1000 ? `${(w.visibilityM / 1000).toFixed(0)} км` : `${w.visibilityM} м`}.` +
    ` Скорость возки ${Math.round(w.speedFactor * 100)} % от нормы, дробилка ${Math.round(w.crusherFactor * 100)} %,` +
    ` выщелачивание ${Math.round(w.leachFactor * 100)} %. Взрывные работы: ${w.blastOk ? 'разрешены' : 'запрещены'}.` +
    ` Местное время ${clockRu(hour)}, ${night ? 'темно' : 'светло'}.` +
    ' Климатические нормы — оценки по открытым данным.';
  return (
    <span
      className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] ${slow ? 'bg-sky-500/15 ring-1 ring-sky-400/40' : 'bg-panel-2'}`}
      title={title}
    >
      <span aria-hidden>{night ? '☽' : ICON[w.sky]}</span>
      <span className="num text-ink-2">{clockRu(hour)}</span>
      <span className="font-semibold">{w.ru}</span>
      <span className="num text-ink-2">{w.tempC.toFixed(0)} °C</span>
      <span className="hidden text-ink-3 xl:inline">ветер {w.windMs.toFixed(0)} м/с</span>
      {slow && <span className="num font-semibold text-sky-300">возка {Math.round(w.speedFactor * 100)} %</span>}
      {!w.blastOk && <span className="text-amber-300">взрывы ✕</span>}
    </span>
  );
}
