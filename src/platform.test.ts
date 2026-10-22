import type { PlatformAccessory } from 'homebridge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Characteristic, Service } from '@homebridge/hap-nodejs';

import { createHarness, type Harness } from './homebridge.harness.js';
import { PowerViewPlatform } from './platform.js';
import { SUBTYPE, type PowerViewPlatformConfig, type ShadeContext } from './settings.js';

/** A real Response, so body streaming and size limits behave as in production. */
function hubResponse(body: unknown, status = 200, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: contentType ? { 'content-type': contentType } : {},
  });
}

function jsonResponse(body: unknown) {
  return hubResponse(body, 200, 'application/json');
}

/** Answers every hub endpoint the platform touches during startup. */
function stubHub(shades: Array<Record<string, unknown>> = []) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url.includes('/api/userdata')) {
      return Promise.resolve(jsonResponse({
        userData: { hubName: 'SHVi', serialNumber: 'abc', firmware: { mainProcessor: { name: 'PowerView Hub', revision: 2, subRevision: 0, build: 827 } } },
      }));
    }
    if (/\/api\/shades\/\d+/.test(url)) {
      const id = Number(/\/api\/shades\/(\d+)/.exec(url)?.[1]);
      const shade = shades.find((s) => s.id === id) ?? { id };
      // A real hub echoes the commanded positions back in its PUT reply. The
      // plugin's default path relies on that, so the double has to do it too.
      const body = init?.body ? JSON.parse(String(init.body)) as {
        shade?: { positions?: Record<string, number> };
      } : undefined;
      if (init?.method === 'PUT' && body?.shade?.positions) {
        return Promise.resolve(jsonResponse({
          shade: { ...shade, positions: body.shade.positions },
        }));
      }
      return Promise.resolve(jsonResponse({ shade }));
    }
    if (url.includes('/api/shades')) {
      return Promise.resolve(jsonResponse({ shadeData: shades, shadeIds: shades.map((s) => s.id) }));
    }
    return Promise.resolve(jsonResponse({}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function config(overrides: Partial<PowerViewPlatformConfig> = {}): PowerViewPlatformConfig {
  return {
    platform: 'PowerView',
    name: 'PowerView',
    host: '127.0.0.1',
    syncPositionsOnStart: false,
    ...overrides,
  } as PowerViewPlatformConfig;
}

describe('PowerViewPlatform process handlers', () => {
  it('leaves process-wide error handling to Homebridge', () => {
    // Every plugin shares the Homebridge process. A plugin-installed
    // uncaughtException handler would swallow other plugins' crashes and keep
    // the bridge running in an undefined state.
    const before = {
      rejection: process.listenerCount('unhandledRejection'),
      exception: process.listenerCount('uncaughtException'),
    };

    const harness = createHarness();
    new PowerViewPlatform(harness.log, config(), harness.api);

    expect(process.listenerCount('unhandledRejection')).toBe(before.rejection);
    expect(process.listenerCount('uncaughtException')).toBe(before.exception);
  });
});

describe('PowerViewPlatform shutdown', () => {
  let harness: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createHarness();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('stops the shade poll loop on shutdown', async () => {
    const fetchMock = stubHub([{ id: 1, name: 'U2hhZGU=', type: 23 }]);

    const platform = new PowerViewPlatform(
      harness.log,
      config({ pollShadesForUpdate: true }),
      harness.api,
    );
    expect(platform).toBeDefined();

    await harness.emit('didFinishLaunching');
    await vi.advanceTimersByTimeAsync(60_000);

    await harness.emit('shutdown');
    const callsAtShutdown = fetchMock.mock.calls.length;

    // Two further poll intervals. Nothing may reach the hub after shutdown.
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchMock.mock.calls.length).toBe(callsAtShutdown);
  });
});

describe('PowerViewPlatform.setPosition', () => {
  let harness: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createHarness();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('reports an error instead of throwing when the shade is gone', async () => {
    stubHub();
    const platform = new PowerViewPlatform(harness.log, config(), harness.api);

    const callback = vi.fn();
    // Shade 99 was never registered — a set can still arrive for an accessory
    // Homebridge removed between HomeKit's read and write.
    await expect(
      platform.setPosition(99, 3 /* VANES */, 45, callback),
    ).resolves.toBeUndefined();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

describe('PowerViewPlatform.updateShades', () => {
  let harness: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createHarness();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function shadeUrls(fetchMock: ReturnType<typeof stubHub>): string[] {
    return fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => /\/api\/shades\/\d+/.test(url));
  }

  it('does not refetch a shade the list already reported positions for', async () => {
    const fetchMock = stubHub([
      { id: 1, name: 'U2hhZGU=', type: 23, positions: { posKind1: 1, position1: 49151 } },
    ]);
    const platform = new PowerViewPlatform(harness.log, config(), harness.api);

    const done = platform.updateShades();
    await vi.advanceTimersByTimeAsync(5_000);
    await done;

    expect(shadeUrls(fetchMock)).toEqual([]);
  });

  it('still fetches a shade the list reported no positions for', async () => {
    const fetchMock = stubHub([{ id: 2, name: 'U2hhZGU=', type: 23 }]);
    const platform = new PowerViewPlatform(harness.log, config(), harness.api);

    const done = platform.updateShades();
    await vi.advanceTimersByTimeAsync(5_000);
    await done;

    expect(shadeUrls(fetchMock)).toHaveLength(1);
  });
});

describe('PowerViewPlatform accessory removal', () => {
  let harness: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createHarness();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const ALL = [
    { id: 1, name: 'U2hhZGU=', type: 1, positions: { posKind1: 1, position1: 0 } },
    { id: 2, name: 'U2hhZGU=', type: 1, positions: { posKind1: 1, position1: 0 } },
    { id: 3, name: 'U2hhZGU=', type: 1, positions: { posKind1: 1, position1: 0 } },
  ];

  async function poll(platform: PowerViewPlatform) {
    const done = platform.updateShades();
    await vi.advanceTimersByTimeAsync(5_000);
    await done;
  }

  async function platformWithAll() {
    stubHub(ALL);
    const platform = new PowerViewPlatform(harness.log, config(), harness.api);
    await poll(platform);
    expect(platform.accessories.size).toBe(3);
    return platform;
  }

  it('keeps accessories the hub omits from a single response', async () => {
    const platform = await platformWithAll();

    // One short response. A hub under load can answer with a partial list, and
    // unregistering an accessory destroys its rooms and automations for good.
    stubHub([ALL[0]]);
    await poll(platform);

    expect(platform.accessories.size).toBe(3);
    expect(harness.unregistered).toHaveLength(0);
  });

  it('never prunes on an empty response', async () => {
    const platform = await platformWithAll();

    stubHub([]);
    await poll(platform);
    await poll(platform);
    await poll(platform);
    await poll(platform);

    expect(platform.accessories.size).toBe(3);
    expect(harness.unregistered).toHaveLength(0);
  });

  it('removes a shade genuinely gone from several consecutive responses', async () => {
    const platform = await platformWithAll();

    stubHub([ALL[0], ALL[1]]);
    await poll(platform);
    await poll(platform);
    await poll(platform);

    expect(platform.accessories.has(3)).toBe(false);
    expect(harness.unregistered).toHaveLength(1);
  });

  it('forgives a shade that reappears before the threshold', async () => {
    const platform = await platformWithAll();

    stubHub([ALL[0], ALL[1]]);
    await poll(platform);
    stubHub(ALL);
    await poll(platform);
    stubHub([ALL[0], ALL[1]]);
    await poll(platform);
    await poll(platform);

    expect(platform.accessories.size).toBe(3);
    expect(harness.unregistered).toHaveLength(0);
  });
});

describe('PowerViewPlatform.getPosition', () => {
  let harness: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createHarness();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const SHADE = { id: 1, name: 'U2hhZGU=', type: 1, positions: { posKind1: 1, position1: 49151 } };

  async function readyPlatform(cfg = config()) {
    const fetchMock = stubHub([SHADE]);
    const platform = new PowerViewPlatform(harness.log, cfg, harness.api);
    const done = platform.updateShades();
    await vi.advanceTimersByTimeAsync(5_000);
    await done;
    fetchMock.mockClear();
    return { platform, fetchMock };
  }

  it('answers a warm cache before the hub is consulted', async () => {
    const { platform, fetchMock } = await readyPlatform();

    // HomeKit must be answered inside its read budget. A refresh behind the
    // answer is fine and expected; waiting for one is what blew the budget once
    // several shades were read at once, so order is the thing to assert.
    const order: string[] = [];
    fetchMock.mockImplementation((() => {
      order.push('hub');
      return jsonResponse({ shade: { id: 1, name: 'U2hhZGU=' } }) as never;
    }) as never);

    await platform.getPosition(1, 1 /* BOTTOM */, (err, value) => {
      order.push(`callback:${String(value)}`);
    });

    expect(order[0]).toBe('callback:75');
  });

  it('does not wake the motor over RF to service a read', async () => {
    const { platform, fetchMock } = await readyPlatform();

    await platform.getPosition(1, 1, vi.fn());
    await vi.advanceTimersByTimeAsync(10_000);

    const refreshed = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .filter((url) => url.includes('refresh=true'));
    expect(refreshed).toEqual([]);
  });

  it('still asks the hub when nothing is cached', async () => {
    const { platform, fetchMock } = await readyPlatform();
    const callback = vi.fn();

    const done = platform.getPosition(99, 1, callback);
    await vi.advanceTimersByTimeAsync(5_000);
    await done;

    expect(fetchMock).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('keeps blocking reads under strictErrors', async () => {
    const { platform, fetchMock } = await readyPlatform(config({ strictErrors: true }));

    const done = platform.getPosition(1, 1, vi.fn());
    await vi.advanceTimersByTimeAsync(5_000);
    await done;

    expect(fetchMock).toHaveBeenCalled();
  });
});

describe('PowerViewPlatform startup', () => {
  let harness: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createHarness();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('finishes launching without waiting for the RF position sync', async () => {
    // Local noon, outside the default 21:00-08:00 quiet hours that skip the sync.
    vi.setSystemTime(new Date(2026, 0, 15, 12, 0));
    const order: string[] = [];
    // A shade with no position forces the sync to do the slow RF read, which is
    // seconds per shade and must not hold up Homebridge's launch.
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('refresh=true')) {
        order.push('rf-refresh');
        return new Promise(() => {}); // never settles
      }
      if (String(url).includes('/api/userdata')) {
        return Promise.resolve(jsonResponse({
          userData: { hubName: 'SHVi', serialNumber: 'abc' },
        }));
      }
      if (/\/api\/shades\/\d+/.test(String(url))) {
        return Promise.resolve(jsonResponse({ shade: { id: 1, name: 'U2hhZGU=', type: 1 } }));
      }
      if (String(url).includes('/api/shades')) {
        return Promise.resolve(jsonResponse({
          shadeData: [{ id: 1, name: 'U2hhZGU=', type: 1 }],
          shadeIds: [1],
        }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const log = harness.log as unknown as { info: ReturnType<typeof vi.fn> };
    log.info.mockImplementation((msg: string) => {
      if (typeof msg === 'string' && msg.startsWith('Battery poll:')) {
        order.push('launch-complete');
      }
    });

    const platform = new PowerViewPlatform(harness.log, config({ syncPositionsOnStart: true }), harness.api);
    expect(platform).toBeDefined();
    await harness.emit('didFinishLaunching');
    await vi.advanceTimersByTimeAsync(30_000);

    expect(order).toContain('launch-complete');
    expect(order.indexOf('launch-complete')).toBeLessThan(order.indexOf('rf-refresh'));
  });
});

describe('PowerViewPlatform movement reporting', () => {
  let harness: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createHarness();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const AT_ZERO = { id: 1, name: 'U2hhZGU=', type: 1, positions: { posKind1: 1, position1: 0 } };

  async function ready(cfg = config({ reportTravel: true })) {
    const fetchMock = stubHub([AT_ZERO]);
    const platform = new PowerViewPlatform(harness.log, cfg, harness.api);
    const done = platform.updateShades();
    await vi.advanceTimersByTimeAsync(5_000);
    await done;
    const accessory = platform.accessories.get(1);
    if (!accessory) {
      throw new Error('shade 1 not registered');
    }
    const service = accessory.getServiceById(Service.WindowCovering, SUBTYPE.BOTTOM);
    if (!service) {
      throw new Error('no bottom service');
    }
    return { platform, service, fetchMock };
  }

  const current = (s: Service) => s.getCharacteristic(Characteristic.CurrentPosition).value;
  const target = (s: Service) => s.getCharacteristic(Characteristic.TargetPosition).value;
  const state = (s: Service) => s.getCharacteristic(Characteristic.PositionState).value;

  it('reports the commanded position immediately by default', async () => {
    const { platform, service } = await ready(config());

    const done = platform.setPosition(1, 1 /* BOTTOM */, 80, vi.fn());
    await vi.advanceTimersByTimeAsync(1_000);
    await done;

    // Default is the responsive tile: the number moves the moment you tap it,
    // at the cost of being ahead of the shade while it travels.
    expect(current(service)).toBe(80);
    expect(target(service)).toBe(80);
    expect(state(service)).toBe(Characteristic.PositionState.STOPPED);
  });

  it('reports the shade as moving when reportTravel is on', async () => {
    const { platform, service } = await ready();

    const done = platform.setPosition(1, 1 /* BOTTOM */, 80, vi.fn());
    await vi.advanceTimersByTimeAsync(1_000);
    await done;

    // The shade physically takes seconds. Reporting it at 80 immediately makes
    // the Home app show an arrival that has not happened.
    expect(target(service)).toBe(80);
    expect(current(service)).toBe(0);
    expect(state(service)).toBe(Characteristic.PositionState.INCREASING);
  });

  it('settles at the target once travel time has passed', async () => {
    const { platform, service } = await ready();

    const done = platform.setPosition(1, 1, 80, vi.fn());
    await vi.advanceTimersByTimeAsync(1_000);
    await done;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(current(service)).toBe(80);
    expect(state(service)).toBe(Characteristic.PositionState.STOPPED);
  });

  it('reports closing when the target is below the current position', async () => {
    const { platform, service } = await ready();

    const up = platform.setPosition(1, 1, 90, vi.fn());
    await vi.advanceTimersByTimeAsync(1_000);
    await up;
    await vi.advanceTimersByTimeAsync(60_000);

    const down = platform.setPosition(1, 1, 10, vi.fn());
    await vi.advanceTimersByTimeAsync(1_000);
    await down;

    expect(state(service)).toBe(Characteristic.PositionState.DECREASING);
    expect(current(service)).toBe(90);
  });

  it('re-targets cleanly when a second command arrives mid-travel', async () => {
    const { platform, service } = await ready();

    const first = platform.setPosition(1, 1, 80, vi.fn());
    await vi.advanceTimersByTimeAsync(1_000);
    await first;

    const second = platform.setPosition(1, 1, 40, vi.fn());
    await vi.advanceTimersByTimeAsync(1_000);
    await second;
    await vi.advanceTimersByTimeAsync(60_000);

    // The first move's settle timer must not land after the second and park the
    // shade at a position it was re-targeted away from.
    expect(target(service)).toBe(40);
    expect(current(service)).toBe(40);
    expect(state(service)).toBe(Characteristic.PositionState.STOPPED);
  });
});

describe('PowerViewPlatform scenes', () => {
  let harness: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createHarness();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function stubWithScenes(scenes: Array<Record<string, unknown>>) {
    const fetchMock = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes('sceneId=')) {
        return Promise.resolve(jsonResponse({ shadeIds: [1] }));
      }
      if (u.includes('/api/scenes')) {
        return Promise.resolve(jsonResponse({
          sceneIds: scenes.map((x) => x.id), sceneData: scenes,
        }));
      }
      if (u.includes('/api/userdata')) {
        return Promise.resolve(jsonResponse({ userData: { hubName: 'SHVi', serialNumber: 'a' } }));
      }
      if (u.includes('/api/shades')) {
        return Promise.resolve(jsonResponse({ shadeData: [], shadeIds: [] }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('exposes each hub scene as a switch', async () => {
    stubWithScenes([{ id: 7, name: 'Q2xvc2Vk' }, { id: 8, name: 'T3Blbg==' }]);
    const platform = new PowerViewPlatform(harness.log, config(), harness.api);

    const done = platform.updateScenes();
    await vi.advanceTimersByTimeAsync(5_000);
    await done;

    expect(platform.sceneAccessories.size).toBe(2);
    expect(harness.registered.map((a) => a.displayName)).toEqual(['Closed', 'Open']);
  });

  it('activates the scene in one hub call and resets the switch', async () => {
    const fetchMock = stubWithScenes([{ id: 7, name: 'Q2xvc2Vk' }]);
    const platform = new PowerViewPlatform(harness.log, config(), harness.api);
    const done = platform.updateScenes();
    await vi.advanceTimersByTimeAsync(5_000);
    await done;
    fetchMock.mockClear();

    const accessory = platform.sceneAccessories.get(7);
    const service = accessory?.getService(Service.Switch);
    service?.getCharacteristic(Characteristic.On).setValue(true);
    await vi.advanceTimersByTimeAsync(5_000);

    const activations = fetchMock.mock.calls
      .map((c) => String(c[0]))
      // Members are fetched with the same query, so match the activation path.
      .filter((u) => u.includes('/api/scenes?sceneId=7'));
    expect(activations).toHaveLength(1);
    // Stateless: a scene is a button, not something that stays on.
    expect(service?.getCharacteristic(Characteristic.On).value).toBe(false);
  });

  it('updates shade positions in HomeKit when a scene is activated', async () => {
    // The hub moves the shades itself, so nothing otherwise tells the plugin
    // where they went — the Home app kept showing stale positions until
    // something happened to refresh each shade.
    const fetchMock = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes('sceneId=') && u.includes('/api/scenemembers')) {
        return Promise.resolve(jsonResponse({
          sceneMemberData: [
            { id: 1, sceneId: 7, shadeId: 1, positions: { posKind1: 1, position1: 32768 } },
          ],
        }));
      }
      if (u.includes('sceneId=')) {
        return Promise.resolve(jsonResponse({}));
      }
      if (u.includes('/api/scenes')) {
        return Promise.resolve(jsonResponse({ sceneIds: [7], sceneData: [{ id: 7, name: 'Q2xvc2Vk' }] }));
      }
      if (u.includes('/api/userdata')) {
        return Promise.resolve(jsonResponse({ userData: { hubName: 'SHVi', serialNumber: 'a' } }));
      }
      if (u.includes('/api/shades')) {
        return Promise.resolve(jsonResponse({
          shadeData: [{ id: 1, name: 'U2hhZGU=', type: 1, positions: { posKind1: 1, position1: 0 } }],
          shadeIds: [1],
        }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const platform = new PowerViewPlatform(harness.log, config(), harness.api);
    const shades = platform.updateShades();
    await vi.advanceTimersByTimeAsync(5_000);
    await shades;
    const scenes = platform.updateScenes();
    await vi.advanceTimersByTimeAsync(5_000);
    await scenes;

    const service = platform.accessories.get(1)
      ?.getServiceById(Service.WindowCovering, SUBTYPE.BOTTOM);
    expect(service?.getCharacteristic(Characteristic.CurrentPosition).value).toBe(0);

    platform.sceneAccessories.get(7)?.getService(Service.Switch)
      ?.getCharacteristic(Characteristic.On).setValue(true);
    await vi.advanceTimersByTimeAsync(5_000);

    // 32768 of 65535 is 50%.
    expect(service?.getCharacteristic(Characteristic.CurrentPosition).value).toBe(50);
  });

  it('leaves scenes listed in excludeScenes out of HomeKit', async () => {
    // "Q2xvc2Vk" is "Closed", "T3Blbg==" is "Open", "TmlnaHQ=" is "Night".
    stubWithScenes([
      { id: 7, name: 'Q2xvc2Vk' }, { id: 8, name: 'T3Blbg==' }, { id: 9, name: 'TmlnaHQ=' },
    ]);
    const platform = new PowerViewPlatform(
      harness.log, config({ excludeScenes: ['closed', '9'] }), harness.api,
    );

    const done = platform.updateScenes();
    await vi.advanceTimersByTimeAsync(5_000);
    await done;

    expect([...platform.sceneAccessories.keys()]).toEqual([8]);
    expect(harness.registered.map((a) => a.displayName)).toEqual(['Open']);
  });

  it('removes a published scene once it is added to excludeScenes', async () => {
    stubWithScenes([{ id: 7, name: 'Q2xvc2Vk' }, { id: 8, name: 'T3Blbg==' }]);
    const before = new PowerViewPlatform(harness.log, config(), harness.api);
    const first = before.updateScenes();
    await vi.advanceTimersByTimeAsync(5_000);
    await first;
    const published = before.sceneAccessories.get(7);
    expect(published).toBeDefined();

    // A restart with the scene now excluded restores it from cache first.
    const after = new PowerViewPlatform(harness.log, config({ excludeScenes: ['Closed'] }), harness.api);
    after.configureAccessory(published as unknown as PlatformAccessory<ShadeContext>);
    const second = after.updateScenes();
    await vi.advanceTimersByTimeAsync(5_000);
    await second;

    expect(after.sceneAccessories.has(7)).toBe(false);
    expect(harness.unregistered.map((a) => a.displayName)).toEqual(['Closed']);
  });

  it('warns once about excludeScenes entries that match no scene', async () => {
    // "TmlnaHQ=" is "Night"; "Nite" is the typo, 99 an id that no longer exists.
    stubWithScenes([{ id: 9, name: 'TmlnaHQ=' }]);
    const platform = new PowerViewPlatform(
      harness.log, config({ excludeScenes: ['Nite', 'night', '99'] }), harness.api,
    );
    const warn = vi.mocked(harness.log.warn);

    for (let i = 0; i < 2; i++) {
      const done = platform.updateScenes();
      await vi.advanceTimersByTimeAsync(5_000);
      await done;
    }

    const messages = warn.mock.calls
      .filter((c) => String(c[0]).startsWith('excludeScenes entry'))
      .map((c) => c[1]);
    // Each unmatched entry once across both refreshes; the matching one never.
    expect(messages.sort()).toEqual(['99', 'Nite']);
  });

  it('does not warn about excludeScenes when the hub returns no scenes', async () => {
    // An empty list is not evidence the scene is gone, as for removal.
    stubWithScenes([]);
    const platform = new PowerViewPlatform(harness.log, config({ excludeScenes: ['Night'] }), harness.api);

    const done = platform.updateScenes();
    await vi.advanceTimersByTimeAsync(5_000);
    await done;

    expect(vi.mocked(harness.log.warn)).not.toHaveBeenCalledWith(
      expect.stringContaining('excludeScenes'), expect.anything(),
    );
  });

  it('puts sceneNamePrefix in front of new scene switch names', async () => {
    stubWithScenes([{ id: 7, name: 'Q2xvc2Vk' }]);
    const platform = new PowerViewPlatform(harness.log, config({ sceneNamePrefix: 'Scene: ' }), harness.api);

    const done = platform.updateScenes();
    await vi.advanceTimersByTimeAsync(5_000);
    await done;

    expect(harness.registered.map((a) => a.displayName)).toEqual(['Scene: Closed']);
  });

  it('registers nothing when the hub has no scenes', async () => {
    stubWithScenes([]);
    const platform = new PowerViewPlatform(harness.log, config(), harness.api);

    const done = platform.updateScenes();
    await vi.advanceTimersByTimeAsync(5_000);
    await done;

    expect(platform.sceneAccessories.size).toBe(0);
    expect(harness.registered).toHaveLength(0);
  });
});

describe('PowerViewPlatform startup diagnostics', () => {
  let harness: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createHarness();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('explains a Generation 3 Gateway instead of just reporting NotFound', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => (
      String(url).includes('/home/shades')
        ? Promise.resolve(jsonResponse({ shadeData: [] }))
        : Promise.resolve(new Response('', { status: 404 }))
    )));

    const platform = new PowerViewPlatform(harness.log, config(), harness.api);
    expect(platform).toBeDefined();
    await harness.emit('didFinishLaunching');
    await vi.advanceTimersByTimeAsync(30_000);

    const warned = (harness.log.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((c) => String(c[0])).join('\n');
    expect(warned).toMatch(/Generation 3/);
  });

  it('does not blame Gen 3 when the hub is merely unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    const platform = new PowerViewPlatform(harness.log, config(), harness.api);
    expect(platform).toBeDefined();
    await harness.emit('didFinishLaunching');
    await vi.advanceTimersByTimeAsync(60_000);

    const warned = (harness.log.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((c) => String(c[0])).join('\n');
    expect(warned).not.toMatch(/Generation 3/);
  });
});

export type { PlatformAccessory, ShadeContext };

describe('PowerViewPlatform healSweepIntervalMinutes', () => {
  let harness: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    // Noon, outside the default 21:00-08:00 quiet hours, whenever the suite runs.
    vi.setSystemTime(new Date(2026, 9, 18, 12, 0, 0));
    harness = createHarness();
  });

  afterEach(async () => {
    await harness.emit('shutdown');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const SHADES = [
    { id: 1, name: 'T25l', type: 1, positions: { posKind1: 1, position1: 65535 } },
    { id: 2, name: 'VHdv', type: 1, positions: { posKind1: 1, position1: 0 } },
  ];

  async function launch(cfg: PowerViewPlatformConfig) {
    const fetchMock = stubHub(SHADES);
    new PowerViewPlatform(harness.log, cfg, harness.api);
    await harness.emit('didFinishLaunching');
    await vi.advanceTimersByTimeAsync(5_000);
    fetchMock.mockClear();
    const rfReads = () => fetchMock.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes('refresh=true'));
    return { rfReads };
  }

  it('is off by default', async () => {
    const { rfReads } = await launch(config());

    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);

    expect(rfReads()).toHaveLength(0);
  });

  it('reads every shade over RF once per interval, one at a time', async () => {
    const { rfReads } = await launch(config({ healSweepIntervalMinutes: 60 }));

    // Scheduled at launch, 5s before the reads are counted: due at 59:55.
    await vi.advanceTimersByTimeAsync(59 * 60_000);
    expect(rfReads()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(56_000);
    // The 4s gap holds the second shade back.
    expect(rfReads()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(rfReads().map((u) => /shades\/(\d+)/.exec(u)?.[1])).toEqual(['1', '2']);

    // The next interval runs from the end of this sweep, so sweeps never overlap.
    await vi.advanceTimersByTimeAsync(60 * 60_000 + 30_000);
    expect(rfReads()).toHaveLength(4);
  });

  it('never sweeps more often than every 30 minutes', async () => {
    const { rfReads } = await launch(config({ healSweepIntervalMinutes: 1 }));

    await vi.advanceTimersByTimeAsync(29 * 60_000);

    expect(rfReads()).toHaveLength(0);
  });

  it('skips a sweep that falls in quiet hours', async () => {
    vi.setSystemTime(new Date(2026, 9, 18, 22, 0, 0));
    const { rfReads } = await launch(config({ healSweepIntervalMinutes: 60 }));

    await vi.advanceTimersByTimeAsync(61 * 60_000);

    expect(rfReads()).toHaveLength(0);
    expect(harness.log.info).toHaveBeenCalledWith('Asking shades on schedule: skipped, quiet hours');
  });

  // Log lines use the same words as the settings page: "ask shades" is an RF
  // read that wakes motors, "ask hub" is not.
  it('logs the startup read in the settings page wording', async () => {
    vi.setSystemTime(new Date(2026, 9, 18, 22, 0, 0));
    await launch(config({ syncPositionsOnStart: true }));
    expect(harness.log.info).toHaveBeenCalledWith('Asking shades at startup: skipped, quiet hours');
  });

  it('logs a scheduled read in the settings page wording', async () => {
    await launch(config({ healSweepIntervalMinutes: 60 }));
    await vi.advanceTimersByTimeAsync(61 * 60_000);
    expect(harness.log.info).toHaveBeenCalledWith('Asking shades on schedule: asking %d shades', 2);
    expect(harness.log.info).toHaveBeenCalledWith('Asking shades on schedule: done, %d shade(s) corrected', 0);
  });

  it('stops partway through on shutdown', async () => {
    const { rfReads } = await launch(config({ healSweepIntervalMinutes: 60 }));

    await vi.advanceTimersByTimeAsync(59 * 60_000 + 56_000);
    expect(rfReads()).toHaveLength(1);
    await harness.emit('shutdown');
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);

    expect(rfReads()).toHaveLength(1);
  });
});

