import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The Shade tools page loads this script to refill settings the form cleared.
// Run it here with a stand-in for the browser's global object.
const source = readFileSync(new URL('../homebridge-ui/public/formDefaults.js', import.meta.url), 'utf8');
const scope: { PowerViewFormDefaults?: { fill(block: Record<string, unknown>): boolean } } = {};
new Function('globalThis', source)(scope);
const fill = (block: Record<string, unknown>) => scope.PowerViewFormDefaults!.fill(block);

describe('Shade tools form defaults', () => {
  // The form clears From/Until when the box is unticked; ticking it again
  // should bring back the plugin's own default, not leave them blank.
  it('fills 9 PM-8 AM when quiet hours are ticked again', () => {
    const block = { quietHours: { enabled: true } };
    expect(fill(block)).toBe(true);
    expect(block.quietHours).toEqual({ enabled: true, start: 21, end: 8 });
  });

  it('fills only the missing hour', () => {
    const block = { quietHours: { enabled: true, start: 23 } };
    expect(fill(block)).toBe(true);
    expect(block.quietHours).toEqual({ enabled: true, start: 23, end: 8 });
  });

  // A config that never set quiet hours already gets the default at runtime.
  // Writing hours into it on an unrelated edit would change the saved config.
  it('leaves a config without quiet hours alone', () => {
    const block: Record<string, unknown> = { name: 'PowerView' };
    expect(fill(block)).toBe(false);
    expect(block).toEqual({ name: 'PowerView' });
  });

  it('leaves quiet hours alone while they are off', () => {
    const off = { quietHours: { enabled: false } };
    const legacyOff = { quietHours: false };
    expect(fill(off)).toBe(false);
    expect(fill(legacyOff)).toBe(false);
    expect(off.quietHours).toEqual({ enabled: false });
    expect(legacyOff.quietHours).toBe(false);
  });

  it('keeps hours that are set', () => {
    const block = { quietHours: { enabled: true, start: 0, end: 6 } };
    expect(fill(block)).toBe(false);
    expect(block.quietHours).toEqual({ enabled: true, start: 0, end: 6 });
  });

  it('fills 2 PM when the daily battery refresh is ticked again', () => {
    const block: Record<string, unknown> = { batteryPolling: true };
    expect(fill(block)).toBe(true);
    expect(block.batteryPollAt).toBe('14:00');
  });

  it('keeps a battery time that is set, and ignores it while the refresh is off', () => {
    const set = { batteryPolling: true, batteryPollAt: '14:30' };
    const off: Record<string, unknown> = { batteryPolling: false };
    expect(fill(set)).toBe(false);
    expect(set.batteryPollAt).toBe('14:30');
    expect(fill(off)).toBe(false);
    expect(off.batteryPollAt).toBeUndefined();
  });
});
