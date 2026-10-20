import { describe, expect, it } from 'vitest';
import { clockRu, daylight, sunAngles } from '../../render3d/daylight';
import { SHIFT_START_HOUR } from '../weather';

describe('день и ночь', () => {
  it('солнце ходит как на широте Актогая: зимой низко, летом высоко', () => {
    const jan = sunAngles(1, 12).elevDeg;
    const jul = sunAngles(7, 12).elevDeg;
    // Полуденная высота = 90 − широта ± склонение (широта ~47°)
    expect(jan).toBeGreaterThan(15);
    expect(jan).toBeLessThan(26);
    expect(jul).toBeGreaterThan(60);
    expect(jul).toBeLessThan(70);
    expect(jul - jan).toBeGreaterThan(40);
  });

  it('зимой смена заканчивается в темноте, летом — при свете', () => {
    const end = SHIFT_START_HOUR + 12; // 20:00
    expect(daylight(1, end).dayK).toBe(0);
    expect(daylight(1, end).lampsK).toBe(1);
    expect(daylight(7, end).dayK).toBeGreaterThan(daylight(1, end).dayK);
  });

  it('днём лампы выключены, ночью включены, солнце светит ярче луны', () => {
    const noon = daylight(10, 12);
    const night = daylight(10, 23);
    expect(noon.lampsK).toBe(0);
    expect(noon.dayK).toBe(1);
    expect(night.lampsK).toBe(1);
    expect(noon.sunIntensity).toBeGreaterThan(night.sunIntensity * 5);
    expect(noon.sky.getHex()).not.toBe(night.sky.getHex());
  });

  it('часы подписываются местным временем смены', () => {
    expect(clockRu(SHIFT_START_HOUR)).toBe('08:00');
    expect(clockRu(SHIFT_START_HOUR + 9.5)).toBe('17:30');
  });
});
