import { describe, expect, it } from 'vitest';
import en from '../../i18n/en.json';
import kk from '../../i18n/kk.json';

describe('словари интерфейса', () => {
  it('в каждом переводе столько же меток {n} и {s}, сколько в исходной фразе', () => {
    for (const d of [en, kk] as Record<string, string>[]) {
      for (const [k, v] of Object.entries(d)) {
        expect([v.split('{n}').length, v.split('{s}').length], k).toEqual([k.split('{n}').length, k.split('{s}').length]);
      }
    }
  });

  it('английский и казахский словари покрывают одни и те же фразы', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(kk).sort());
  });
});
