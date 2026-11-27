import { expect, it } from 'vitest';
import { groupOffenders, nearestOnScale, onScale, px } from './spacing';

it('reads px values only', () => {
  expect(px('12px')).toBe(12);
  expect(px('-4.5px')).toBe(-4.5);
  expect(px('auto')).toBeNull();
  expect(px('50%')).toBeNull();
  expect(px('normal')).toBeNull();
});

it('finds the nearest value on a base grid or a token list', () => {
  expect(nearestOnScale(5.1, { base: 4 })).toBe(4);
  expect(nearestOnScale(13.5, { base: 4 })).toBe(12);
  expect(nearestOnScale(14.5, { base: 4 })).toBe(16);
  expect(nearestOnScale(-9, { base: 4 })).toBe(8);
  expect(nearestOnScale(9, { values: [4, 8, 12, 16] })).toBe(8);
});

it('allows a small tolerance', () => {
  expect(onScale(8, { base: 4 }, 0.05)).toBe(true);
  expect(onScale(8.04, { base: 4 }, 0.05)).toBe(true);
  expect(onScale(8.5, { base: 4 }, 0.05)).toBe(false);
  expect(onScale(12, { values: [4, 8] }, 0.05)).toBe(false);
});

it('groups off-scale readings by value, most frequent first', () => {
  const r = [
    { value: 8, property: 'margin-top' },
    { value: 10.2, property: 'padding-left' },
    { value: 5.1, property: 'padding-top' },
    { value: 10.2, property: 'margin-left' },
    { value: 10.2, property: 'padding-left' },
  ];
  expect(groupOffenders(r, { base: 4 }, 0.05)).toEqual([
    { value: 10.2, count: 3, nearest: 12, properties: ['padding-left', 'margin-left'] },
    { value: 5.1, count: 1, nearest: 4, properties: ['padding-top'] },
  ]);
});
