/**
 * Поиск оборудования на 3D-сцене: номер самосвала, имя водителя, экскаватор, буровой станок, здание.
 * Выбор — камера подлетает к объекту (самосвал ещё и выделяется, камера следует за ним).
 */
import { useMemo, useState } from 'react';
import type { Simulation } from '../sim';
import type { FocusTarget } from '../render3d/MineScene';

interface Item {
  key: string;
  title: string;
  sub: string;
  hay: string;
  target: FocusTarget;
}

const BUILDINGS: { id: Extract<FocusTarget, { kind: 'building' }>['id']; title: string; words: string }[] = [
  { id: 'crusher', title: 'Дробилка ККД', words: 'дробилка ккд бункер crusher' },
  { id: 'stockpile', title: 'Склад дроблёной руды', words: 'склад штабель конус stockpile' },
  { id: 'plant', title: 'Обогатительная фабрика', words: 'фабрика оф обогатительная мельница plant' },
  { id: 'leach', title: 'Кучное выщелачивание', words: 'выщелачивание оксид кучное leach' },
  { id: 'sxew', title: 'Завод SX-EW и пруды', words: 'sxew sx ew завод катод катодная медь электролиз экстракция пруды раствор pls рафинат' },
  { id: 'conc', title: 'Склад концентрата и ж/д', words: 'концентрат склад вагоны состав погрузка железная дорога отгрузка' },
  { id: 'tsf', title: 'Хвостохранилище', words: 'хвостохранилище хвосты дамба пруд оборотная вода пульпа tailings' },
  { id: 'waste', title: 'Отвал вскрыши', words: 'отвал вскрыша waste' },
  { id: 'garage', title: 'Гараж, АЗС и стоянка', words: 'гараж азс стоянка ремонт заправка garage' },
];

const MATERIAL_RU = { sulfide: 'сульфид', oxide: 'оксид', waste: 'вскрыша' } as const;

export function EquipmentSearch({ sim, onPick }: { sim: Simulation; onPick: (t: FocusTarget) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);

  const items = useMemo<Item[]>(
    () => [
      ...sim.trucks.map((t) => ({
        key: `t${t.id}`,
        title: `Самосвал ${t.name}`,
        sub: t.driver.name,
        hay: `самосвал ${t.name} ${t.name.replace('№', '')} truck-${t.name.replace('№', '')} ${t.driver.name}`.toLowerCase(),
        target: { kind: 'truck' as const, id: t.id },
      })),
      ...sim.excavators.map((e) => ({
        key: `e${e.id}`,
        title: `Экскаватор ${e.name}`,
        sub: MATERIAL_RU[e.material],
        hay: `экскаватор ${e.name} ${e.name.replace('-', '')} э${e.id + 1} ${MATERIAL_RU[e.material]}`.toLowerCase(),
        target: { kind: 'excavator' as const, id: e.id },
      })),
      ...sim.drill.rigs.map((r) => ({
        key: `d${r.id}`,
        title: `Буровой станок ${r.name}`,
        sub: r.operator.name,
        hay: `буровой станок бур ${r.name} ${r.name.replace('-', '')} ${r.operator.name}`.toLowerCase(),
        target: { kind: 'drill' as const, id: r.id },
      })),
      ...BUILDINGS.map((b) => ({ key: `b${b.id}`, title: b.title, sub: 'здание', hay: `${b.title} ${b.words}`.toLowerCase(), target: { kind: 'building' as const, id: b.id } })),
    ],
    [sim],
  );

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const found = words.length ? items.filter((it) => words.every((w) => it.hay.includes(w))).slice(0, 8) : [];

  const choose = (it: Item) => {
    onPick(it.target);
    setQ(it.title);
    setOpen(false);
  };

  return (
    <div className="absolute right-3 top-3 z-20 w-[260px] max-w-[55%]" onPointerDown={(e) => e.stopPropagation()}>
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setHi((h) => Math.min(found.length - 1, h + 1));
          else if (e.key === 'ArrowUp') setHi((h) => Math.max(0, h - 1));
          else if (e.key === 'Enter' && found[hi]) choose(found[hi]);
          else if (e.key === 'Escape') {
            setQ('');
            setOpen(false);
          }
          e.stopPropagation();
        }}
        placeholder="Найти: 105, Э-2, БУ-1, дробилка…"
        className="w-full rounded-md border border-white/15 bg-black/60 px-3 py-1.5 text-[13px] text-white outline-none backdrop-blur placeholder:text-white/45 focus:border-amber-500"
      />
      {open && found.length > 0 && (
        <div className="mt-1 overflow-hidden rounded-md border border-white/15 bg-black/80 backdrop-blur">
          {found.map((it, k) => (
            <button
              key={it.key}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(it)}
              onMouseEnter={() => setHi(k)}
              className={`flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-[13px] ${k === hi ? 'bg-amber-500/20 text-white' : 'text-white/80'}`}
            >
              <span className="truncate">{it.title}</span>
              <span className="shrink-0 text-[11.5px] text-white/50">{it.sub}</span>
            </button>
          ))}
        </div>
      )}
      {open && words.length > 0 && found.length === 0 && <div className="mt-1 rounded-md bg-black/80 px-3 py-1.5 text-[12.5px] text-white/60">Ничего не найдено</div>}
    </div>
  );
}
