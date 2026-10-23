/**
 * Сводка смены: то, что начальник смены сдаёт в конце, одной страницей. Собирается из тех же
 * данных, что показывает интерфейс (KPI, себестоимость, эффект, происшествия смены), поэтому
 * цифры в сводке и на экранах всегда совпадают. Отсюда же строятся печать (PDF) и выгрузка CSV.
 */
import { computeEffect, computeKpis, costBreakdown, forecastShift, MATERIAL_SHORT, type Kpis, type ShiftForecast, type Simulation } from '../sim';
import { analyzeShift } from '../sim/causality';
import { CHARGE_PER_HOLE_T } from '../sim/site';
import { fmtClock, fmtInt, fmtKzt } from './format';
import { translate } from './i18n';

export interface ReportRow {
  label: string;
  value: string;
  /** Пояснение справа мелким шрифтом (план, норма, сравнение). */
  note?: string;
  tone?: 'good' | 'bad' | 'warn';
}

export interface ReportSection {
  title: string;
  rows: ReportRow[];
}

/** Раньше этого времени смены оценка эффекта ещё не устоялась — в сводке её не показываем. */
export const EFFECT_AFTER_SEC = 3600;

export interface ShiftReport {
  /** Время смены (с) и её доля, %. */
  nowSec: number;
  donePct: number;
  subtitle: string;
  sections: ReportSection[];
  /** Происшествия смены: что случилось и чего это стоило. */
  incidents: { title: string; detail: string; kzt: number }[];
  /** Чем смена закончится, если дальше будет как в последний час. */
  forecast: ShiftForecast;
  /** Итог: эффект системы за смену и в год. Пока смена короче часа — оценка не готова (`effectReady`). */
  effectReady: boolean;
  effectShiftKzt: number;
  effectYearKzt: number;
}

const pct = (v: number) => `${v.toFixed(1)} %`;
const t1 = (v: number) => `${v.toFixed(1)} т`;

/**
 * Собрать сводку. `smart` — реальная работа, `fixed` — теневой расчёт без системы (если он есть,
 * в сводку попадает эффект системы и сравнение). На стенде KPI приходят из двойников, поэтому их
 * можно передать готовыми: иначе доли времени самосвалов пришлось бы считать по неполным данным.
 */
export function buildShiftReport(smart: Simulation, fixed?: Simulation, kpis?: { smart: Kpis; fixed?: Kpis }): ShiftReport {
  const k = kpis?.smart ?? computeKpis(smart);
  const cost = costBreakdown(smart, k);
  const w = smart.weather;
  const chains = analyzeShift(smart, fixed);
  // Эффект считается по разнице с теневым расчётом; в первый час смены разброс велик, поэтому ждём.
  const effectReady = !!fixed && smart.now >= EFFECT_AFTER_SEC;
  const effect = effectReady && fixed ? computeEffect(kpis?.fixed ?? computeKpis(fixed), k, smart) : null;
  const shiftH = smart.cfg.shift.durationSec / 3600;

  const sections: ReportSection[] = [
    {
      title: 'Добыча и план',
      rows: [
        { label: 'Добыто за смену', value: `${fmtInt(k.minedTotal)} т`, note: `план ${pct(k.planTotalPct)}`, tone: k.planTotalPct >= 95 ? 'good' : k.planTotalPct < 80 ? 'bad' : 'warn' },
        ...(['sulfide', 'oxide', 'waste'] as const).map((m) => ({
          label: MATERIAL_SHORT[m],
          value: `${fmtInt(k.mined[m])} т`,
          note: `план ${pct(k.planPct[m])}`,
        })),
        { label: 'Темп добычи', value: `${fmtInt(k.tph)} т/ч`, note: `рейсов ${k.trips}` },
        { label: 'Вскрыши на тонну руды', value: (k.mined.waste / Math.max(1, k.mined.sulfide + k.mined.oxide)).toFixed(2) },
      ],
    },
    {
      title: 'Переработка и медь',
      rows: [
        { label: 'Подано руды на фабрику', value: `${fmtInt(smart.stats.plantFeedT)} т`, note: `вторая цепочка ${fmtInt(smart.chain2.stats.plantFeedT)} т` },
        { label: 'Медь в питании', value: `${k.feedGradePct.toFixed(3)} %`, note: `в коридоре ${pct(k.gradeInBandPct)} времени`, tone: k.gradeInBandPct >= 90 ? 'good' : 'warn' },
        { label: 'Извлечение меди', value: pct(k.recoveryPct) },
        { label: 'Медь в концентрате', value: t1(k.cuConcT) },
        { label: 'Катодная медь (SX-EW)', value: t1(smart.leach.cathodeT) },
        { label: 'Отгружено концентрата', value: `${fmtInt(smart.concentrate.shippedT)} т`, note: `составов ${smart.concentrate.trains}` },
      ],
    },
    {
      title: 'Техника и простои',
      rows: [
        { label: 'Использование самосвалов', value: pct(k.utilizationPct), note: `в работе ${smart.trucks.length}` },
        { label: 'Средняя очередь у экскаватора', value: `${k.avgQueueMin.toFixed(2)} мин` },
        { label: 'Простои самосвалов и экскаваторов', value: `${(k.truckIdleH + k.excavatorIdleH).toFixed(1)} ч`, note: fmtKzt(k.idleCostKzt) },
        { label: 'Простой фабрики без руды', value: `${k.crusherIdleMin.toFixed(1)} мин`, note: fmtKzt(k.crusherIdleCostKzt), tone: k.crusherIdleMin > 0 ? 'bad' : 'good' },
        { label: 'Стоянка из-за взрывов', value: `${k.blastStopH.toFixed(1)} экскаваторо-ч` },
      ],
    },
    {
      title: 'Надёжность и ремонты',
      rows: [
        { label: 'Аварийные отказы самосвалов', value: String(k.unplannedFailures), note: `${k.brokenH.toFixed(1)} ч в ремонте`, tone: k.unplannedFailures > 0 ? 'bad' : 'good' },
        { label: 'Отказов предотвращено прогнозом', value: String(k.preventedFailures), note: `ППР ${k.serviceH.toFixed(1)} ч`, tone: k.preventedFailures > 0 ? 'good' : undefined },
        { label: 'Ложных тревог прогноза', value: String(k.falseAlarms) },
        { label: 'Заявок закрыто в РМЦ', value: String(smart.repairShop.plannedDone + smart.repairShop.breakdownDone), note: `шин на складе ${smart.repairShop.tyres}` },
        { label: 'Стоимость ремонтов', value: fmtKzt(k.repairCostKzt) },
      ],
    },
    {
      title: 'Ресурсы и себестоимость',
      rows: [
        { label: 'Дизельное топливо', value: `${fmtInt(k.fuelL)} л`, note: `${k.fuelLPerT.toFixed(3)} л/т · остаток на складе ${fmtInt(smart.fuelDepot.stockM3)} м³` },
        { label: 'Электроэнергия (сегмент)', value: `${fmtInt(smart.energy.segmentKwh)} кВт·ч`, note: `${smart.energy.perTonneOre(smart).toFixed(1)} кВт·ч/т руды` },
        { label: 'Вода: добавочная фабрике', value: `${fmtInt(smart.water.toPlantM3)} м³`, note: `оборотная ${fmtInt(smart.tailings.reclaimM3)} м³` },
        { label: 'Взрывчатка выдана', value: t1(smart.magazine.issuedT), note: `взрывов ${smart.magazine.blasts} · ${CHARGE_PER_HOLE_T} т на скважину` },
        { label: 'Себестоимость меди (C1)', value: `$${cost.usdPerLb.toFixed(2)} за фунт`, note: `${fmtKzt(cost.totalKzt)} за смену` },
      ],
    },
    {
      title: 'Условия смены',
      rows: [
        { label: 'Погода', value: w.ru, note: `${w.tempC.toFixed(0)} °C, ветер ${w.windMs.toFixed(0)} м/с · ${w.observed ? `факт, наблюдение ${w.observed.at} UTC` : 'климатические нормы'}` },
        { label: 'Скорость возки от нормы', value: `${Math.round(w.speedFactor * 100)} %`, note: w.blastOk ? 'взрывные работы разрешены' : 'взрывные работы запрещены' },
        { label: 'Людей в посёлке / на смене', value: `${fmtInt(smart.camp.inCamp)} / ${fmtInt(smart.camp.onShift)}` },
        { label: 'Принято грузовиков на КПП', value: String(Math.round(smart.checkpoint.cargoVehicles)), note: `груза ${fmtInt(smart.checkpoint.cargoT)} т` },
        { label: 'Запас до гребня дамбы', value: `${smart.tailings.freeboardM.toFixed(1)} м`, tone: smart.tailings.freeboardM < 3 ? 'warn' : undefined },
      ],
    },
  ];

  const incidents = chains
    .filter((c) => c.impact.kzt > 0 || c.severity === 'good')
    .sort((a, b) => b.impact.kzt - a.impact.kzt)
    .slice(0, 8)
    .map((c) => ({
      title: `${fmtClock(c.t0 * 60)} ${c.title}`,
      detail: c.steps[c.steps.length - 1]?.text ?? '',
      kzt: c.severity === 'good' ? -c.impact.kzt : c.impact.kzt,
    }));

  const forecast = forecastShift(smart, k);
  const donePct = (smart.now / smart.cfg.shift.durationSec) * 100;
  return {
    nowSec: smart.now,
    donePct,
    subtitle: `смена ${fmtClock(smart.now)} из ${shiftH.toFixed(0)}:00 · seed ${smart.seed} · ${smart.trucks.length} самосвалов, ${smart.excavators.length} экскаваторов`,
    sections,
    incidents,
    forecast,
    effectReady,
    effectShiftKzt: effect?.perShiftKzt ?? 0,
    effectYearKzt: effect?.perYearKzt ?? 0,
  };
}

const tr = (s: string) => translate(s) ?? s;
const csvNum = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',');

/** CSV сводки: разделитель «;» и BOM — Excel в русской локали открывает без мастера импорта. */
export function reportCsv(r: ShiftReport): string {
  const lines: string[][] = [
    [tr('Сводка смены'), tr('Цифровой двойник карьера Актогай')],
    [tr(r.subtitle)],
    [],
    [tr('Раздел'), tr('Показатель'), tr('Значение'), tr('Примечание')],
    ...r.sections.flatMap((s) => s.rows.map((row) => [tr(s.title), tr(row.label), tr(row.value), tr(row.note ?? '')])),
    [],
    r.forecast.ready
      ? [tr('Прогноз до конца смены'), tr('Сейчас'), tr('К концу смены'), tr('План или предел'), tr('На чём основан')]
      : [tr('Прогноз до конца смены'), tr('рано: темп ещё не устоялся')],
    ...(r.forecast.ready ? r.forecast.rows.map((f) => [tr(f.label), tr(f.now), tr(f.end) + (f.spread ? ' ' + tr(f.spread) : ''), tr(f.target ?? ''), tr(f.basis)]) : []),
    [],
    [tr('Происшествия смены'), tr('Подробности'), tr('Ущерб, ₸')],
    ...r.incidents.map((i) => [tr(i.title), tr(i.detail), csvNum(i.kzt)]),
    [],
    r.effectReady
      ? [tr('Эффект системы за смену, ₸'), csvNum(r.effectShiftKzt)]
      : [tr('Эффект системы'), tr('Накапливаем статистику — оценка появится после первого часа смены…')],
    ...(r.effectReady ? [[tr('Эффект системы в год, ₸'), csvNum(r.effectYearKzt)]] : []),
  ];
  const esc = (c: string) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return '﻿' + lines.map((l) => l.map(esc).join(';')).join('\r\n');
}

export function downloadCsv(r: ShiftReport): void {
  const blob = new Blob([reportCsv(r)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `aktogay-shift-${fmtClock(r.nowSec).replace(':', '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Сводка для печати: окно печати браузера, в нём «Сохранить как PDF». */
export function printReport(r: ShiftReport): void {
  const sec = r.sections
    .map(
      (s) =>
        `<section><h2>${tr(s.title)}</h2><table>${s.rows
          .map((row) => `<tr><td class="l">${tr(row.label)}</td><td class="v ${row.tone ?? ''}">${tr(row.value)}</td><td class="n">${tr(row.note ?? '')}</td></tr>`)
          .join('')}</table></section>`,
    )
    .join('');
  const fc = r.forecast.ready
    ? `<table><tr><th class="l">${tr('Показатель')}</th><th class="l">${tr('Сейчас')}</th><th class="l">${tr('К концу смены')}</th><th class="l">${tr('План или предел')}</th></tr>${r.forecast.rows
        .map(
          (f) =>
            `<tr><td class="l">${tr(f.label)}</td><td class="l">${tr(f.now)}</td><td class="l ${f.status === 'ok' ? 'good' : f.status === 'miss' ? 'bad' : f.status === 'risk' ? 'warn' : ''}">${tr(f.end)}${
              f.spread ? ` <span style="color:#777">${tr(f.spread)}</span>` : ''
            }</td><td class="n">${tr(f.target ?? '')}</td></tr>`,
        )
        .join('')}</table><p class="note">${tr('Прогноз: темп последнего часа продолжен до конца смены. Взрыв, поломка или непогода его изменят.')}</p>`
    : `<p class="note">${tr('Рано: темп ещё не устоялся — прогноз появится через полчаса смены.')}</p>`;
  const inc = r.incidents.length
    ? `<table>${r.incidents.map((i) => `<tr><td class="l">${tr(i.title)}</td><td class="n">${tr(i.detail)}</td><td class="v ${i.kzt < 0 ? 'good' : 'bad'}">${fmtKzt(Math.abs(i.kzt))}</td></tr>`).join('')}</table>`
    : `<p class="note">${tr('Происшествий нет.')}</p>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${tr('Сводка смены')}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: Inter, 'DejaVu Sans', Arial, sans-serif; color: #111; }
  h1 { font-size: 20px; margin: 0 0 2px; } .sub { color: #555; font-size: 12px; margin-bottom: 12px; }
  .cols { column-count: 2; column-gap: 14mm; }
  section { break-inside: avoid; margin-bottom: 10px; }
  h2 { font-size: 13px; margin: 0 0 4px; padding-bottom: 3px; border-bottom: 1px solid #ccc; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  td { padding: 2.5px 0; vertical-align: top; } td.l { color: #333; } td.v { text-align: right; font-weight: 700; white-space: nowrap; padding-left: 8px; }
  td.n { color: #777; font-size: 10px; padding-left: 8px; text-align: right; }
  .good { color: #15803d; } .bad { color: #b91c1c; } .warn { color: #b45309; }
  .total { margin-top: 10px; padding: 8px 10px; border: 1px solid #d4a017; border-radius: 6px; font-size: 13px; }
  .total b { font-size: 17px; } .note { color: #666; font-size: 11px; }
</style></head><body>
<h1>${tr('Сводка смены')}</h1>
<div class="sub">${tr('Цифровой двойник карьера Актогай')} · ${tr(r.subtitle)}</div>
<div class="cols">${sec}</div>
<h2 style="margin-top:8px">${tr('Прогноз до конца смены')}</h2>${fc}
<h2 style="margin-top:8px">${tr('Происшествия смены')}</h2>${inc}
<div class="total">${tr('Эффект системы диспетчеризации')}: ${
    r.effectReady ? `<b>${fmtKzt(r.effectShiftKzt)}</b> ${tr('за смену')} · ${tr('в год')} ${fmtKzt(r.effectYearKzt)}` : tr('Накапливаем статистику — оценка появится после первого часа смены…')
  }</div>
<p class="note">${tr('Модель построена по открытым данным. Операционные данные смоделированы. Проект не связан с KAZ Minerals.')}</p>
</body></html>`;
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const doc = frame.contentWindow!.document;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    setTimeout(() => frame.remove(), 1000);
  }, 300);
}
