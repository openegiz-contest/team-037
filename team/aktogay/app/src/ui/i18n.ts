/**
 * Три языка интерфейса: русский (исходный), казахский и английский.
 *
 * Интерфейс написан по-русски, поэтому перевод делается поверх готовой страницы: наблюдатель DOM
 * подменяет русский текст узлов и подсказок (title, placeholder, aria-label) по словарю. Числа в
 * фразе заменяются меткой {n}, поэтому одна запись словаря покрывает «Очередь: 3» и «Очередь: 12».
 * Так переводятся и живые панели 3D, и схемы «что внутри», без правки каждого компонента. Фраза,
 * которой нет в словаре, остаётся по-русски. Обратно на русский — по запомненным исходным строкам.
 *
 * Словари `src/i18n/{kk,en}.json` собраны со всех экранов работающего стенда.
 */
import en from '../i18n/en.json';
import kk from '../i18n/kk.json';

export type Lang = 'ru' | 'kk' | 'en';
export const LANGS: { id: Lang; label: string; title: string }[] = [
  { id: 'ru', label: 'РУ', title: 'Русский' },
  { id: 'kk', label: 'ҚАЗ', title: 'Қазақша' },
  { id: 'en', label: 'EN', title: 'English' },
];

const KEY = 'aktogay-lang';
const DICTS: Record<Exclude<Lang, 'ru'>, Record<string, string>> = { en, kk };
const NUM = /\d+(?:[\s  ]\d{3})*(?:[.,]\d+)?/g;
const CYR = /[А-Яа-яЁё]/;
const ATTRS = ['title', 'placeholder', 'aria-label'] as const;

let lang: Lang = 'ru';
let dict: Record<string, string> = {};
const listeners = new Set<(l: Lang) => void>();
/** Исходный и переведённый текст узла: чтобы не переводить свой же перевод и уметь вернуть русский. */
const texts = new WeakMap<Text, { src: string; out: string }>();
const attrs = new WeakMap<Element, Map<string, { src: string; out: string }>>();
const touched = new Set<WeakRef<Text | Element>>();

export function loadLang(): Lang {
  const q = new URLSearchParams(window.location.search).get('lang');
  if (q === 'ru' || q === 'kk' || q === 'en') return q;
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'ru' || v === 'kk' || v === 'en') return v;
  } catch {
    /* хранилище недоступно — язык по умолчанию */
  }
  return 'ru';
}

export const currentLang = (): Lang => lang;

export function onLangChange(fn: (l: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Перевод фразы по словарю текущего языка; null — перевода нет. */
export function translate(s: string): string | null {
  if (lang === 'ru' || !CYR.test(s)) return null;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s)!;
  const core = m[2].replace(/\s+/g, ' ');
  const nums: string[] = [];
  const key = core.replace(NUM, (x) => {
    nums.push(x);
    return '{n}';
  });
  const t = dict[key];
  if (t !== undefined) {
    let i = 0;
    return m[1] + t.replace(/\{n\}/g, () => nums[i++] ?? '') + m[3];
  }
  const p = byPattern(core);
  return p === null ? null : m[1] + p + m[3];
}

/**
 * Фразы с именами внутри (события журнала: «Водитель Асхат К. (№102): …»): в словаре они записаны
 * с меткой {s}, а вставка переводится отдельно — имя, номер машины, название экскаватора.
 */
type Pattern = { re: RegExp; slots: ('n' | 's')[]; out: string };
const patternCache = new Map<Record<string, string>, Pattern[]>();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function patterns(): Pattern[] {
  let list = patternCache.get(dict);
  if (!list) {
    list = Object.entries(dict)
      .filter(([k]) => k.includes('{s}'))
      // Сначала самые подробные шаблоны: короткий вроде «{s}, {s}» не должен перехватить фразу журнала.
      .sort(([a], [b]) => b.replace(/\{[ns]\}/g, '').length - a.replace(/\{[ns]\}/g, '').length)
      .map(([k, out]) => {
        const slots: ('n' | 's')[] = [];
        const src = k
          .split(/(\{n\}|\{s\})/)
          .map((part) => {
            if (part === '{n}') {
              slots.push('n');
              return `(${NUM.source})`;
            }
            if (part === '{s}') {
              slots.push('s');
              return '(.+?)';
            }
            return esc(part);
          })
          .join('');
        return { re: new RegExp(`^${src}$`), slots, out };
      });
    patternCache.set(dict, list);
  }
  return list;
}

function byPattern(core: string): string | null {
  for (const p of patterns()) {
    const m = p.re.exec(core);
    if (!m) continue;
    const nums: string[] = [];
    const strs: string[] = [];
    p.slots.forEach((kind, i) => (kind === 'n' ? nums.push(m[i + 1]) : strs.push(translate(m[i + 1]) ?? m[i + 1])));
    let a = 0;
    let b = 0;
    return p.out.replace(/\{n\}|\{s\}/g, (tok) => (tok === '{n}' ? (nums[a++] ?? '') : (strs[b++] ?? '')));
  }
  return null;
}

const skip = (el: Element | null): boolean => !!el?.closest('script,style,textarea,[translate="no"]');

function doText(n: Text): void {
  const v = n.nodeValue ?? '';
  const rec = texts.get(n);
  if (rec && v === rec.out) return;
  if (skip(n.parentElement)) return;
  const t = translate(v);
  if (t !== null && t !== v) {
    texts.set(n, { src: v, out: t });
    touched.add(new WeakRef(n));
    n.nodeValue = t;
  } else texts.delete(n);
}

function doAttrs(el: Element): void {
  if (skip(el)) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v === null) continue;
    let map = attrs.get(el);
    const rec = map?.get(a);
    if (rec && v === rec.out) continue;
    const t = translate(v);
    if (t !== null && t !== v) {
      if (!map) {
        map = new Map();
        attrs.set(el, map);
        touched.add(new WeakRef(el));
      }
      map.set(a, { src: v, out: t });
      el.setAttribute(a, t);
    } else map?.delete(a);
  }
}

function walk(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) return doText(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  doAttrs(el);
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n: Node | null;
  while ((n = w.nextNode())) {
    if (n.nodeType === Node.TEXT_NODE) doText(n as Text);
    else doAttrs(n as Element);
  }
}

/** Вернуть русский текст везде, где был перевод. */
function restore(): void {
  for (const ref of touched) {
    const n = ref.deref();
    if (!n) continue;
    if (n instanceof Text) {
      const rec = texts.get(n);
      if (rec && n.nodeValue === rec.out) n.nodeValue = rec.src;
      texts.delete(n);
    } else {
      const map = attrs.get(n);
      map?.forEach((rec, a) => {
        if (n.getAttribute(a) === rec.out) n.setAttribute(a, rec.src);
      });
      attrs.delete(n);
    }
  }
  touched.clear();
}

let observer: MutationObserver | null = null;

export function setLang(l: Lang): void {
  if (l === lang && observer) return;
  restore();
  lang = l;
  dict = l === 'ru' ? {} : DICTS[l];
  document.documentElement.lang = l === 'kk' ? 'kk' : l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* не сохранилось — не страшно */
  }
  if (!observer) {
    observer = new MutationObserver((list) => {
      if (lang === 'ru') return;
      for (const m of list) {
        if (m.type === 'characterData') doText(m.target as Text);
        else if (m.type === 'attributes') doAttrs(m.target as Element);
        else m.addedNodes.forEach(walk);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  }
  if (l !== 'ru') walk(document.body);
  listeners.forEach((fn) => fn(l));
}
