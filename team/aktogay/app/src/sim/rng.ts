/** Детерминированный ГПСЧ (mulberry32) — одинаковый seed даёт одинаковую последовательность. */
export class Rng {
  private a: number;

  constructor(seed: number) {
    this.a = seed >>> 0;
  }

  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Число событий пуассоновского процесса с матожиданием mean. */
  poisson(mean: number): number {
    const l = Math.exp(-mean);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > l);
    return k - 1;
  }
}

/** Хэш нескольких целых → число в [0,1). Даёт «общий шум» для одинаковых событий в разных прогонах. */
export function hash01(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h ^= p | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
  }
  return new Rng(h).next();
}

/** Производный seed для отдельного потока случайных чисел. */
export function subSeed(seed: number, stream: number): number {
  return Math.floor(hash01(seed, stream, 7919) * 4294967296);
}
