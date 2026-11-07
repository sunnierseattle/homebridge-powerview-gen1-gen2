import type { Logging } from 'homebridge';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HubErrorCode, isHubError } from './errors.js';
import { HubPosition, PowerViewHub } from './powerviewHub.js';

/** A real Response, so body streaming and size limits behave as in production. */
function hubResponse(body: unknown, status = 200, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: contentType ? { 'content-type': contentType } : {},
  });
}

const log = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logging;

function hub(): PowerViewHub {
  return new PowerViewHub(log, '127.0.0.1');
}

describe('PowerViewHub.requestJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries on HTTP 423 then succeeds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(hubResponse(({ userData: { hubName: 'SHVi', serialNumber: 'abc' } }), 423, 'application/json'))
      .mockResolvedValueOnce(hubResponse(({ sceneIds: [], sceneData: [] }), 200, 'application/json'));
    vi.stubGlobal('fetch', fetchMock);

    const request = hub().requestJson<{ sceneIds: number[] }>('http://127.0.0.1/api/scenes');
    await vi.runAllTimersAsync();
    const result = await request;
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('maps HTTP 404 to NotFound', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(hubResponse(({}), 404, '')));

    await expect(hub().requestJson('http://127.0.0.1/api/scenes')).rejects.toSatisfy(
      (err: unknown) => isHubError(err) && err.code === HubErrorCode.NotFound,
    );
  });

  it('never reuses a connection, because the hub carries state across requests on one', async () => {
    // Build 827 remembers the previous request's id on a kept-alive connection:
    // GET /api/shades/26835 then GET /api/scenes on the same socket is answered
    // as /api/scenes/26835 — a 404 with an unparseable INVALID_SCENE_ID body.
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => Promise.resolve(hubResponse({ shade: { id: 1, name: 'U2hhZGU=' } })));
    vi.stubGlobal('fetch', fetchMock);

    const h = hub();
    const read = h.getScenes().catch(() => undefined);
    const write = h.putShade(1, HubPosition.BOTTOM, 65535, 100);
    await vi.runAllTimersAsync();
    await Promise.all([read, write]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls as unknown as [string, RequestInit | undefined][]) {
      expect(new Headers(init?.headers).get('connection')).toBe('close');
    }
    const put = (fetchMock.mock.calls as unknown as [string, RequestInit | undefined][])
      .find(([, init]) => init?.method === 'PUT');
    expect(new Headers(put?.[1]?.headers).get('content-type')).toBe('application/json');
    vi.useRealTimers();
  });

  it('reports the HTTP status of a failed request even when its body is not JSON', async () => {
    // The hub's 404 body for a bad scene id is `{"scene": "error":{...}}`, which
    // does not parse. Reading the body first reported "malformed JSON" and hid
    // the status.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      '{"scene": "error":{"code":"INVALID_SCENE_ID"}}',
      { status: 404, headers: { 'content-type': 'application/json' } },
    )));

    await expect(hub().requestJson('http://127.0.0.1/api/scenes')).rejects.toSatisfy(
      (err: unknown) => isHubError(err) && err.code === HubErrorCode.NotFound,
    );
  });

  it('rejects combined refresh and updateBatteryLevel', async () => {
    await expect(
      hub().getShade(1, { refresh: true, updateBatteryLevel: true }),
    ).rejects.toSatisfy(
      (err: unknown) => isHubError(err) && err.code === HubErrorCode.BadRequest,
    );
  });
});

describe('PowerViewHub request timeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('aborts a hung request instead of waiting forever', async () => {
    vi.useFakeTimers();
    // A hub that accepts the connection and never answers. Node's fetch has no
    // default timeout, so without an AbortController this promise never settles.
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    }));

    const request = hub().requestJson('http://127.0.0.1/api/userdata', undefined, {
      retriesOnMaintenance: false,
    });
    const assertion = expect(request).rejects.toSatisfy(
      (err: unknown) => isHubError(err) && err.code === HubErrorCode.Timeout,
    );
    await vi.advanceTimersByTimeAsync(20000);
    await assertion;
  });
});

describe('PowerViewHub queue', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('advances past a request whose URL cannot be built', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(hubResponse(({ shade: { id: 2, name: 'UmlnaHQ=' } }), 200, 'application/json'));
    vi.stubGlobal('fetch', fetchMock);

    // A host that makes `new URL()` throw. Upstream builds the URL outside the
    // try block, so the throw escapes before `queue.shift()` — the head of the
    // queue is never removed, nothing reschedules, and every later request hangs
    // unresolved forever.
    const h = new PowerViewHub(log, 'bad host:::');
    const first = h.getShade(1, { refresh: true });
    const second = h.getShade(2, { refresh: true });

    const firstAssertion = expect(first).rejects.toBeInstanceOf(Error);
    const secondAssertion = expect(second).rejects.toBeInstanceOf(Error);
    await vi.runAllTimersAsync();
    await firstAssertion;
    await secondAssertion;
  });
});

describe('PowerViewHub serialisation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('never has two requests in flight against the hub at once', async () => {
    vi.useFakeTimers();
    let inFlight = 0;
    let maxInFlight = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 50));
      inFlight -= 1;
      return hubResponse(({ firmware: { mainProcessor: { name: 'PowerView Hub' } } }), 200, 'application/json');
    }));

    const h = hub();
    // Capability probes bypass the shade queue; upstream fired these in parallel
    // with shade reads, which made the hub time out and return truncated JSON.
    const all = Promise.all([
      h.getFirmwareVersion(),
      h.getUserData().catch(() => undefined),
      h.getScenes().catch(() => undefined),
      h.getSceneCollections().catch(() => undefined),
    ]);
    await vi.runAllTimersAsync();
    await all;

    expect(maxInFlight).toBe(1);
  });
});

describe('PowerViewHub request serialisation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('does not start the next request until the previous body is read', async () => {
    vi.useFakeTimers();

    const events: string[] = [];
    let releaseFirstBody: (() => void) | undefined;

    const fetchMock = vi.fn((url: string) => {
      events.push(`fetch:${url}`);
      if (url.endsWith('/first')) {
        // Headers have arrived but the body is still streaming. The hub answers
        // one request at a time, so nothing else may go out yet.
        const stream = new ReadableStream({
          start(controller) {
            releaseFirstBody = () => {
              events.push('body-end:first');
              controller.enqueue(new TextEncoder().encode('{"ok":true}'));
              controller.close();
            };
          },
        });
        return Promise.resolve(new Response(stream, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }));
      }
      return Promise.resolve(hubResponse({ ok: true }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = hub();
    const first = client.requestJson('http://127.0.0.1/first');
    const second = client.requestJson('http://127.0.0.1/second');

    // Drain every timer the interval spacing schedules. The second request must
    // still be blocked, because the first response body is not yet consumed.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    releaseFirstBody?.();
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.all([first, second]);

    expect(events).toEqual([
      'fetch:http://127.0.0.1/first',
      'body-end:first',
      'fetch:http://127.0.0.1/second',
    ]);
  });
});

describe('PowerViewHub shade request coalescing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function shadeFetch() {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      () => Promise.resolve(hubResponse(({ shade: { id: 1, name: 'U2hhZGU=' } }), 200, 'application/json')),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('serves two identical battery reads from one hub request', async () => {
    vi.useFakeTimers();
    const fetchMock = shadeFetch();
    const client = hub();

    const both = Promise.all([
      client.getShade(1, { updateBatteryLevel: true }),
      client.getShade(1, { updateBatteryLevel: true }),
    ]);
    await vi.advanceTimersByTimeAsync(5_000);
    const [first, second] = await both;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.id).toBe(1);
    expect(second.id).toBe(1);
  });

  it('merges pending writes for one shade into a single PUT', async () => {
    vi.useFakeTimers();
    const fetchMock = shadeFetch();
    const client = hub();

    // HomeKit sends position and tilt as separate sets; the hub takes one
    // combined positions object.
    const both = Promise.all([
      client.putShade(1, HubPosition.BOTTOM, 49151, 75),
      client.putShade(1, HubPosition.VANES, 16383, 45),
    ]);
    await vi.advanceTimersByTimeAsync(5_000);
    await both;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({
      shade: { positions: { posKind1: 3, position1: 16383 } },
    });
  });
});

describe('PowerViewHub.stopShade', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('sends motion stop as a PUT to the shade', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => Promise.resolve(hubResponse({ shade: { id: 7 } })));
    vi.stubGlobal('fetch', fetchMock);

    const request = hub().stopShade(7);
    await vi.advanceTimersByTimeAsync(5_000);
    await request;

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/api/shades/7');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ shade: { motion: 'stop' } });
  });

  // One RF command for the whole group: stopping shades one by one costs about
  // 1.6s each on a Gen 2 hub, so the last of five would run on for 8s.
  it('stops a whole group with one PUT', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => Promise.resolve(hubResponse({ shadeIds: [1, 2] })));
    vi.stubGlobal('fetch', fetchMock);

    const request = hub().stopGroup(26693);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await request).toEqual([1, 2]);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/api/shades');
    expect(new URL(url).searchParams.get('groupId')).toBe('26693');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ shade: { motion: 'stop' } });
  });

  // Merging a later move into one queued before the stop would send it first,
  // and the stop would then halt the move the user asked for last.
  it('never merges a move queued after a stop into one queued before it', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => Promise.resolve(hubResponse({ shade: { id: 1 } })));
    vi.stubGlobal('fetch', fetchMock);
    const client = hub();

    const all = Promise.all([
      client.putShade(1, HubPosition.BOTTOM, 65535, 100),
      client.stopShade(1),
      client.putShade(1, HubPosition.BOTTOM, 0, 0),
    ]);
    await vi.advanceTimersByTimeAsync(5_000);
    await all;

    const bodies = (fetchMock.mock.calls as unknown as [string, RequestInit][])
      .map(([, init]) => JSON.parse(String(init.body)) as unknown);
    expect(bodies).toEqual([
      { shade: { positions: { posKind1: 1, position1: 65535 } } },
      { shade: { motion: 'stop' } },
      { shade: { positions: { posKind1: 1, position1: 0 } } },
    ]);
  });
});

describe('PowerViewHub shade queue priority', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // After Stop Shades, ten RF reads (about 3s each on a Gen 2 hub) sat in the
  // queue, and a close sent from HomeKit reached the hub 22s later.
  it('sends a move ahead of RF reads still waiting, after the one in flight', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((url: string) => Promise.resolve(hubResponse({ shade: { id: Number(/shades\/(\d+)/.exec(url)?.[1]) } })));
    vi.stubGlobal('fetch', fetchMock);
    const client = hub();

    const all = Promise.all([
      client.getShade(1, { refresh: true }),
      client.getShade(2, { refresh: true }),
      client.getShade(3, { refresh: true }),
      client.putShade(4, HubPosition.BOTTOM, 0, 0),
      client.stopShade(5),
    ]);
    await vi.advanceTimersByTimeAsync(5_000);
    await all;

    const sent = (fetchMock.mock.calls as unknown as [string, RequestInit?][])
      .map(([url, init]) => `${init?.method ?? 'GET'} ${new URL(url).pathname}`);
    expect(sent).toEqual([
      'GET /api/shades/1',
      'PUT /api/shades/4',
      'PUT /api/shades/5',
      'GET /api/shades/2',
      'GET /api/shades/3',
    ]);
  });
});

describe('PowerViewHub request priority', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('lets a write overtake reads already waiting in the queue', async () => {
    vi.useFakeTimers();

    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;

    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const label = init?.method === 'PUT' ? 'write' : `read:${/(\d+)$/.exec(url)?.[1] ?? '?'}`;
      order.push(label);
      const body = { shade: { id: 1, name: 'U2hhZGU=' } };
      const respond = () => (hubResponse(body, 200, 'application/json'));
      if (order.length === 1) {
        // Hold the first request open so the rest pile up behind it.
        return new Promise((resolve) => {
          releaseFirst = () => resolve(respond());
        });
      }
      return Promise.resolve(respond());
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = hub();
    const first = client.getShade(1);
    await vi.advanceTimersByTimeAsync(10);

    // Both queue while the first request is still in flight. HomeKit's write
    // must not wait behind a background read.
    const queuedRead = client.getShade(2);
    const write = client.putShade(3, HubPosition.BOTTOM, 49151, 75);
    await vi.advanceTimersByTimeAsync(200);

    releaseFirst?.();
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.all([first, queuedRead, write]);

    expect(order).toEqual(['read:1', 'write', 'read:2']);
  });
});

describe('PowerViewHub transient failures', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('retries a dropped connection instead of losing the command', async () => {
    vi.useFakeTimers();
    // A gen1 hub drops TCP connections while its radio is transmitting. Losing
    // the request means the shade never moves at all.
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(hubResponse(({ shade: { id: 1, name: 'U2hhZGU=' } }), 200, 'application/json'));
    vi.stubGlobal('fetch', fetchMock);

    const request = hub().putShade(1, HubPosition.BOTTOM, 49151, 75);
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(request).resolves.toMatchObject({ id: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after exhausting retries', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    const request = hub().requestJson('http://127.0.0.1/api/shades/1');
    const assertion = expect(request).rejects.toSatisfy(
      (err: unknown) => isHubError(err) && err.code === HubErrorCode.Unreachable,
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('PowerViewHub scenes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('lists scenes defined on the hub', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(hubResponse({
      sceneIds: [7],
      sceneData: [{ id: 7, name: 'Q2xvc2VkArt', roomId: 3 }],
    })));

    const request = hub().getScenes();
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(request).resolves.toEqual({
      sceneIds: [7],
      sceneData: [{ id: 7, name: 'Q2xvc2VkArt', roomId: 3 }],
    });
  });

  it('activates a scene by id, at write priority', async () => {
    vi.useFakeTimers();
    // Captured from a build 827 hub: the moved shades are nested under `scene`.
    const fetchMock = vi.fn().mockResolvedValue(hubResponse(({ scene: { shadeIds: [1, 2, 3] } }), 200, 'application/json'));
    vi.stubGlobal('fetch', fetchMock);

    const request = hub().activateScene(7);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(request).resolves.toEqual([1, 2, 3]);
    expect(String(fetchMock.mock.calls[0][0])).toContain('sceneId=7');
  });

  it('reports an unknown shade count when the hub omits one', async () => {
    vi.useFakeTimers();
    // Treating a missing shadeIds as an empty list logged "activated
    // (0 shade(s))" while five shades were moving.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(hubResponse(({ scene: { id: 7 } }), 200, 'application/json')));

    const request = hub().activateScene(7);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(request).resolves.toBeUndefined();
  });
});

describe('PowerViewHub response limits', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('refuses a response larger than the cap instead of buffering it', async () => {
    // A hostile or malfunctioning hub returning an unbounded body would
    // otherwise be read entirely into memory, taking the whole Homebridge
    // process down with it — every other plugin included.
    const huge = 'x'.repeat(3 * 1024 * 1024);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(hubResponse({ junk: huge })));

    await expect(hub().requestJson('http://127.0.0.1/api/shades')).rejects.toSatisfy(
      (err: unknown) => isHubError(err) && err.code === HubErrorCode.ResponseTooLarge,
    );
  });

  it('rejects on a declared content-length over the cap without reading', async () => {
    const body = JSON.stringify({ ok: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-length': String(50 * 1024 * 1024),
      },
    })));

    await expect(hub().requestJson('http://127.0.0.1/api/shades')).rejects.toSatisfy(
      (err: unknown) => isHubError(err) && err.code === HubErrorCode.ResponseTooLarge,
    );
  });

  it('reports malformed JSON as such, not as an unreachable hub', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"shade": ', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    await expect(hub().requestJson('http://127.0.0.1/api/shades')).rejects.toSatisfy(
      (err: unknown) => isHubError(err) && err.code === HubErrorCode.MalformedBody,
    );
  });

  it('still reads an ordinary response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(hubResponse({ shadeData: [{ id: 1 }] })));
    const res = await hub().requestJson<{ shadeData: Array<{ id: number }> }>(
      'http://127.0.0.1/api/shades',
    );
    expect(res.data?.shadeData).toEqual([{ id: 1 }]);
  });
});

describe('PowerViewHub.setHubColor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('PUTs only the color to /api/userdata and returns what the hub stored', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(hubResponse({
      userData: { hubName: 'SHVi', serialNumber: 'abc', color: { red: 0, green: 0, blue: 0, brightness: 0 } },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = hub().setHubColor({ red: 0, green: 0, blue: 0, brightness: 0 });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await pending).toEqual({ red: 0, green: 0, blue: 0, brightness: 0 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1/api/userdata');
    expect(init.method).toBe('PUT');
    // The hub merges this into its settings; sending anything else would overwrite it.
    expect(JSON.parse(String(init.body))).toEqual({ userData: { color: { red: 0, green: 0, blue: 0, brightness: 0 } } });
  });

  it('returns undefined when the hub accepts the change but echoes no color', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(hubResponse({ userData: { hubName: 'SHVi', serialNumber: 'abc' } })));

    const pending = hub().setHubColor({ red: 0, green: 0, blue: 255, brightness: 20 });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await pending).toBeUndefined();
  });
});
