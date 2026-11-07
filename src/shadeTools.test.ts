import type { Logging } from 'homebridge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HubErrorCode, isHubError } from './errors.js';
import { HubPosition, PowerViewHub } from './powerviewHub.js';
import {
  ShadeTools,
  hubHostFromConfig,
  quietHoursOffTheOldWay,
  requireId,
  requireLight,
  requireMotion,
  toolHubLight,
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
describe('toolHubLight', () => {
  it('is off only when every channel is 0, since brightness 0 alone leaves the light on', () => {
    expect(toolHubLight({ red: 0, green: 0, blue: 0, brightness: 0 })).toEqual({ on: false, brightness: 0 });
    expect(toolHubLight({ red: 0, green: 0, blue: 255, brightness: 50 })).toEqual({ on: true, brightness: 50 });
    expect(toolHubLight({ red: 0, green: 0, blue: 255, brightness: 0 })).toEqual({ on: true, brightness: 0 });
  });

  it('is absent when the hub reports no light setting', () => {
    expect(toolHubLight(undefined)).toBeUndefined();
  });
});

describe('requireLight', () => {
  it('accepts off, or on with a whole brightness from 1 to 100', () => {
    expect(requireLight({ on: false })).toEqual({ on: false });
    expect(requireLight({ on: true, brightness: 1 })).toEqual({ on: true, brightness: 1 });
    expect(requireLight({ on: true, brightness: 100 })).toEqual({ on: true, brightness: 100 });
  });

  it('refuses anything else', () => {
    for (const bad of [{}, null, { on: 'yes' }, { on: true }, { on: true, brightness: 0 },
      { on: true, brightness: 101 }, { on: true, brightness: 2.5 }, { on: true, brightness: '50' }]) {
      let thrown: unknown;
      try {
        requireLight(bad);
      } catch (err) {
        thrown = err;
      }
      expect(isBadRequest(thrown), JSON.stringify(bad)).toBe(true);
    }
  });
});

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
  let hubColor: Record<string, number> | undefined;
  /** False to have the hub accept a light change but leave color out of its reply. */
  let echoColor: boolean;
  /** What the hub answers to ?survey=true. {} is a shade that did not answer. */
  let surveyReply: unknown;

  beforeEach(() => {
    vi.useFakeTimers();
    hubColor = { red: 0, green: 0, blue: 255, brightness: 50 };
    echoColor = true;
    surveyReply = { shade_id: 5, survey: [{ neighbor_id: 0, rssi: -64 }] };
    fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/api/userdata')) {
        if (init?.method === 'PUT') {
          hubColor = JSON.parse(String(init.body)).userData.color;
          if (!echoColor) {
            return Promise.resolve(hubResponse({ userData: { hubName: 'SHVi', serialNumber: 'abc' } }));
          }
        }
        return Promise.resolve(hubResponse({ userData: { hubName: 'SHVi', serialNumber: 'abc', color: hubColor } }));
      }
      if (init?.method === 'PUT') {
        return Promise.resolve(hubResponse({ shade: { id: 5, name: 'S2l0Y2hlbg==' } }));
      }
      if (u.includes('survey=true')) {
        return Promise.resolve(hubResponse(surveyReply));
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

  it('reads a shade position with an RF refresh', async () => {
    await run(tools().position({ id: 5 }));
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
    await expect(tools().position({ id: 'x' })).rejects.toSatisfy(isBadRequest);
    await expect(tools().signal({ id: 0 })).rejects.toSatisfy(isBadRequest);
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
    await run(t.position({ id: 5 }));
    await run(t.motion({ id: 5, motion: 'jog' }));
    await run(t.motion({ id: 5, motion: 'calibrate' }));
    await run(t.activateScene({ id: 7 }));
    expect(infoLines()).toEqual([
      'position read sent to shade 5 (Kitchen)',
      'jog sent to shade 5 (Kitchen)',
      'calibrate sent to shade 5 (Kitchen)',
      'scene 7 (Open) activated, moving shades none reported',
    ]);
  });

  const colorPuts = () => fetchMock.mock.calls
    .filter((c) => String(c[0]).includes('/api/userdata') && (c[1] as RequestInit | undefined)?.method === 'PUT')
    .map((c) => JSON.parse(String((c[1] as RequestInit).body)).userData.color);

  it('reports the hub light with the hub info, or leaves it out when the hub has none', async () => {
    expect((await run(tools().hubInfo())).light).toEqual({ on: true, brightness: 50 });
    hubColor = undefined;
    expect((await run(tools().hubInfo())).light).toBeUndefined();
  });

  it('turns the light off by zeroing every channel', async () => {
    expect(await run(tools().setLight({ on: false }))).toEqual({ on: false, brightness: 0 });
    expect(colorPuts()).toEqual([{ red: 0, green: 0, blue: 0, brightness: 0 }]);
  });

  it('turns the light on as blue, the primary hub colour, when it was off', async () => {
    hubColor = { red: 0, green: 0, blue: 0, brightness: 0 };
    expect(await run(tools().setLight({ on: true, brightness: 30 }))).toEqual({ on: true, brightness: 30 });
    expect(colorPuts()).toEqual([{ red: 0, green: 0, blue: 255, brightness: 30 }]);
  });

  it('keeps the current colour when only the brightness changes', async () => {
    hubColor = { red: 0, green: 255, blue: 0, brightness: 50 };
    await run(tools().setLight({ on: true, brightness: 80 }));
    expect(colorPuts()).toEqual([{ red: 0, green: 255, blue: 0, brightness: 80 }]);
  });

  it('reports the requested light when the hub echoes no color', async () => {
    echoColor = false;
    expect(await run(tools().setLight({ on: false }))).toEqual({ on: false, brightness: 0 });
    expect(await run(tools().setLight({ on: true, brightness: 20 }))).toEqual({ on: true, brightness: 20 });
  });

  it('refuses a bad light request without calling the hub', async () => {
    await expect(tools().setLight({ on: true, brightness: 0 })).rejects.toSatisfy(isBadRequest);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs one info line for each light change', async () => {
    const t = tools();
    await run(t.setLight({ on: false }));
    await run(t.setLight({ on: true, brightness: 40 }));
    expect(infoLines()).toEqual(['hub light turned off', 'hub light turned on at 40%']);
  });

  it('reports a shade signal in dBm from a radio survey', async () => {
    expect(await run(tools().signal({ id: 5 }))).toEqual({ id: 5, rssi: -64 });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain('http://127.0.0.1/api/shades/5?survey=true');
  });

  it('reports the strongest link when the shade hears more than one neighbour', async () => {
    surveyReply = { shade_id: 5, survey: [{ neighbor_id: 0, rssi: -80 }, { neighbor_id: 3, rssi: -58 }] };
    expect(await run(tools().signal({ id: 5 }))).toEqual({ id: 5, rssi: -58 });
  });

  it('reports no reading when the shade does not answer the survey', async () => {
    surveyReply = {};
    expect(await run(tools().signal({ id: 5 }))).toEqual({ id: 5 });
  });

  it('logs one info line per signal survey, naming the shade once the list has loaded', async () => {
    const t = tools();
    await run(t.signal({ id: 5 }));
    await run(t.shades());
    surveyReply = {};
    await run(t.signal({ id: 5 }));
    expect(infoLines()).toEqual([
      'signal survey sent to shade 5 (Shade 5): -64 dBm',
      'signal survey sent to shade 5 (Kitchen): no answer',
    ]);
  });

  it('logs nothing for read-only listings', async () => {
    const t = tools();
    await run(t.shades());
    await run(t.scenes());
    expect(toolLog.info).not.toHaveBeenCalled();
  });
});
