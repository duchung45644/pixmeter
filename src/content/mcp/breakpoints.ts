/**
 * One shot of the page at several widths (MCP screenshot_at_breakpoints): responsive mode with one
 * frame per width side by side, zoomed to fit, captured as a single image. One image because a
 * reply is one frame (1 MB); separate shots per width would not fit.
 */
import { clampSize } from '../../lib/responsive/viewports';
import { state } from '../core/state.svelte';
import { describeViewports, setViewportList, setZoom, shell } from '../responsive/shell.svelte';
import { fail, type Commands } from './command';
import { responsiveCommands } from './responsive';
import { shotCommands } from './shot';

const GAP = 32; // room the shell leaves around each frame
const SETTLE_MS = 700; // frames reload their layout after a resize
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Zoom that fits `widths` side by side in `viewport` px (0.25–1). */
export function fitZoom(widths: readonly number[], viewport: number): number {
  const need = widths.reduce((a, w) => a + w + GAP, GAP);
  return Math.max(0.25, Math.min(1, Math.floor((viewport / need) * 100) / 100));
}

export const breakpointCommands: Commands = {
  async screenshot_at_breakpoints({ widths, height }) {
    const entered = !state.responsiveOn;
    if (entered) await responsiveCommands.enter_responsive_mode!({ tabId: 0 });
    if (!state.responsiveOn) return fail('Responsive mode could not start on this page.');
    if (shell.breakpointMode)
      return fail('Turn breakpoints mode off first (set_breakpoints_mode).');
    setViewportList(
      widths.map((w, i) => ({
        id: i + 1,
        name: '',
        ...clampSize(w, height, 'drag'),
        scheme: 'system' as const,
      })),
    );
    setZoom(fitZoom(widths, innerWidth));
    await wait(SETTLE_MS);
    const shot = (await shotCommands.get_screenshot!({ tabId: 0 })) as object;
    return {
      ...shot,
      ...describeViewports(),
      enteredResponsiveMode: entered,
      note:
        'One image with the frames side by side, left to right in the order of widths. ' +
        'The page stays in responsive mode so you can measure each frame (viewportId); call exit_responsive_mode when done.',
    };
  },
};
