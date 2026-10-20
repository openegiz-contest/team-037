/**
 * Справочник датчиков SENSORS.md — собирается из `src/platform/sensors.ts`, чтобы документ
 * не расходился с кодом. Запуск: npm run sensors
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SENSORS_BY_KIND } from '../src/platform/sensors';

/** Объекты в порядке технологической цепочки, с русскими названиями. */
const ORDER: [string, string][] = [
  ['haul-truck', 'Самосвал'],
  ['excavator', 'Экскаватор'],
  ['drill-rig', 'Буровой станок'],
  ['orebody', 'Геология: рудное тело и рудный контроль'],
  ['crusher', 'Первичная дробилка ККД'],
  ['stockpile', 'Склад дроблёной руды'],
  ['concentrator', 'Обогатительная фабрика'],
  ['concentrate-store', 'Склад концентрата и ж/д погрузка'],
  ['heap-leach', 'Площадка кучного выщелачивания'],
  ['sxew-plant', 'Завод SX-EW'],
  ['waste-dump', 'Отвал вскрыши'],
  ['tailings-dam', 'Хвостохранилище'],
  ['weather-station', 'Погода и сезон'],
  ['power-meter', 'Электроснабжение'],
  ['garage', 'Гараж, АЗС и стоянка'],
];

const total = Object.values(SENSORS_BY_KIND).reduce((n, v) => n + v.length, 0);
const out: string[] = [
  '# Датчики цифрового двойника',
  '',
  `Паспорт приборов, которыми снимаются показания объектов рудника: **${total} описаний на ${ORDER.length} видов объектов**.`,
  'У каждого датчика записано, что установлено, где стоит, что меряет, с каким периодом опрашивается,',
  'какие признаки двойника заполняет и зачем это нужно. Паспорт лежит в атрибуте `sensors` каждого',
  'двойника в Ditto и показан в интерфейсе в карточке объекта и в разделе «Двойники».',
  '',
  '> Этот файл собирается из `src/platform/sensors.ts` командой `npm run sensors` — правьте код, а не документ.',
  '> Состав приборов подобран по открытым описаниям горной техники и обогатительного оборудования;',
  '> показания в модели синтетические. `*` в имени признака — семейство по номеру объекта',
  '> (`block_*_cu` → `block_1_cu`, `block_2_cu`…). У разовых съёмок результат лежит в атрибутах паспорта.',
  '',
];

for (const [kind, title] of ORDER) {
  const list = SENSORS_BY_KIND[kind];
  if (!list) continue;
  out.push(`## ${title}`, '', `\`kind: ${kind}\` · датчиков: ${list.length}`, '');
  for (const s of list) {
    out.push(`### ${s.name}`, '');
    out.push(`- **Что установлено:** ${s.hardware}`);
    out.push(`- **Где:** ${s.location}`);
    out.push(`- **Что меряет:** ${s.measures}`);
    out.push(`- **Период опроса:** ${s.periodS === 0 ? 'разовая съёмка (результат — в атрибутах)' : `${s.periodS} с`}`);
    out.push(`- **Зачем:** ${s.purpose}`);
    out.push(`- **Признаки двойника:** ${s.features.map((f) => `\`${f}\``).join(', ')}`);
    out.push('');
  }
}

const path = resolve(import.meta.dirname, '..', 'SENSORS.md');
writeFileSync(path, out.join('\n'), 'utf8');
console.log(path, `— ${total} датчиков`);
