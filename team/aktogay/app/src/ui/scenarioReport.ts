/**
 * Отчёт по сценарию «что если»: показатели с системой и без неё до запуска сценария и сейчас.
 * Выгружается таблицей CSV (открывается в Excel) или печатается в PDF из браузера. Подписи
 * переводятся на язык интерфейса тем же словарём, что и страница.
 */
import type { Kpis, Simulation } from '../sim';
import { fmtClock, fmtInt } from './format';
import { translate } from './i18n';

export interface ImpactRow {
  label: string;
  /** Без системы и с системой. */
  a: number;
  b: number;
  fmt: (v: number) => string;
  better: 'lower' | 'higher';
}

/** Показатели для сравнения: первая модель — без системы, вторая — с системой. */
export function impactRows(sims: Simulation[], kpis: Kpis[]): ImpactRow[] {
  const [f, s] = kpis;
  const [fs, ss] = sims;
  return [
    { label: 'Добыто, т', a: f.minedTotal, b: s.minedTotal, fmt: fmtInt, better: 'higher' },
    { label: 'Подано руды на фабрику, т', a: fs.stats.plantFeedT, b: ss.stats.plantFeedT, fmt: fmtInt, better: 'higher' },
    { label: 'Медь в концентрате, т', a: fs.stats.cuConcT, b: ss.stats.cuConcT, fmt: (v) => v.toFixed(1), better: 'higher' },
    { label: 'Простой фабрики, мин', a: f.crusherIdleMin, b: s.crusherIdleMin, fmt: (v) => v.toFixed(1), better: 'lower' },
    { label: 'Средняя очередь, мин', a: f.avgQueueMin, b: s.avgQueueMin, fmt: (v) => v.toFixed(2), better: 'lower' },
    { label: 'Руда на складе и в бункере, т', a: fs.oreBufferT, b: ss.oreBufferT, fmt: fmtInt, better: 'higher' },
    { label: 'Качество руды в норме, %', a: f.gradeInBandPct, b: s.gradeInBandPct, fmt: (v) => v.toFixed(1), better: 'higher' },
    { label: 'Аварийные отказы', a: f.unplannedFailures, b: s.unplannedFailures, fmt: (v) => String(v), better: 'lower' },
    { label: 'Топливо, л', a: fs.stats.fuelL, b: ss.stats.fuelL, fmt: fmtInt, better: 'lower' },
  ];
}

/** Снимок показателей в момент запуска сценария — «до». Хранится вне компонента, чтобы пережить переход между разделами. */
export interface Snapshot {
  t: number;
  title: string;
  values: { a: number; b: number }[];
}
let snapshot: Snapshot | null = null;
export const getSnapshot = () => snapshot;
export function takeSnapshot(t: number, title: string, rows: ImpactRow[]): void {
  snapshot = { t, title, values: rows.map((r) => ({ a: r.a, b: r.b })) };
}
export function clearSnapshot(): void {
  snapshot = null;
}

const tr = (s: string) => translate(s) ?? s;
const num = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 100) / 100).replace('.', ',') : '');

interface ReportInput {
  now: number;
  seed: number;
  rows: ImpactRow[];
  history: [number, string][];
}

/** CSV с разделителем «;» и BOM — так Excel в русской локали открывает его без мастера импорта. */
export function reportCsv({ now, seed, rows, history }: ReportInput): string {
  const snap = getSnapshot();
  const lines: string[][] = [
    [tr('Отчёт по сценарию «что если»'), tr('Цифровой двойник карьера Актогай')],
    [tr('Время смены'), fmtClock(now), 'seed', String(seed)],
    snap ? [tr('Снимок «до»'), fmtClock(snap.t), tr(snap.title)] : [tr('Снимок «до»'), tr('не сделан — сценарий ещё не запускали')],
    [],
    [
      tr('Показатель'),
      tr('До: без системы'),
      tr('До: с системой'),
      tr('Сейчас: без системы'),
      tr('Сейчас: с системой'),
      tr('Разница сейчас (с системой − без)'),
      tr('Без системы: изменение'),
      tr('С системой: изменение'),
    ],
    ...rows.map((r, i) => {
      const before = snap?.values[i];
      return [
        tr(r.label),
        before ? num(before.a) : '',
        before ? num(before.b) : '',
        num(r.a),
        num(r.b),
        num(r.b - r.a),
        before ? num(r.a - before.a) : '',
        before ? num(r.b - before.b) : '',
      ];
    }),
    [],
    [tr('История команд')],
    ...history.map(([t, text]) => [fmtClock(t), tr(text)]),
  ];
  const esc = (c: string) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return '﻿' + lines.map((l) => l.map(esc).join(';')).join('\r\n');
}

export function downloadCsv(input: ReportInput): void {
  const blob = new Blob([reportCsv(input)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `aktogay-scenario-${fmtClock(input.now).replace(':', '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Отчёт для печати: окно печати браузера, в нём «Сохранить как PDF». */
export function printReport(input: ReportInput): void {
  const snap = getSnapshot();
  const { now, seed, rows, history } = input;
  const cell = (v: string, cls = '') => `<td class="${cls}">${v}</td>`;
  const body = rows
    .map((r, i) => {
      const before = snap?.values[i];
      const diff = r.b - r.a;
      const good = Math.abs(diff) < 1e-9 ? '' : (r.better === 'higher' ? diff > 0 : diff < 0) ? 'good' : 'bad';
      return `<tr>${cell(tr(r.label), 'l')}${cell(before ? r.fmt(before.a) : '—')}${cell(before ? r.fmt(before.b) : '—')}${cell(r.fmt(r.a))}${cell(r.fmt(r.b))}${cell(Math.abs(diff) < 1e-9 ? '—' : `${diff > 0 ? '+' : '−'}${r.fmt(Math.abs(diff))}`, good)}</tr>`;
    })
    .join('');
  const hist = history.map(([t, text]) => `<li><b>${fmtClock(t)}</b> ${tr(text)}</li>`).join('') || `<li>${tr('Команд ещё не было.')}</li>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${tr('Отчёт по сценарию «что если»')}</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font-family: Inter, 'DejaVu Sans', Arial, sans-serif; color: #111; }
  h1 { font-size: 20px; margin: 0 0 4px; } .sub { color: #555; font-size: 12px; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; } th, td { padding: 6px 8px; border-bottom: 1px solid #ddd; text-align: right; }
  th { background: #f4f4f5; font-size: 11px; } td.l, th.l { text-align: left; } .good { color: #15803d; font-weight: 700; } .bad { color: #b91c1c; font-weight: 700; }
  h2 { font-size: 14px; margin: 18px 0 6px; } ul { font-size: 12px; padding-left: 18px; } .note { color: #666; font-size: 11px; margin-top: 16px; }
</style></head><body>
<h1>${tr('Отчёт по сценарию «что если»')}</h1>
<div class="sub">${tr('Цифровой двойник карьера Актогай')} · ${tr('Время смены')} ${fmtClock(now)} · seed ${seed}${snap ? ` · ${tr('Снимок «до»')} ${fmtClock(snap.t)}: ${tr(snap.title)}` : ''}</div>
<table><thead><tr><th class="l">${tr('Показатель')}</th><th>${tr('До: без системы')}</th><th>${tr('До: с системой')}</th><th>${tr('Сейчас: без системы')}</th><th>${tr('Сейчас: с системой')}</th><th>${tr('Разница')}</th></tr></thead><tbody>${body}</tbody></table>
<h2>${tr('История команд')}</h2><ul>${hist}</ul>
<div class="note">${tr('Модель построена по открытым данным. Операционные данные смоделированы. Проект не связан с KAZ Minerals.')}</div>
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
