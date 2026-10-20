/**
 * Себестоимость тонны меди (C1 cash cost) по статьям. Показывает оба варианта рядом: реальную
 * работу с системой и расчёт без неё. У каждой строки видно, посчитана она моделью или принята
 * оценкой, — чтобы не выдавать допущения за расчёт.
 */
import { useState } from 'react';
import { costBreakdown, GROUP_RU, type CostGroup, type Kpis, type Simulation } from '../sim';

const GROUPS: CostGroup[] = ['mining', 'processing', 'oxide', 'logistics', 'overhead'];

const mln = (kzt: number) => `${(kzt / 1e6).toFixed(1)} млн ₸`;

export function CostPanel({ sims, labels, kpis }: { sims: Simulation[]; labels: string[]; kpis?: Kpis[] }) {
  const [open, setOpen] = useState(false);
  // KPI берём те же, что показаны выше: на стенде они приходят из Ditto.
  const reports = sims.map((s, i) => costBreakdown(s, kpis?.[i]));
  const main = reports[reports.length - 1]; // реальная работа — последний вариант
  const base = reports.length > 1 ? reports[0] : null;
  if (main.payableCuT <= 0) return null;
  const delta = base ? main.usdPerLb - base.usdPerLb : 0;
  const share = Math.round((main.modelledKzt / main.totalKzt) * 100);

  return (
    <section className="panel shrink-0 p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-semibold">Себестоимость тонны меди</h2>
        <span className="text-[12px] text-ink-3">
          C1 cash cost: прямые затраты смены на оплачиваемую медь. Без амортизации, процентов и налогов
          {main.payableCuT < 5 && <b className="ml-1 text-amber-300">· цифра стабилизируется после первого часа смены</b>}
        </span>
        <button onClick={() => setOpen((v) => !v)} className="ml-auto rounded bg-panel-2 px-2 py-1 text-[12px] font-semibold text-ink-2 hover:text-ink">
          {open ? '− Свернуть статьи' : '+ Показать статьи'}
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {reports.map((r, i) => (
          <div key={i} className={`rounded-lg border p-3 ${i === reports.length - 1 ? 'border-amber-500/50 bg-amber-500/5' : 'border-line bg-panel-2'}`}>
            <div className="text-[11px] uppercase tracking-wider text-ink-3">{labels[i]}</div>
            <div className="num mt-1 text-[26px] font-extrabold text-amber-300">${r.usdPerLb.toFixed(2)}</div>
            <div className="text-[12px] text-ink-3">за фунт меди</div>
            <div className="num mt-1 text-[13px] text-ink-2">{(r.kztPerTCu / 1e6).toFixed(2)} млн ₸ за тонну</div>
          </div>
        ))}
        {base && (
          <div className="rounded-lg border border-line bg-panel-2 p-3">
            <div className="text-[11px] uppercase tracking-wider text-ink-3">Разница</div>
            <div className={`num mt-1 text-[26px] font-extrabold ${delta <= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {delta <= 0 ? '−' : '+'}${Math.abs(delta).toFixed(3)}
            </div>
            <div className="text-[12px] text-ink-3">на фунт за счёт системы</div>
            <div className="num mt-1 text-[13px] text-ink-2">{mln(main.totalKzt - base.totalKzt)} затрат за смену</div>
          </div>
        )}
        <div className="rounded-lg border border-line bg-panel-2 p-3">
          <div className="text-[11px] uppercase tracking-wider text-ink-3">Оплачиваемая медь</div>
          <div className="num mt-1 text-[26px] font-extrabold">{main.payableCuT.toFixed(1)}</div>
          <div className="text-[12px] text-ink-3">т за смену</div>
          <div className="num mt-1 text-[13px] text-ink-2">
            катоды {main.cathodeT.toFixed(1)} · концентрат {main.concCuT.toFixed(1)}
          </div>
        </div>
      </div>

      <div className="mt-2 text-[11.5px] text-ink-3">
        Моделью посчитано {share}% затрат (топливо по рейсам, электроэнергия по участкам, ремонты, простои, кислота), остальное — ставки-оценки
        по открытым данным. Катодная медь продаётся как металл, за медь в концентрате плавильный завод берёт плату и оплачивает{' '}
        {sims[0].cfg.economics.payableCuPct}% металла.
      </div>

      {open && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="text-ink-3">
              <tr>
                <th className="py-1 text-left font-medium">Статья</th>
                {labels.map((l) => (
                  <th key={l} className="py-1 text-right font-medium">
                    {l}
                  </th>
                ))}
                <th className="py-1 pl-3 text-left font-medium">Откуда</th>
              </tr>
            </thead>
            <tbody>
              {GROUPS.map((g) => {
                const ids = main.lines.filter((l) => l.group === g);
                if (!ids.length) return null;
                return [
                  <tr key={g} className="border-t border-line">
                    <td colSpan={labels.length + 2} className="pt-2 text-[11px] uppercase tracking-wider text-ink-3">
                      {GROUP_RU[g]} · {mln(ids.reduce((s, l) => s + l.kzt, 0))}
                    </td>
                  </tr>,
                  ...ids.map((l) => (
                    <tr key={l.id} className="hover:bg-panel-2">
                      <td className="py-0.5">
                        {l.name}{' '}
                        <span className={`ml-1 rounded px-1 text-[10px] ${l.modelled ? 'bg-green-500/15 text-green-400' : 'bg-amber-500/15 text-amber-300'}`}>
                          {l.modelled ? 'посчитано' : 'оценка'}
                        </span>
                      </td>
                      {reports.map((r, i) => (
                        <td key={i} className="num py-0.5 text-right">
                          {(r.lines.find((x) => x.id === l.id)!.kzt / 1e6).toFixed(1)} млн
                        </td>
                      ))}
                      <td className="py-0.5 pl-3 text-ink-3">{l.basis}</td>
                    </tr>
                  )),
                ];
              })}
              <tr className="border-t border-line font-semibold">
                <td className="py-1">Всего за смену</td>
                {reports.map((r, i) => (
                  <td key={i} className="num py-1 text-right">
                    {mln(r.totalKzt)}
                  </td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
