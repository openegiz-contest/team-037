/**
 * Бенчмарк для питча: прогоняет полную смену на нескольких seed для обеих стратегий
 * и печатает таблицу «насколько умная стратегия лучше». Результат также пишется в BENCHMARK.md.
 *
 *   npm run bench               — seed 1..10, 20 самосвалов
 *   npm run bench -- 25 1 20    — 25 самосвалов, seed 1..20
 */
import { writeFileSync } from 'node:fs';
import { computeEffect, computeKpis, deltaPct, Simulation, type Kpis } from '../src/sim';

const trucks = Number(process.argv[2] ?? 20);
const seedFrom = Number(process.argv[3] ?? 1);
const seedTo = Number(process.argv[4] ?? 10);
/** Месяц для погоды и сезона (1…12); по умолчанию — из конфига. */
const month = process.argv[5] ? Number(process.argv[5]) : undefined;

interface Row {
  key: string;
  label: string;
  get: (k: Kpis) => number;
  better: 'up' | 'down';
  fmt: (v: number) => string;
}

const n0 = (v: number) => Math.round(v).toLocaleString('ru-RU');
const n1 = (v: number) => v.toFixed(1);
const mln = (v: number) => `${(v / 1e6).toFixed(1)} млн`;

const rows: Row[] = [
  { key: 'total', label: 'Добыто всего, т', get: (k) => k.minedTotal, better: 'up', fmt: n0 },
  { key: 'sulf', label: 'Сульфидная руда, т', get: (k) => k.mined.sulfide, better: 'up', fmt: n0 },
  { key: 'ox', label: 'Оксидная руда, т', get: (k) => k.mined.oxide, better: 'up', fmt: n0 },
  { key: 'waste', label: 'Вскрыша, т', get: (k) => k.mined.waste, better: 'up', fmt: n0 },
  { key: 'tph', label: 'Производительность, т/ч', get: (k) => k.tph, better: 'up', fmt: n0 },
  { key: 'plan', label: 'Выполнение плана смены, %', get: (k) => k.planTotalPct, better: 'up', fmt: n1 },
  { key: 'planS', label: 'План по сульфиду, %', get: (k) => k.planPct.sulfide, better: 'up', fmt: n1 },
  { key: 'planO', label: 'План по оксиду, %', get: (k) => k.planPct.oxide, better: 'up', fmt: n1 },
  { key: 'planW', label: 'План по вскрыше, %', get: (k) => k.planPct.waste, better: 'up', fmt: n1 },
  { key: 'queue', label: 'Средняя очередь у экскаватора, мин', get: (k) => k.avgQueueMin, better: 'down', fmt: n1 },
  { key: 'util', label: 'Использование самосвалов, %', get: (k) => k.utilizationPct, better: 'up', fmt: n1 },
  { key: 'idleH', label: 'Простои самосвалов, ч', get: (k) => k.truckIdleH, better: 'down', fmt: n1 },
  { key: 'exIdleH', label: 'Простои экскаваторов, ч', get: (k) => k.excavatorIdleH, better: 'down', fmt: n1 },
  { key: 'idleCost', label: 'Стоимость простоев, ₸', get: (k) => k.idleCostKzt, better: 'down', fmt: mln },
  { key: 'crMin', label: 'Простой фабрики, мин', get: (k) => k.crusherIdleMin, better: 'down', fmt: n1 },
  { key: 'crCost', label: 'Стоимость простоя дробилки, ₸', get: (k) => k.crusherIdleCostKzt, better: 'down', fmt: mln },
  { key: 'grade', label: 'Отклонение среднего Cu на фабрике от цели, п.п.', get: (k) => Math.abs(k.feedGradePct - 0.35), better: 'down', fmt: (v) => v.toFixed(3) },
  { key: 'band', label: 'Качество в целевом коридоре, % времени', get: (k) => k.gradeInBandPct, better: 'up', fmt: n1 },
  { key: 'rec', label: 'Извлечение меди, %', get: (k) => k.recoveryPct, better: 'up', fmt: (v) => v.toFixed(2) },
  { key: 'cu', label: 'Медь в концентрате, т', get: (k) => k.cuConcT, better: 'up', fmt: n1 },
  { key: 'blast', label: 'Экскаваторо-часы в оцеплении (взрывы)', get: (k) => k.blastStopH, better: 'down', fmt: n1 },
  { key: 'fail', label: 'Аварийные отказы самосвалов', get: (k) => k.unplannedFailures, better: 'down', fmt: n1 },
  { key: 'prev', label: 'Отказов предотвращено (ППР)', get: (k) => k.preventedFailures, better: 'up', fmt: n1 },
  { key: 'false', label: 'Ложные тревоги прогноза', get: (k) => k.falseAlarms, better: 'down', fmt: n1 },
  { key: 'brokenH', label: 'Самосвало-часы в аварийном ремонте', get: (k) => k.brokenH, better: 'down', fmt: n1 },
  { key: 'fuel', label: 'Топливо, л', get: (k) => k.fuelL, better: 'down', fmt: n0 },
  { key: 'fuelT', label: 'Топливо на тонну, л/т', get: (k) => k.fuelLPerT, better: 'down', fmt: (v) => v.toFixed(3) },
];

const seeds: number[] = [];
for (let s = seedFrom; s <= seedTo; s++) seeds.push(s);

const sums = { fixed: rows.map(() => 0), smart: rows.map(() => 0) };
let wins = 0;
let effectYear = 0;
const perSeed: string[] = [];
const t0 = Date.now();

for (const seed of seeds) {
  const fixed = new Simulation({ seed, truckCount: trucks, strategy: 'fixed', month });
  const smart = new Simulation({ seed, truckCount: trucks, strategy: 'smart', month });
  fixed.runToEnd();
  smart.runToEnd();
  const kf = computeKpis(fixed);
  const ks = computeKpis(smart);
  const eff = computeEffect(kf, ks, smart);
  effectYear += eff.perYearKzt;
  rows.forEach((r, i) => {
    sums.fixed[i] += r.get(kf);
    sums.smart[i] += r.get(ks);
  });
  if (ks.minedTotal >= kf.minedTotal) wins++;
  perSeed.push(
    `| ${seed} | ${n0(kf.minedTotal)} | ${n0(ks.minedTotal)} | ${fmtDelta(deltaPct(kf.minedTotal, ks.minedTotal))} | ${n1(kf.crusherIdleMin)} | ${n1(ks.crusherIdleMin)} | ${mln(eff.perYearKzt)} |`,
  );
}

function fmtDelta(d: number): string {
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;
}

const n = seeds.length;
const lines: string[] = [];
lines.push(`# Результаты бенчмарка: умная vs фиксированная диспетчеризация`);
lines.push('');
lines.push(`Самосвалов: **${trucks}**, seed: **${seedFrom}–${seedTo}** (${n} смен по 12 ч на каждую стратегию). Средние значения.`);
lines.push('');
lines.push('| KPI | Фиксированная | Умная | Δ | Лучше? |');
lines.push('|---|---:|---:|---:|:---:|');
rows.forEach((r, i) => {
  const a = sums.fixed[i] / n;
  const b = sums.smart[i] / n;
  const d = deltaPct(a, b);
  const good = r.better === 'up' ? b >= a : b <= a;
  lines.push(`| ${r.label} | ${r.fmt(a)} | ${r.fmt(b)} | ${fmtDelta(d)} | ${good ? '✅' : '❌'} |`);
});
lines.push('');
lines.push(`**Экономический эффект (среднее): ${(effectYear / n / 1e9).toFixed(2)} млрд ₸/год** на моделируемый сегмент парка.`);
lines.push(`Умная стратегия добыла не меньше фиксированной в **${wins} из ${n}** смен.`);
lines.push('');
lines.push('## По сменам');
lines.push('');
lines.push('| seed | Добыто (фикс), т | Добыто (умная), т | Δ | Простой фабрики фикс, мин | умная, мин | Эффект, ₸/год |');
lines.push('|---:|---:|---:|---:|---:|---:|---:|');
lines.push(...perSeed);
lines.push('');
lines.push(`_Модель построена по открытым данным. Операционные данные смоделированы. Время расчёта: ${((Date.now() - t0) / 1000).toFixed(1)} с._`);

const out = lines.join('\n');
console.log(out);
writeFileSync(new URL('../BENCHMARK.md', import.meta.url), out + '\n', 'utf-8');
