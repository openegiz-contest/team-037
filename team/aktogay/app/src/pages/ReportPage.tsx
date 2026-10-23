/**
 * Раздел «Сводка смены»: то, что начальник смены сдаёт в конце — добыча и план, переработка и медь,
 * простои, надёжность, ресурсы и себестоимость, условия смены, происшествия и эффект системы.
 * Цифры берутся из тех же данных, что показаны на остальных экранах (на стенде — из двойников).
 * Отсюда сводка печатается в PDF или выгружается в CSV.
 */
import { PageHeader } from '../components/PageHeader';
import type { Kpis, Simulation } from '../sim';
import { fmtKzt } from '../ui/format';
import { buildShiftReport, downloadCsv, printReport, type ReportRow } from '../ui/shiftReport';

interface Props {
  sims: Simulation[];
  /** KPI в том же порядке, что sims (на стенде — из двойников). */
  kpis: Kpis[];
  now: number;
  running: boolean;
  onToggleRun: () => void;
}

const TONE: Record<NonNullable<ReportRow['tone']>, string> = { good: 'text-emerald-300', bad: 'text-red-300', warn: 'text-amber-300' };

export function ReportPage({ sims, kpis, now, running, onToggleRun }: Props) {
  const smart = sims.find((s) => s.strategyName === 'smart') ?? sims[sims.length - 1];
  const fixed = sims.find((s) => s.strategyName === 'fixed');
  if (!smart) return null;
  const kpiOf = (s: Simulation | undefined) => (s ? kpis[sims.indexOf(s)] : undefined);
  const smartK = kpiOf(smart);
  const r = buildShiftReport(smart, fixed, smartK ? { smart: smartK, fixed: kpiOf(fixed) } : undefined);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-5">
      <PageHeader
        title="Сводка смены"
        subtitle={<>Итоги смены одной страницей: добыча и план, переработка, простои, надёжность, ресурсы, происшествия и эффект системы. Печатается как отчёт.</>}
        now={now}
        running={running}
        onToggleRun={onToggleRun}
      >
        <button onClick={() => downloadCsv(r)} className="rounded-lg bg-panel px-3 py-2 text-[13px] font-semibold text-ink-2 ring-1 ring-line hover:text-ink" title="Сводка таблицей для Excel">
          ⇩ CSV
        </button>
        <button
          onClick={() => printReport(r)}
          className="rounded-lg bg-amber-500 px-3 py-2 text-[13px] font-bold text-black hover:brightness-110"
          title="Отчёт для печати — в окне печати выберите «Сохранить как PDF»"
        >
          ⎙ Печать / PDF
        </button>
      </PageHeader>

      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {r.sections.map((s) => (
          <section key={s.title} className="panel">
            <div className="border-b border-line px-4 py-2.5">
              <h3 className="text-[14px] font-semibold">{s.title}</h3>
            </div>
            <div className="px-4 py-2">
              {s.rows.map((row) => (
                <div key={row.label} className="flex items-baseline gap-3 border-b border-line/40 py-1.5 last:border-0">
                  <span className="min-w-0 flex-1 text-[13px] text-ink-2">{row.label}</span>
                  <span className={`num shrink-0 text-[14px] font-bold ${row.tone ? TONE[row.tone] : ''}`}>{row.value}</span>
                  {row.note && <span className="num shrink-0 text-right text-[11.5px] text-ink-3">{row.note}</span>}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="panel">
          <div className="flex items-center border-b border-line px-4 py-2.5">
            <h3 className="text-[14px] font-semibold">Происшествия смены</h3>
            <span className="ml-auto text-[12px] text-ink-3">что случилось и чего это стоило</span>
          </div>
          <div className="px-4 py-2">
            {r.incidents.length === 0 && <div className="py-3 text-[13px] text-ink-3">Происшествий нет.</div>}
            {r.incidents.map((i) => (
              <div key={i.title} className="flex items-baseline gap-3 border-b border-line/40 py-1.5 last:border-0">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-ink">{i.title}</span>
                  <span className="block text-[11.5px] text-ink-3">{i.detail}</span>
                </span>
                <span className={`num shrink-0 text-[13.5px] font-bold ${i.kzt < 0 ? 'text-emerald-300' : 'text-red-300'}`}>{fmtKzt(Math.abs(i.kzt))}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel flex flex-col justify-center p-5" style={{ borderColor: 'rgba(245,158,11,.5)' }}>
          <div className="text-[11px] uppercase tracking-wider text-amber-300">Эффект системы диспетчеризации</div>
          {r.effectReady ? (
            <>
              <div className="num mt-2 text-[34px] font-extrabold leading-none text-amber-200">{fmtKzt(r.effectShiftKzt)}</div>
              <div className="mt-1 text-[12.5px] text-ink-3">за смену · в год {fmtKzt(r.effectYearKzt)}</div>
            </>
          ) : (
            <div className="mt-2 text-[14px] text-ink-2">Накапливаем статистику — оценка появится после первого часа смены…</div>
          )}
          <div className="mt-3 text-[11.5px] leading-snug text-ink-3">
            Считается как разница с теневым расчётом той же смены без системы — раздел{' '}
            <a href="#/effect" className="font-semibold text-amber-300 hover:underline">
              «Эффект»
            </a>
            . Ставки — оценки по открытым данным.
          </div>
        </section>
      </div>
    </div>
  );
}
