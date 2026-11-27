import { describe, expect, it } from 'vitest';
import { diffPixels, outputSize, shotRegion, shrinkFor } from './shot';

describe('shotRegion', () => {
  it('grows the box by the padding', () => {
    expect(shotRegion({ x: 100, y: 100, width: 50, height: 40 }, 10, 800, 600)).toEqual({
      x: 90,
      y: 90,
      width: 70,
      height: 60,
      clipped: false,
    });
  });
  it('cuts at the screen edges and says so', () => {
    expect(shotRegion({ x: 5, y: 5, width: 50, height: 40 }, 10, 800, 600)).toEqual({
      x: 0,
      y: 0,
      width: 65,
      height: 55,
      clipped: true,
    });
    expect(shotRegion({ x: 780, y: 0, width: 100, height: 50 }, 0, 800, 600)).toMatchObject({
      width: 20,
      clipped: true,
    });
  });
  it('is null when nothing is on screen', () => {
    expect(shotRegion({ x: 0, y: 900, width: 50, height: 40 }, 0, 800, 600)).toBeNull();
    expect(shotRegion({ x: 10, y: 10, width: 0, height: 0 }, 0, 800, 600)).toBeNull();
  });
});

describe('outputSize', () => {
  it('zooms', () => {
    expect(outputSize(100, 50, 4, 4000)).toEqual({ width: 400, height: 200, limited: false });
  });
  it('shrinks to the longest side, aspect kept', () => {
    expect(outputSize(1000, 500, 8, 4000)).toEqual({ width: 4000, height: 2000, limited: true });
    expect(outputSize(5000, 1000, 1, 2000)).toEqual({ width: 2000, height: 400, limited: true });
  });
});

it('shrinkFor aims below the budget', () => {
  const k = shrinkFor(4_000_000, 900_000);
  expect(k).toBeLessThan(0.5);
  expect(k).toBeGreaterThan(0.3);
  expect(shrinkFor(1_000_000, 900_000)).toBeLessThanOrEqual(0.9);
});

describe('diffPixels', () => {
  const px = (...rgba: number[][]) => new Uint8ClampedArray(rgba.flat());
  it('counts differing pixels and bounds them', () => {
    const white = [255, 255, 255, 255];
    const a = px(white, white, white, white);
    const b = px(white, [0, 0, 0, 255], white, [255, 0, 0, 255]);
    const d = diffPixels(a, b, 2, 2, 0.1);
    expect(d.differentPixels).toBe(2);
    expect(d.bounds).toEqual({ x: 1, y: 0, width: 1, height: 2 });
    // differences are painted red
    expect([...d.image.slice(4, 8)]).toEqual([255, 0, 0, 255]);
  });
  it('ignores changes below the threshold', () => {
    const a = px([100, 100, 100, 255]);
    const b = px([110, 100, 100, 255]);
    expect(diffPixels(a, b, 1, 1, 0.1).differentPixels).toBe(0); // 10 < 25.5
    expect(diffPixels(a, b, 1, 1, 0.02).differentPixels).toBe(1);
    expect(diffPixels(a, b, 1, 1, 0.1).bounds).toBeNull();
  });
  it('treats transparent as white', () => {
    expect(diffPixels(px([0, 0, 0, 0]), px([255, 255, 255, 255]), 1, 1, 0.01).differentPixels).toBe(
      0,
    );
  });
});
