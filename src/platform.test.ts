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

  it('logs a scheduled correction in the settings page wording', async () => {
    const shades = SHADES.map((shade) => ({ ...shade, positions: { ...shade.positions } }));
    stubHub(shades);
    new PowerViewPlatform(harness.log, config({ healSweepIntervalMinutes: 60 }), harness.api);
    await harness.emit('didFinishLaunching');
    await vi.advanceTimersByTimeAsync(5_000);
    // Shade 1 is closed with the remote, which HomeKit never hears about.
    shades[0].positions.position1 = 0;

    await vi.advanceTimersByTimeAsync(61 * 60_000);

    expect(harness.log.info).toHaveBeenCalledWith(
      '%s: shade %d was %j, now %j', 'Asking shades on schedule', 1, { 1: 100 }, { 1: 0 },
    );
    expect(harness.log.info).toHaveBeenCalledWith('Asking shades on schedule: done, %d shade(s) corrected', 1);
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


describe('PowerViewPlatform verifyAfterMove', () => {
  let harness: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createHarness();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // The hub double answers reads with this shade, so a verify finds it at 0%:
  // a motor that never moved, whatever HomeKit was told.
  const AT_ZERO = { id: 1, name: 'U2hhZGU=', type: 1, positions: { posKind1: 1, position1: 0 } };

  async function ready(cfg: PowerViewPlatformConfig) {
    const fetchMock = stubHub([AT_ZERO]);
    const platform = new PowerViewPlatform(harness.log, cfg, harness.api);
    const done = platform.updateShades();
    await vi.advanceTimersByTimeAsync(5_000);
    await done;
    fetchMock.mockClear();
    const rfReads = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('refresh=true'));
    const service = platform.accessories.get(1)?.getServiceById(Service.WindowCovering, SUBTYPE.BOTTOM);
    return { platform, rfReads, service };
  }

  async function set(platform: PowerViewPlatform, value: number) {
    const done = platform.setPosition(1, 1 /* BOTTOM */, value, vi.fn());
    await vi.advanceTimersByTimeAsync(500);
    await done;
  }

  it('is off by default', async () => {
    const { platform, rfReads } = await ready(config());

    await set(platform, 80);
    await vi.advanceTimersByTimeAsync(120_000);

    expect(rfReads()).toHaveLength(0);
  });

  it('reads the shade over RF once its move should be over', async () => {
    const { platform, rfReads, service } = await ready(config({ verifyAfterMove: true }));

    await set(platform, 80);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(rfReads()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(rfReads()).toHaveLength(1);
    // The Home app now shows where the shade really is, not the target.
    expect(service?.getCharacteristic(Characteristic.CurrentPosition).value).toBe(0);
    expect(harness.log.info).toHaveBeenCalledWith('%s: checking shade %d', 'Asking shades after a move', 1);
    // Same wording as a correction found when asking shades on schedule.
    expect(harness.log.info).toHaveBeenCalledWith('%s: shade %d was %j, now %j', 'Asking shades after a move', 1, { 1: 80 }, { 1: 0 });
  });

  it('logs the check even when the shade is where HomeKit thought', async () => {
    const { platform } = await ready(config({ verifyAfterMove: true }));

    await set(platform, 0);
    await vi.advanceTimersByTimeAsync(35_000);

    expect(harness.log.info).toHaveBeenCalledWith('%s: checking shade %d', 'Asking shades after a move', 1);
    expect(harness.log.info).not.toHaveBeenCalledWith('%s: shade %d was %j, now %j', 'Asking shades after a move', 1, expect.anything(), expect.anything());
  });

  it('verifies a burst of moves once, after the last one', async () => {
    const { platform, rfReads } = await ready(config({ verifyAfterMove: true }));

    for (const value of [20, 60, 80]) {
      await set(platform, value);
      await vi.advanceTimersByTimeAsync(10_000);
    }
    await vi.advanceTimersByTimeAsync(60_000);

    expect(rfReads()).toHaveLength(1);
  });

  it('drops a pending verify on shutdown', async () => {
    const { platform, rfReads } = await ready(config({ verifyAfterMove: true }));

    await set(platform, 80);
    await harness.emit('shutdown');
    await vi.advanceTimersByTimeAsync(120_000);

    expect(rfReads()).toHaveLength(0);
  });

  // Shades 1 and 2 at 0%; scene 7 sends both to 100%.
  function stubSceneHub() {
    const shades = [
      { id: 1, name: 'T25l', type: 1, positions: { posKind1: 1, position1: 0 } },
      { id: 2, name: 'VHdv', type: 1, positions: { posKind1: 1, position1: 0 } },
    ];
    const fetchMock = vi.fn((url: string) => {
      const u = String(url);
      const shade = /\/api\/shades\/(\d+)/.exec(u);
      if (shade) {
        return Promise.resolve(jsonResponse({ shade: shades.find((x) => x.id === Number(shade[1])) }));
      }
      if (u.includes('/api/shades')) {
        return Promise.resolve(jsonResponse({ shadeData: shades, shadeIds: [1, 2] }));
      }
      if (u.includes('/api/scenemembers')) {
        return Promise.resolve(jsonResponse({ sceneMemberData: [1, 2].map((shadeId) => ({
          id: shadeId, sceneId: 7, shadeId, positions: { posKind1: 1, position1: 65535 },
        })) }));
      }
      if (u.includes('sceneId=')) {
        return Promise.resolve(jsonResponse({ scene: { shadeIds: [1, 2] } }));
      }
      if (u.includes('/api/scenes')) {
        return Promise.resolve(jsonResponse({ sceneIds: [7], sceneData: [{ id: 7, name: 'T3Blbg==' }] }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const rfReads = () => fetchMock.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes('refresh=true'))
      .map((u) => /shades\/(\d+)/.exec(u)?.[1]);
    return { fetchMock, rfReads };
  }

  async function readyScenes(cfg: PowerViewPlatformConfig) {
    const { fetchMock, rfReads } = stubSceneHub();
    const platform = new PowerViewPlatform(harness.log, cfg, harness.api);
    const shadesDone = platform.updateShades();
    await vi.advanceTimersByTimeAsync(5_000);
    await shadesDone;
    const scenesDone = platform.updateScenes();
    await vi.advanceTimersByTimeAsync(5_000);
    await scenesDone;
    fetchMock.mockClear();
    return { platform, rfReads };
  }

  it('verifies every shade a scene moved, spaced by healSweepGapMs', async () => {
    const { platform, rfReads } = await readyScenes(config({ verifyAfterMove: true, healSweepGapMs: 6_000 }));

    platform.sceneAccessories.get(7)?.getService(Service.Switch)
      ?.getCharacteristic(Characteristic.On).setValue(true);
    // Both checks come due 30s after the scene.
    await vi.advanceTimersByTimeAsync(32_000);
    expect(rfReads()).toEqual(['1']);

    // The second waits out the gap instead of following straight on.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(rfReads()).toEqual(['1']);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(rfReads()).toEqual(['1', '2']);
    expect(harness.log.info).toHaveBeenCalledWith('%s: shade %d was %j, now %j', 'Asking shades after a move', 2, { 1: 100 }, { 1: 0 });
  });
});

describe('PowerViewPlatform verify and heal sweep together', () => {
  let harness: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 18, 12, 0, 0));
    harness = createHarness();
  });

  afterEach(async () => {
    await harness.emit('shutdown');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('spaces a verify that comes due during a sweep like any other sweep read', async () => {
    const shades = [1, 2, 3].map((id) => ({ id, name: 'U2hhZGU=', type: 1, positions: { posKind1: 1, position1: 0 } }));
    const fetchMock = stubHub(shades);
    const platform = new PowerViewPlatform(
      harness.log, config({ verifyAfterMove: true, healSweepIntervalMinutes: 60 }), harness.api,
    );
    await harness.emit('didFinishLaunching');
    await vi.advanceTimersByTimeAsync(5_000);
    fetchMock.mockClear();
    const rfTimes: number[] = [];
    const base = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes('refresh=true')) {
        rfTimes.push(Date.now());
      }
      return (base as (u: string, i?: RequestInit) => Promise<Response>)(url, init);
    });

    // Move shade 3 so its verify comes due 2.5s into the sweep, between the
    // sweep's first and second reads.
    const sweepAt = 60 * 60_000 - 5_000;
    await vi.advanceTimersByTimeAsync(sweepAt - 28_000);
    const move = platform.setPosition(3, 1 /* BOTTOM */, 80, vi.fn());
    await vi.advanceTimersByTimeAsync(500);
    await move;
    await vi.advanceTimersByTimeAsync(60_000);

    // Shade 3 is read once: the sweep finds it already queued by the verify.
    expect(rfTimes).toHaveLength(3);
    for (let i = 1; i < rfTimes.length; i++) {
      expect(rfTimes[i] - rfTimes[i - 1]).toBeGreaterThanOrEqual(4_000);
    }
  });
});

describe('PowerViewPlatform setPositionDebounceMs', () => {
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

  async function ready(cfg: PowerViewPlatformConfig) {
    const fetchMock = stubHub([AT_ZERO]);
    const platform = new PowerViewPlatform(harness.log, cfg, harness.api);
    const done = platform.updateShades();
    await vi.advanceTimersByTimeAsync(5_000);
    await done;
    fetchMock.mockClear();
    const bodies = () => fetchMock.mock.calls
      .filter((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')
      .map((c) => (JSON.parse(String((c[1] as RequestInit).body)) as {
        shade: { positions: Record<string, number> };
      }).shade.positions);
    const moves = () => bodies().map((p) => p.position1);
    return { platform, moves, bodies };
  }

  it('is off by default: every value is sent', async () => {
    const { platform, moves } = await ready(config());

    for (const value of [20, 40, 60]) {
      const done = platform.setPosition(1, 1, value, vi.fn());
      await vi.advanceTimersByTimeAsync(1_000);
      await done;
    }

    expect(moves()).toHaveLength(3);
  });

  it('sends only the last value of a drag, once the slider rests', async () => {
    const { platform, moves } = await ready(config({ setPositionDebounceMs: 1_500 }));

    const callbacks = [vi.fn(), vi.fn(), vi.fn()];
    for (const [i, value] of [20, 40, 60].entries()) {
      await platform.setPosition(1, 1, value, callbacks[i]);
      await vi.advanceTimersByTimeAsync(1_000);
    }
    // HomeKit is answered at once, so the drag never feels stuck.
    for (const cb of callbacks) {
      expect(cb).toHaveBeenCalledWith(null);
    }
    expect(moves()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(moves()).toEqual([Math.round(65535 * 60 / 100)]);
  });

  it('debounces each shade position separately', async () => {
    const { platform, bodies } = await ready(config({ setPositionDebounceMs: 1_500 }));

    await platform.setPosition(1, 1 /* BOTTOM */, 30, vi.fn());
    await platform.setPosition(1, 2 /* TOP */, 70, vi.fn());
    await vi.advanceTimersByTimeAsync(3_000);

    // The hub queue may merge both into one request; neither value is lost.
    const sent = Object.assign({}, ...bodies()) as Record<string, number>;
    expect(sent.position1).toBe(Math.round(65535 * 30 / 100));
    expect(sent.position2).toBe(Math.round(65535 * 70 / 100));
  });

  it('still rejects an invalid value immediately', async () => {
    const { platform, moves } = await ready(config({ setPositionDebounceMs: 1_500 }));

    const callback = vi.fn();
    await platform.setPosition(1, 1, Number.NaN, callback);

    expect(callback.mock.calls[0][0]).toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(moves()).toHaveLength(0);
  });

  it('drops a pending value on shutdown', async () => {
    const { platform, moves } = await ready(config({ setPositionDebounceMs: 1_500 }));

    await platform.setPosition(1, 1, 50, vi.fn());
    await harness.emit('shutdown');
    await vi.advanceTimersByTimeAsync(3_000);

    expect(moves()).toHaveLength(0);
  });
});

describe('PowerViewPlatform stop', () => {
  let harness: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createHarness();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** 14% open, where a real Gen 2 shade halted after a stop 5.6s into opening. */
  const HALTED_AT = 9295;
  const SHADE = { id: 1, name: 'U2hhZGU=', type: 1, capabilities: 0, positions: { posKind1: 1, position1: 0 } };
  const GEN1 = { name: 'PowerView Hub', revision: 1, subRevision: 1, build: 827 };
  const GEN2 = { name: 'PV Hub2.0', revision: 2, subRevision: 0, build: 1056 };

  /**
   * A hub double that behaves as the Gen 2 hub was measured to: a stop's reply
   * echoes the last commanded target, and only a refresh read reports where
   * the shade actually halted.
   */
  function stubStopHub(mainProcessor = GEN2, refreshes: Array<Record<string, unknown>> = []) {
    let lastTarget: Record<string, number> = SHADE.positions;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('/api/userdata')) {
        return Promise.resolve(jsonResponse({ userData: { hubName: 'SHVi', firmware: { mainProcessor } } }));
      }
      if (url.includes('/api/fwversion')) {
        return Promise.resolve(jsonResponse({ firmware: { mainProcessor } }));
      }
      if (/\/api\/shades\/\d+/.test(url)) {
        const body = init?.body
          ? JSON.parse(String(init.body)) as { shade?: { positions?: Record<string, number>; motion?: string } }
          : undefined;
        if (body?.shade?.positions) {
          lastTarget = body.shade.positions;
        }
        if (url.includes('refresh=true')) {
          // `delayMs` holds the reply back, as a slow RF read on a real hub does.
          const { delayMs, ...next } = refreshes.shift() ?? { positions: { posKind1: 1, position1: HALTED_AT } };
          const reply = jsonResponse({ shade: { ...SHADE, ...next } });
          return typeof delayMs === 'number'
            ? new Promise((resolve) => setTimeout(() => resolve(reply), delayMs))
            : Promise.resolve(reply);
        }
        return Promise.resolve(jsonResponse({ shade: { ...SHADE, positions: lastTarget } }));
      }
      if (url.includes('/api/shades')) {
        return Promise.resolve(jsonResponse({ shadeData: [SHADE], shadeIds: [1] }));
      }
      // Scene 7 opens shade 1.
      if (url.includes('/api/scenemembers')) {
        return Promise.resolve(jsonResponse({ sceneMemberData: [
          { id: 1, sceneId: 7, shadeId: 1, positions: { posKind1: 1, position1: 65535 } },
        ] }));
      }
      if (url.includes('sceneId=')) {
        return Promise.resolve(jsonResponse({ scene: { shadeIds: [1] } }));
      }
      if (url.includes('/api/scenes')) {
        return Promise.resolve(jsonResponse({ sceneIds: [7], sceneData: [{ id: 7, name: 'T3Blbg==' }] }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  async function launch(cfg = config(), mainProcessor = GEN2, refreshes?: Array<Record<string, unknown>>) {
    const fetchMock = stubStopHub(mainProcessor, refreshes);
    const platform = new PowerViewPlatform(harness.log, cfg, harness.api);
    await harness.emit('didFinishLaunching');
    await vi.advanceTimersByTimeAsync(5_000);
    const accessory = platform.accessories.get(1);
    const service = accessory?.getServiceById(Service.WindowCovering, SUBTYPE.BOTTOM);
    if (!service) {
      throw new Error('shade 1 not registered');
    }
    return { platform, service, fetchMock };
  }

  /** Sends a stop and lets the hub queue deliver it (it waits 100ms before sending). */
  async function stop(platform: PowerViewPlatform) {
    const sent = platform.stopShade(1);
    await vi.advanceTimersByTimeAsync(200);
    await sent;
  }

  const hasHold = (s: Service) => s.testCharacteristic(Characteristic.HoldPosition);
  const current = (s: Service) => s.getCharacteristic(Characteristic.CurrentPosition).value;
  const target = (s: Service) => s.getCharacteristic(Characteristic.TargetPosition).value;
  const state = (s: Service) => s.getCharacteristic(Characteristic.PositionState).value;
  const puts = (fetchMock: ReturnType<typeof stubStopHub>) => fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'PUT')
    .map(([, init]) => JSON.parse(String(init?.body)) as { shade: Record<string, unknown> });
  const refreshReads = (fetchMock: ReturnType<typeof stubStopHub>) => fetchMock.mock.calls
    .filter(([url]) => String(url).includes('refresh=true')).length;

  it('offers stop on a Gen 2 hub by default', async () => {
    const { service } = await launch();
    expect(hasHold(service)).toBe(true);
  });

  it('does not offer stop on a Gen 1 hub by default, which ignores it', async () => {
    const { service } = await launch(config(), GEN1);
    expect(hasHold(service)).toBe(false);
  });

  it('can be turned off on a Gen 2 hub', async () => {
    expect(hasHold((await launch(config({ stopCommand: 'off' }), GEN2)).service)).toBe(false);
  });

  it('can be forced on for a Gen 1 hub', async () => {
    expect(hasHold((await launch(config({ stopCommand: 'on' }), GEN1)).service)).toBe(true);
  });

  it('sends motion stop when HomeKit asks the shade to hold', async () => {
    const { service, fetchMock } = await launch();

    service.getCharacteristic(Characteristic.HoldPosition).setValue(true);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(puts(fetchMock)).toContainEqual({ shade: { motion: 'stop' } });
  });

  it('does not report the target the stop reply echoes', async () => {
    const { platform, service } = await launch(config({ reportTravel: true }));
    const move = platform.setPosition(1, 1, 100, vi.fn());
    await vi.advanceTimersByTimeAsync(1_000);
    await move;

    const stop = platform.stopShade(1);
    await vi.advanceTimersByTimeAsync(500);
    await stop;

    // The Gen 2 reply to a stop still says 65535: it is not where the shade is.
    expect(current(service)).not.toBe(100);
    expect(state(service)).toBe(Characteristic.PositionState.STOPPED);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(current(service)).toBe(14);
  });

  const stops = (fetchMock: ReturnType<typeof stubStopHub>) => puts(fetchMock)
    .filter((p) => p.shade.motion === 'stop').length;
  const at = (percent: number) => ({ positions: { posKind1: 1, position1: Math.round(65535 * percent / 100) } });

  it('waits two seconds, then shows where the shade halted once two reads agree', async () => {
    const { platform, service, fetchMock } = await launch();
    const before = refreshReads(fetchMock);

    await stop(platform);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(refreshReads(fetchMock)).toBe(before);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(refreshReads(fetchMock)).toBe(before + 2);
    expect(stops(fetchMock)).toBe(1);
    expect(current(service)).toBe(14);
    expect(target(service)).toBe(14);
    expect(state(service)).toBe(Characteristic.PositionState.STOPPED);
  });

  // Left (17438) missed 3 of 4 stops on build 1056, and a single read 3s later
  // showed it midway (43471) while it went on to close. Two reads that differ
  // mean the shade is still moving, so stop is sent again.
  it('stops again when two reads show the shade still moving', async () => {
    const { platform, service, fetchMock } = await launch(config(), GEN2, [
      at(70), at(40), at(30), at(30),
    ]);

    await stop(platform);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(current(service)).not.toBe(40);
    expect(stops(fetchMock)).toBe(2);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(current(service)).toBe(30);
    expect(stops(fetchMock)).toBe(2);
  });

  it('gives up stopping after the second try, and shows where the move ended', async () => {
    const { platform, service, fetchMock } = await launch(config(), GEN2, [
      at(70), at(40), at(30), at(10), at(25),
    ]);

    await stop(platform);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(stops(fetchMock)).toBe(2);
    expect(current(service)).toBe(0);

    await vi.advanceTimersByTimeAsync(45_000);
    expect(current(service)).toBe(25);
    expect(stops(fetchMock)).toBe(2);
  });

  it('never shows a timed-out read, which carries the stored target', async () => {
    const timedOut = { positions: { posKind1: 1, position1: 65535 }, timedOut: true };
    const { platform, service } = await launch(config({ reportTravel: true }), GEN2, [
      timedOut, at(14), at(14),
    ]);

    await stop(platform);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(current(service)).not.toBe(100);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(current(service)).toBe(14);
  });

  // Right, at rest, timed out once and was stopped a second time for nothing.
  it('reads again after a timeout instead of stopping again', async () => {
    const timedOut = { positions: { posKind1: 1, position1: 65535 }, timedOut: true };
    const { platform, service, fetchMock } = await launch(config(), GEN2, [
      timedOut, at(14), at(14),
    ]);

    await stop(platform);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(stops(fetchMock)).toBe(1);
    expect(current(service)).toBe(14);
  });

  it('waits out the move when the shade keeps timing out, without stopping again', async () => {
    const timedOut = { positions: { posKind1: 1, position1: 65535 }, timedOut: true };
    const { platform, service, fetchMock } = await launch(config(), GEN2, [
      timedOut, timedOut, timedOut, at(25),
    ]);

    await stop(platform);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(stops(fetchMock)).toBe(1);
    expect(current(service)).not.toBe(25);

    await vi.advanceTimersByTimeAsync(45_000);
    expect(stops(fetchMock)).toBe(1);
    expect(current(service)).toBe(25);
  });

  // Front Middle was opened 7s after Stop Shades; its stop check then saw it
  // moving, took it for a missed stop and stopped it again.
  it('gives way to a move sent after the stop', async () => {
    const { platform, service, fetchMock } = await launch(config(), GEN2, [
      at(14), at(40), at(60), at(80),
    ]);

    await stop(platform);
    const move = platform.setPosition(1, 1, 80, vi.fn());
    await vi.advanceTimersByTimeAsync(60_000);
    await move;

    expect(stops(fetchMock)).toBe(1);
    expect(current(service)).toBe(80);
  });

  it('gives way to a move sent while the stop check is reading', async () => {
    const { platform, service, fetchMock } = await launch(config(), GEN2, [
      at(14), at(40), at(60), at(80),
    ]);

    await stop(platform);
    await vi.advanceTimersByTimeAsync(2_050);
    const move = platform.setPosition(1, 1, 80, vi.fn());
    await vi.advanceTimersByTimeAsync(60_000);
    await move;

    expect(stops(fetchMock)).toBe(1);
    expect(current(service)).toBe(80);
  });

  it('gives way to a scene activated while the stop check is reading', async () => {
    const { platform, service, fetchMock } = await launch(config({ exposeScenes: true }), GEN2, [
      at(14), at(40), at(60), at(80),
    ]);

    await stop(platform);
    await vi.advanceTimersByTimeAsync(2_050);
    platform.sceneAccessories.get(7)?.getService(Service.Switch)
      ?.getCharacteristic(Characteristic.On).setValue(true);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(stops(fetchMock)).toBe(1);
    expect(current(service)).toBe(100);
  });

  it('gives way to a slider value still waiting out the debounce', async () => {
    const { platform, fetchMock } = await launch(config({ setPositionDebounceMs: 3_000 }), GEN2, [
      at(14), at(40), at(60), at(80),
    ]);

    await stop(platform);
    await vi.advanceTimersByTimeAsync(1_000);
    await platform.setPosition(1, 1, 80, vi.fn());
    await vi.advanceTimersByTimeAsync(60_000);

    expect(stops(fetchMock)).toBe(1);
  });

  it('lets a second stop replace the check of the first', async () => {
    const { platform, service, fetchMock } = await launch(config(), GEN2, [
      { ...at(40), delayMs: 3_000 }, at(60), at(60), at(60),
    ]);

    await stop(platform);
    await vi.advanceTimersByTimeAsync(2_100);
    // Waits behind the slow read, which is already on the wire.
    const second = platform.stopShade(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await second;

    expect(stops(fetchMock)).toBe(2);
    expect(current(service)).toBe(60);
  });

  it('never shows a late final read over a scene activated meanwhile', async () => {
    const timedOut = { positions: { posKind1: 1, position1: 65535 }, timedOut: true };
    const { platform, service } = await launch(config({ exposeScenes: true }), GEN2, [
      timedOut, timedOut, timedOut, { ...at(25), delayMs: 5_000 },
    ]);

    await stop(platform);
    await vi.advanceTimersByTimeAsync(2_000 + 45_500);
    platform.sceneAccessories.get(7)?.getService(Service.Switch)
      ?.getCharacteristic(Characteristic.On).setValue(true);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(current(service)).toBe(100);
  });

  it('cancels the travel animation, so the shade is not shown arriving later', async () => {
    const { platform, service } = await launch(config({ reportTravel: true }));
    const move = platform.setPosition(1, 1, 100, vi.fn());
    await vi.advanceTimersByTimeAsync(1_000);
    await move;

    await stop(platform);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(current(service)).toBe(14);
    expect(state(service)).toBe(Characteristic.PositionState.STOPPED);
  });

  it('drops a slider value still waiting to be sent', async () => {
    const { platform, fetchMock } = await launch(config({ setPositionDebounceMs: 1500 }));
    await platform.setPosition(1, 1, 80, vi.fn());

    await stop(platform);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(puts(fetchMock).filter((p) => p.shade.positions)).toEqual([]);
  });

  it('reports a failed stop to HomeKit', async () => {
    const { service, fetchMock } = await launch();
    fetchMock.mockImplementation(() => Promise.resolve(hubResponse({}, 500)));

    const result = service.getCharacteristic(Characteristic.HoldPosition).handleSetRequest(true);
    const settled = result.then(() => 'ok', () => 'error');
    await vi.advanceTimersByTimeAsync(20_000);

    expect(await settled).toBe('error');
  });
});

describe('PowerViewPlatform stop switch', () => {
  let harness: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = createHarness();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const GEN1 = { name: 'PowerView Hub', revision: 1, subRevision: 1, build: 827 };
  const GEN2 = { name: 'PV Hub2.0', revision: 2, subRevision: 0, build: 1056 };
  const shadeAt = (id: number, groupId: number | undefined, position1: number) => ({
    id, name: 'U2hhZGU=', type: 1, capabilities: 0, groupId, positions: { posKind1: 1, position1 },
  });
  // Two shades share group 26693; shade 3 reports no group.
  const SHADES = [shadeAt(1, 26693, 0), shadeAt(2, 26693, 0), shadeAt(3, undefined, 0)];
  /** Where each shade halts, as a refresh read reports it. */
  const HALTED: Record<number, number> = { 1: 13107, 2: 26214, 3: 39321 };

  function stubHub(mainProcessor = GEN2) {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((url) => {
      if (url.includes('/api/userdata')) {
        return Promise.resolve(jsonResponse({ userData: { hubName: 'SHVi', firmware: { mainProcessor } } }));
      }
      if (url.includes('/api/fwversion')) {
        return Promise.resolve(jsonResponse({ firmware: { mainProcessor } }));
      }
      if (url.includes('groupId=')) {
        return Promise.resolve(jsonResponse({ shadeIds: [1, 2] }));
      }
      const match = /\/api\/shades\/(\d+)/.exec(url);
      if (match) {
        const id = Number(match[1]);
        const shade = SHADES.find((s) => s.id === id);
        const position1 = url.includes('refresh=true') ? HALTED[id] : shade?.positions.position1;
        return Promise.resolve(jsonResponse({ shade: { ...shade, positions: { posKind1: 1, position1 } } }));
      }
      if (url.includes('/api/shades')) {
        return Promise.resolve(jsonResponse({ shadeData: SHADES, shadeIds: SHADES.map((s) => s.id) }));
      }
      if (url.includes('/api/scenes')) {
        return Promise.resolve(jsonResponse({ sceneData: [], sceneIds: [] }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  async function launch(cfg = config({ stopSwitch: true }), mainProcessor = GEN2, cached: PlatformAccessory[] = []) {
    const fetchMock = stubHub(mainProcessor);
    const platform = new PowerViewPlatform(harness.log, cfg, harness.api);
    for (const accessory of cached) {
      platform.configureAccessory(accessory);
    }
    await harness.emit('didFinishLaunching');
    await vi.advanceTimersByTimeAsync(5_000);
    return { platform, fetchMock };
  }

  const stopSwitches = () => (harness.registered as unknown as PlatformAccessory[])
    .filter((a) => (a.context as { stopSwitch?: boolean }).stopSwitch === true);
  const switchOf = (accessory: PlatformAccessory) => {
    const service = accessory.getService(Service.Switch);
    if (!service) {
      throw new Error('no switch service');
    }
    return service;
  };
  const percent = (platform: PowerViewPlatform, id: number) => platform.accessories.get(id)
    ?.getServiceById(Service.WindowCovering, SUBTYPE.BOTTOM)
    ?.getCharacteristic(Characteristic.CurrentPosition).value;

  it('adds a Stop Shades switch when turned on with a Gen 2 hub', async () => {
    await launch();
    expect(stopSwitches().map((a) => a.displayName)).toEqual(['Stop Shades']);
  });

  it('adds no switch unless asked for', async () => {
    await launch(config());
    expect(stopSwitches()).toEqual([]);
  });

  it('adds no switch on a Gen 1 hub, which ignores stop', async () => {
    await launch(config({ stopSwitch: true }), GEN1);
    expect(stopSwitches()).toEqual([]);
  });

  it('removes a cached switch once it is turned off', async () => {
    const cached = new (harness.api.platformAccessory as unknown as new (n: string, u: string) => PlatformAccessory)(
      'Stop Shades', 'cached-stop-switch',
    );
    (cached.context as { stopSwitch?: boolean }).stopSwitch = true;
    cached.addService(Service.Switch, 'Stop Shades');

    await launch(config(), GEN2, [cached]);

    expect(harness.unregistered as unknown as PlatformAccessory[]).toContain(cached);
  });

  it('stops each group with one command and a shade with no group on its own', async () => {
    const { fetchMock } = await launch();
    const before = fetchMock.mock.calls.length;

    switchOf(stopSwitches()[0]).getCharacteristic(Characteristic.On).setValue(true);
    await vi.advanceTimersByTimeAsync(1_000);

    const sent = fetchMock.mock.calls.slice(before)
      .filter(([, i]) => i?.method === 'PUT')
      .map(([url, i]) => [new URL(String(url)).pathname + new URL(String(url)).search, JSON.parse(String(i?.body))]);
    expect(sent).toEqual([
      ['/api/shades?groupId=26693', { shade: { motion: 'stop' } }],
      ['/api/shades/3', { shade: { motion: 'stop' } }],
    ]);
  });

  it('turns itself back off, like a scene switch', async () => {
    await launch();
    const on = switchOf(stopSwitches()[0]).getCharacteristic(Characteristic.On);

    on.setValue(true);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(on.value).toBe(false);
  });

  it('then shows where each shade halted', async () => {
    const { platform } = await launch();

    switchOf(stopSwitches()[0]).getCharacteristic(Characteristic.On).setValue(true);
    await vi.advanceTimersByTimeAsync(10_000);

    expect([percent(platform, 1), percent(platform, 2), percent(platform, 3)]).toEqual([20, 40, 60]);
  });
});

describe('PowerViewPlatform stopBeforeRetarget', () => {
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
  const TOP_BOTTOM = {
    id: 1, name: 'U2hhZGU=', type: 8, capabilities: 7,
    positions: { posKind1: 1, position1: 0, posKind2: 2, position2: 0 },
  };

  type Put = { at: number; shade: { motion?: string; positions?: Record<string, number> } };

  // `stopCommand: 'on'`: this hub double reports no generation, so `auto` would leave stop off.
  async function ready(
    cfg = config({ stopBeforeRetarget: true, stopCommand: 'on' }),
    shade: Record<string, unknown> = AT_ZERO,
  ) {
    const fetchMock = stubHub([shade]);
    const platform = new PowerViewPlatform(harness.log, cfg, harness.api);
    const done = platform.updateShades();
    await vi.advanceTimersByTimeAsync(5_000);
    await done;
    fetchMock.mockClear();
    const puts = (): Put[] => fetchMock.mock.calls
      .filter((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')
      .map((c, i) => ({ at: i, ...(JSON.parse(String((c[1] as RequestInit).body)) as Omit<Put, 'at'>) }));
    return { platform, fetchMock, puts };
  }

  function set(platform: PowerViewPlatform, value: number, position = 1 /* BOTTOM */) {
    const callback = vi.fn();
    const done = platform.setPosition(1, position, value, callback);
    return { callback, done };
  }

  it('is off by default: a mid-travel re-target is sent without a stop', async () => {
    const { platform, puts } = await ready(config());

    const first = set(platform, 100);
    await vi.advanceTimersByTimeAsync(3_000);
    await first.done;
    const second = set(platform, 20);
    await vi.advanceTimersByTimeAsync(500);
    await second.done;

    expect(puts().map((p) => p.shade.motion)).not.toContain('stop');
    expect(puts()).toHaveLength(2);
  });

  it('does not stop for the target the shade is already moving to', async () => {
    const { platform, puts } = await ready();

    const first = set(platform, 100);
    await vi.advanceTimersByTimeAsync(3_000);
    await first.done;
    const again = set(platform, 100);
    await vi.advanceTimersByTimeAsync(3_000);
    await again.done;

    expect(puts().map((p) => p.shade.motion)).not.toContain('stop');
    // The repeat still goes out, as it does with the option off.
    expect(puts().map((p) => p.shade.positions?.position1)).toEqual([65535, 65535]);
    expect(again.callback).toHaveBeenCalledWith(null);
  });

  it('does nothing where stop is off, since the hub would ignore it', async () => {
    const { platform, puts } = await ready(config({ stopBeforeRetarget: true, stopCommand: 'off' }));

    const first = set(platform, 100);
    await vi.advanceTimersByTimeAsync(3_000);
    await first.done;
    const second = set(platform, 20);
    await vi.advanceTimersByTimeAsync(500);
    await second.done;

    expect(puts().map((p) => p.shade.motion)).not.toContain('stop');
    expect(puts()).toHaveLength(2);
  });

  it('drops a re-target still waiting when the user stops the shade', async () => {
    const { platform, puts } = await ready();

    const first = set(platform, 100);
    await vi.advanceTimersByTimeAsync(3_000);
    await first.done;
    const second = set(platform, 20);
    await vi.advanceTimersByTimeAsync(500);
    const userStop = platform.stopShade(1);
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all([second.done, userStop]);

    expect(second.callback).toHaveBeenCalledWith(null);
    expect(puts().map((p) => p.shade.positions?.position1)).not.toContain(13107);
  });

  it('sends a move right after a user stop without a stop of its own', async () => {
    const { platform, puts } = await ready();

    const first = set(platform, 100);
    await vi.advanceTimersByTimeAsync(3_000);
    await first.done;
    const userStop = platform.stopShade(1);
    await vi.advanceTimersByTimeAsync(500);
    await userStop;
    const after = set(platform, 20);
    await vi.advanceTimersByTimeAsync(500);
    await after.done;

    expect(puts().filter((p) => p.shade.motion === 'stop')).toHaveLength(1);
    expect(puts().at(-1)?.shade.positions?.position1).toBe(13107);
  });

  it('sends an idle shade its target at once, with no stop', async () => {
    const { platform, puts } = await ready();

    const first = set(platform, 100);
    await vi.advanceTimersByTimeAsync(500);
    await first.done;

    // Nothing is moving, so there is nothing to stop and no settle to wait for.
    expect(first.callback).toHaveBeenCalledWith(null);
    expect(puts()).toHaveLength(1);
    expect(puts()[0].shade.motion).toBeUndefined();
  });

  it('stops a moving shade and waits before sending the new target', async () => {
    const { platform, puts } = await ready();

    const first = set(platform, 100);
    await vi.advanceTimersByTimeAsync(500);
    await first.done;
    await vi.advanceTimersByTimeAsync(3_000);

    const second = set(platform, 20);
    await vi.advanceTimersByTimeAsync(500);
    // The stop has gone out; the new target waits for the motor to settle.
    expect(puts().map((p) => p.shade.motion ?? 'move')).toEqual(['move', 'stop']);
    expect(second.callback).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_500);
    await second.done;

    expect(puts().map((p) => p.shade.motion ?? 'move')).toEqual(['move', 'stop', 'move']);
    expect(puts()[2].shade.positions?.position1).toBe(Math.round(65535 * 20 / 100));
    expect(second.callback).toHaveBeenCalledWith(null);
  });

  it('sends only the last of a burst that arrives while a stop settles', async () => {
    const { platform, puts } = await ready();

    const first = set(platform, 100);
    await vi.advanceTimersByTimeAsync(500);
    await first.done;
    await vi.advanceTimersByTimeAsync(3_000);

    const a = set(platform, 20);
    await vi.advanceTimersByTimeAsync(200);
    const b = set(platform, 60);
    await vi.advanceTimersByTimeAsync(200);
    const c = set(platform, 40);
    await vi.advanceTimersByTimeAsync(3_000);
    await Promise.all([a.done, b.done, c.done]);

    const moves = puts().filter((p) => !p.shade.motion);
    expect(puts().filter((p) => p.shade.motion === 'stop')).toHaveLength(1);
    expect(moves).toHaveLength(2);
    expect(moves[1].shade.positions?.position1).toBe(Math.round(65535 * 40 / 100));
    for (const cb of [a.callback, b.callback, c.callback]) {
      expect(cb).toHaveBeenCalledWith(null);
    }
  });

  it('still sends the new target when the stop fails', async () => {
    const { platform, fetchMock, puts } = await ready();
    const passthrough = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT' && String(init.body).includes('"stop"')) {
        return Promise.resolve(hubResponse({}, 400));
      }
      return passthrough!(url, init);
    });

    const first = set(platform, 100);
    await vi.advanceTimersByTimeAsync(500);
    await first.done;
    await vi.advanceTimersByTimeAsync(3_000);

    const second = set(platform, 20);
    await vi.advanceTimersByTimeAsync(3_000);
    await second.done;

    expect(puts().map((p) => p.shade.motion)).toContain('stop');
    expect(puts().filter((p) => !p.shade.motion)).toHaveLength(2);
    expect(second.callback).toHaveBeenCalledWith(null);
  });

  it('does not stop a shade whose other rail is still moving', async () => {
    const { platform, puts } = await ready(
      config({ stopBeforeRetarget: true, stopCommand: 'on', forceTopBottomShades: [1] }), TOP_BOTTOM,
    );

    const bottom = set(platform, 100, 1 /* BOTTOM */);
    await vi.advanceTimersByTimeAsync(500);
    await bottom.done;
    const top = set(platform, 50, 2 /* TOP */);
    await vi.advanceTimersByTimeAsync(500);
    await top.done;
    await vi.advanceTimersByTimeAsync(1_000);

    // Re-targeting the bottom rail mid-travel would stop the top rail too.
    const again = set(platform, 30, 1 /* BOTTOM */);
    await vi.advanceTimersByTimeAsync(3_000);
    await again.done;

    expect(puts().map((p) => p.shade.motion)).not.toContain('stop');
  });
});
