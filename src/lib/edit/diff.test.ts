import { expect, it } from 'vitest';
import { lineDiff, whitespaceOnly } from './diff';

it('diffs by line', () => {
  expect(lineDiff('a\nb', 'a\nc')).toEqual([
    { kind: '=', text: 'a', line: 1 },
    { kind: '-', text: 'b', line: 2 },
    { kind: '+', text: 'c', line: 2 },
  ]);
  expect(lineDiff('x', 'x\ny').map((d) => d.kind)).toEqual(['=', '+']);
});

it('detects whitespace-only changes', () => {
  expect(whitespaceOnly('a {x}', 'a{ x }')).toBe(true);
  expect(whitespaceOnly('a', 'a')).toBe(false);
  expect(whitespaceOnly('a{x}', 'a{y}')).toBe(false);
});

it('keeps line numbers around a change in the middle', () => {
  expect(lineDiff('a\nb\nc\nd', 'a\nB\nc\nd')).toEqual([
    { kind: '=', text: 'a', line: 1 },
    { kind: '-', text: 'b', line: 2 },
    { kind: '+', text: 'B', line: 2 },
    { kind: '=', text: 'c', line: 3 },
    { kind: '=', text: 'd', line: 4 },
  ]);
  expect(lineDiff('a\nb', 'a\nb')).toEqual([
    { kind: '=', text: 'a', line: 1 },
    { kind: '=', text: 'b', line: 2 },
  ]);
  expect(lineDiff('', 'x').map((d) => d.kind)).toEqual(['-', '+']);
});

it('diffs a one-line edit in a 20k-line element without the n*m table', () => {
  const lines = Array.from({ length: 20_000 }, (_, i) => `<p>${i}</p>`);
  const after = [...lines];
  after[10_000] = '<p>edited</p>';
  const d = lineDiff(lines.join('\n'), after.join('\n'));
  expect(d.filter((x) => x.kind !== '=')).toEqual([
    { kind: '-', text: '<p>10000</p>', line: 10_001 },
    { kind: '+', text: '<p>edited</p>', line: 10_001 },
  ]);
  expect(d).toHaveLength(20_001);
});
