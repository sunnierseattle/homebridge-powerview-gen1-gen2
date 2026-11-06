import type { Logging } from 'homebridge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HubErrorCode, isHubError } from './errors.js';
import { HubPosition, PowerViewHub } from './powerviewHub.js';
import {
  ShadeTools,
  hubHostFromConfig,
  quietHoursOffTheOldWay,
  requireId,
  requireMotion,
  toolPositions,
  toolShade,
} from './shadeTools.js';

function hubResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logging;
const toolLog = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const isBadRequest = (err: unknown) => isHubError(err) && err.code === HubErrorCode.BadRequest;

describe('toolPositions', () => {
  it('scales rails over 65535 and vanes over 32767', () => {
    expect(toolPositions({ posKind1: 1, position1: 32768, posKind2: 3, position2: 32767 })).toEqual([
      { kind: HubPosition.BOTTOM, raw: 32768, percent: 50 },
      { kind: HubPosition.VANES, raw: 32767, percent: 100 },
    ]);
  });

  it('skips error kinds and copes with no positions', () => {
    expect(toolPositions({ posKind1: 4, position1: 0 })).toEqual([]);
    expect(toolPositions(undefined)).toEqual([]);
  });
});

describe('toolShade', () => {
  it('decodes the name and reports the battery as the plugin does', () => {
    const shade = toolShade({
      id: 5, name: 'S2l0Y2hlbg==', type: 1, batteryStatus: 3, batteryStrength: 168,
      firmware: { revision: 2, subRevision: 0, build: 1056 },
      positions: { posKind1: 1, position1: 0 },
    });
    expect(shade).toMatchObject({
      id: 5, name: 'Kitchen', firmware: '2.0.1056', timedOut: false, batteryStatus: 3,
    });
    expect(shade.batteryPercent).toBeGreaterThan(0);
  });
});

describe('page input validation', () => {
  it('accepts only positive integer ids', () => {
    expect(requireId({ id: 12 })).toBe(12);
    expect(requireId({ id: '12' })).toBe(12);
    for (const bad of [{ id: 0 }, { id: -3 }, { id: 1.5 }, { id: 'x' }, {}, null]) {
      let thrown: unknown;
      try {
        requireId(bad);
      } catch (err) {
        thrown = err;
      }
      expect(isBadRequest(thrown)).toBe(true);
    }
  });

  it('accepts only jog and calibrate', () => {
    expect(requireMotion({ motion: 'jog' })).toBe('jog');
    expect(requireMotion({ motion: 'calibrate' })).toBe('calibrate');
    // Anything else the hub would act on, such as stop or a position, is refused.
    expect(() => requireMotion({ motion: 'stop' })).toThrow(/Unsupported motion/);
    expect(() => requireMotion({})).toThrow(/Unsupported motion/);
  });
});

// Before the Quiet hours checkbox, quiet hours were turned off with false or
// the same hour twice. The form shows both as ticked, and saving false turns
// quiet hours on (seen on Homebridge UI, 2026-11-05), so the settings page
// unticks the box for these.
describe('quietHoursOffTheOldWay', () => {
  const saved = (quietHours: unknown) => ({ platforms: [{ platform: 'PowerView', quietHours }] });

  it('is true for false and for the same hour twice', () => {
    expect(quietHoursOffTheOldWay(saved(false))).toBe(true);
    expect(quietHoursOffTheOldWay(saved({ start: 0, end: 0 }))).toBe(true);
    expect(quietHoursOffTheOldWay(saved({ enabled: true, start: 7, end: 7 }))).toBe(true);
  });

  it('is false when quiet hours are on, unset, or already unticked', () => {
    expect(quietHoursOffTheOldWay(saved({ start: 21, end: 8 }))).toBe(false);
    expect(quietHoursOffTheOldWay(saved(undefined))).toBe(false);
    expect(quietHoursOffTheOldWay(saved({ enabled: false }))).toBe(false);
    expect(quietHoursOffTheOldWay(saved({ enabled: false, start: 0, end: 0 }))).toBe(false);
  });

  it('is false without a PowerView block or a readable config', () => {
    expect(quietHoursOffTheOldWay({ platforms: [{ platform: 'Other', quietHours: false }] })).toBe(false);
    expect(quietHoursOffTheOldWay(undefined)).toBe(false);
  });
});

describe('hubHostFromConfig', () => {
  it('reads the host from the PowerView platform block', () => {
    const config = { platforms: [{ platform: 'Other', host: 'x' }, { platform: 'PowerView', host: '192.168.1.202' }] };
    expect(hubHostFromConfig(config)).toBe('192.168.1.202');
  });

  it('falls back when the host is missing or not a plain host', () => {
    expect(hubHostFromConfig({ platforms: [{ platform: 'PowerView' }] })).toBe('powerview-hub.local');
    expect(hubHostFromConfig({ platforms: [{ platform: 'PowerView', host: 'evil.example/path?x' }] }))
      .toBe('powerview-hub.local');
    expect(hubHostFromConfig(undefined)).toBe('powerview-hub.local');
  });
});

describe('ShadeTools', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'PUT') {
        return Promise.resolve(hubResponse({ shade: { id: 5, name: 'S2l0Y2hlbg==' } }));
      }
      if (u.includes('/api/scenemembers')) {
        return Promise.resolve(hubResponse({
          sceneMemberData: [{ id: 1, sceneId: 7, shadeId: 5, positions: { posKind1: 1, position1: 65535 } }],
        }));
      }
      if (u.includes('/api/scenes')) {
        return Promise.resolve(hubResponse({ sceneIds: [7], sceneData: [{ id: 7, name: 'T3Blbg==' }] }));
      }
      if (u.includes('/api/shades/5')) {
        return Promise.resolve(hubResponse({ shade: { id: 5, name: 'S2l0Y2hlbg==', positions: { posKind1: 1, position1: 0 } } }));
      }
      if (u.includes('/api/shades')) {
        return Promise.resolve(hubResponse({
          shadeIds: [5, 6],
          shadeData: [{ id: 6, name: 'U3RhaXJz' }, { id: 5, name: 'S2l0Y2hlbg==' }],
        }));
      }
      return Promise.resolve(hubResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    toolLog.info.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const tools = () => new ShadeTools(new PowerViewHub(log, '127.0.0.1'), '127.0.0.1', toolLog as unknown as Logging);
  const infoLines = () => toolLog.info.mock.calls.map(([format, ...args]) =>
    String(format).replace(/%[sd]/g, () => String(args.shift())));

  async function run<T>(promise: Promise<T>): Promise<T> {
    await vi.advanceTimersByTimeAsync(5_000);
    return promise;
  }

  const puts = () => fetchMock.mock.calls
    .filter((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')
    .map((c) => JSON.parse(String((c[1] as RequestInit).body)));

  it('lists shades by name', async () => {
    const list = await run(tools().shades());
    expect(list.map((s) => s.name)).toEqual(['Kitchen', 'Stairs']);
  });

  it('checks a shade with an RF refresh', async () => {
    await run(tools().check({ id: 5 }));
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/api/shades/5') && u.includes('refresh=true'))).toBe(true);
  });

  it('sends jog and calibrate as hub motions', async () => {
    const t = tools();
    await run(t.motion({ id: 5, motion: 'jog' }));
    await run(t.motion({ id: 5, motion: 'calibrate' }));
    expect(puts()).toEqual([{ shade: { motion: 'jog' } }, { shade: { motion: 'calibrate' } }]);
  });

  it('refuses a bad id or motion without calling the hub', async () => {
    await expect(tools().motion({ id: 5, motion: 'stop' })).rejects.toSatisfy(isBadRequest);
    await expect(tools().check({ id: 'x' })).rejects.toSatisfy(isBadRequest);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists scenes with where each one sends each shade', async () => {
    const scenes = await run(tools().scenes());
    expect(scenes).toEqual([{
      id: 7,
      name: 'Open',
      members: [{ shadeId: 5, positions: [{ kind: HubPosition.BOTTOM, raw: 65535, percent: 100 }] }],
    }]);
  });

  it('logs one info line for every action that wakes a motor', async () => {
    const t = tools();
    await run(t.scenes());
    toolLog.info.mockClear();
    await run(t.check({ id: 5 }));
    await run(t.motion({ id: 5, motion: 'jog' }));
    await run(t.motion({ id: 5, motion: 'calibrate' }));
    await run(t.activateScene({ id: 7 }));
    expect(infoLines()).toEqual([
      'check sent to shade 5 (Kitchen)',
      'jog sent to shade 5 (Kitchen)',
      'calibrate sent to shade 5 (Kitchen)',
      'scene 7 (Open) activated, moving shades none reported',
    ]);
  });

  it('logs nothing for read-only listings', async () => {
    const t = tools();
    await run(t.shades());
    await run(t.scenes());
    expect(toolLog.info).not.toHaveBeenCalled();
  });
});
