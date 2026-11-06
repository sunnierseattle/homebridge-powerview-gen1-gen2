import type { Logging } from 'homebridge';

import { HubErrorCode, HubError } from './errors.js';
import { HubPosition, type PowerViewHub, type PowerViewShade } from './powerviewHub.js';
import {
  batteryStrengthToPercent,
  decodeBase64Name,
  formatShadeFirmware,
  parsePositionMap,
  resolveHubHost,
  resolveQuietHours,
} from './shadeUtils.js';
import { PLATFORM_NAME } from './settings.js';

/**
 * Backs the shade tools page in the Homebridge UI (homebridge-ui/).
 *
 * The page exists for the jobs that otherwise need the PowerView app: asking a
 * shade over RF where it really is, jogging it to prove the radio and motor
 * answer, and recalibrating its limits after it has lost them. Everything goes
 * through PowerViewHub, so the page gets the same timeouts, retries and request
 * spacing as the plugin itself.
 */

export type ShadeMotion = 'jog' | 'calibrate';

export interface ToolPosition {
  kind: HubPosition;
  raw: number;
  percent: number;
}

export interface ToolShade {
  id: number;
  name: string;
  type?: number;
  firmware?: string;
  timedOut: boolean;
  /** 4 is mains power; the hub reports a voltage even for hardwired shades. */
  batteryStatus?: number;
  batteryPercent?: number;
  positions: ToolPosition[];
}

export interface ToolScene {
  id: number;
  name: string;
  members: Array<{ shadeId: number; positions: ToolPosition[] }>;
}

/** Vanes run 0-32767 on these hubs; the rails run 0-65535. */
function toPercent(kind: HubPosition, raw: number): number {
  const full = kind === HubPosition.VANES ? 32767 : 65535;
  return Math.max(0, Math.min(100, Math.round(raw / full * 100)));
}

export function toolPositions(positions: PowerViewShade['positions']): ToolPosition[] {
  if (!positions) {
    return [];
  }
  return Object.entries(parsePositionMap(positions))
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .map(([kind, raw]) => ({ kind: Number(kind) as HubPosition, raw, percent: toPercent(Number(kind), raw) }));
}

export function toolShade(shade: PowerViewShade): ToolShade {
  return {
    id: shade.id,
    name: decodeBase64Name(shade.name, `Shade ${shade.id}`),
    type: shade.type,
    firmware: formatShadeFirmware(shade.firmware),
    timedOut: shade.timedOut === true,
    batteryStatus: shade.batteryStatus,
    batteryPercent: batteryStrengthToPercent(shade.batteryStrength),
    positions: toolPositions(shade.positions),
  };
}

/** A positive integer id from the page, or a 400. Never trusted as-is. */
export function requireId(payload: unknown): number {
  const id = Number((payload as { id?: unknown } | null)?.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HubError('Missing or invalid id', HubErrorCode.BadRequest, 400);
  }
  return id;
}

export function requireMotion(payload: unknown): ShadeMotion {
  const motion = (payload as { motion?: unknown } | null)?.motion;
  if (motion !== 'jog' && motion !== 'calibrate') {
    throw new HubError(`Unsupported motion: ${String(motion)}`, HubErrorCode.BadRequest, 400);
  }
  return motion;
}

/**
 * The hub host for the page, from this plugin's platform block in config.json.
 *
 * Read on the server, never taken from the browser, so the page cannot be
 * pointed at an arbitrary host. Same validation as the plugin.
 */
export function hubHostFromConfig(config: unknown, fallback = 'powerview-hub.local'): string {
  const platforms = (config as { platforms?: unknown } | null)?.platforms;
  if (!Array.isArray(platforms)) {
    return fallback;
  }
  const block = platforms.find((p) => (p as { platform?: unknown } | null)?.platform === PLATFORM_NAME) as
    { host?: unknown } | undefined;
  return resolveHubHost(typeof block?.host === 'string' ? block.host : undefined, fallback);
}

/**
 * True when the saved config turns quiet hours off the way it was done before
 * the Quiet hours checkbox: `false`, or the same hour twice. The settings form
 * shows both as ticked, so the page unticks the box for them.
 */
export function quietHoursOffTheOldWay(config: unknown): boolean {
  const platforms = (config as { platforms?: unknown } | null)?.platforms;
  if (!Array.isArray(platforms)) {
    return false;
  }
  const block = platforms.find((p) => (p as { platform?: unknown } | null)?.platform === PLATFORM_NAME) as
    { quietHours?: unknown } | undefined;
  if (!block || block.quietHours === undefined) {
    return false;
  }
  const quiet = block.quietHours as { enabled?: unknown } | false;
  if (quiet && quiet.enabled === false) {
    return false;
  }
  const { startHour, endHour } = resolveQuietHours(block as Parameters<typeof resolveQuietHours>[0]);
  return startHour === endHour;
}

/** Routes plugin log calls to the UI server's stdout, which Config UI X shows. */
export function consoleLogging(prefix: string): Logging {
  const line = (level: string) => (message: string, ...params: unknown[]) => {
    console.log(`[${prefix}] ${level}: ${message}`, ...params);
  };
  const log = line('info') as Logging;
  Object.assign(log, {
    prefix,
    info: line('info'),
    success: line('info'),
    warn: line('warn'),
    error: line('error'),
    debug: () => undefined,
    log: (level: string, message: string, ...params: unknown[]) => line(level)(message, ...params),
  });
  return log;
}

export class ShadeTools {
  /** Scene names from the last scenes() call, for the activation log line. */
  private readonly sceneNames = new Map<number, string>();

  /**
   * Every action that wakes a motor logs one info line, so a shade moving
   * unexpectedly can be traced to this page. Failures are logged by the caller.
   */
  constructor(
    private readonly hub: PowerViewHub,
    private readonly host: string,
    private readonly log: Logging,
  ) {}

  async hubInfo(): Promise<{ host: string; name: string; firmware?: string }> {
    const userData = await this.hub.getUserData();
    const main = userData.firmware?.mainProcessor;
    return {
      host: this.host,
      name: decodeBase64Name(userData.hubName, 'PowerView Hub'),
      firmware: main && typeof main.build === 'number'
        ? `${main.name ?? 'hub'} ${main.revision}.${main.subRevision}.${main.build}`
        : undefined,
    };
  }

  async shades(): Promise<ToolShade[]> {
    return (await this.hub.getShades()).map(toolShade).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** A real RF round-trip: the one read that says where the motor actually is. */
  async check(payload: unknown): Promise<ToolShade> {
    const shade = toolShade(await this.hub.getShade(requireId(payload), { refresh: true }));
    this.log.info('check sent to shade %d (%s)%s', shade.id, shade.name, shade.timedOut ? ': radio timed out' : '');
    return shade;
  }

  async motion(payload: unknown): Promise<ToolShade> {
    const id = requireId(payload);
    const motion = requireMotion(payload);
    const shade = toolShade(motion === 'jog' ? await this.hub.jogShade(id) : await this.hub.calibrateShade(id));
    this.log.info('%s sent to shade %d (%s)', motion, id, shade.name);
    return shade;
  }

  async scenes(): Promise<ToolScene[]> {
    const { sceneData } = await this.hub.getScenes();
    const scenes: ToolScene[] = [];
    // One request per scene, sequentially: the hub answers one at a time.
    for (const scene of sceneData) {
      const members = await this.hub.getSceneMembers(scene.id);
      const name = decodeBase64Name(scene.name, `Scene ${scene.id}`);
      this.sceneNames.set(scene.id, name);
      scenes.push({
        id: scene.id,
        name,
        members: members.map((m) => ({ shadeId: m.shadeId, positions: toolPositions(m.positions) })),
      });
    }
    return scenes.sort((a, b) => a.name.localeCompare(b.name));
  }

  async activateScene(payload: unknown): Promise<{ shadeIds: number[] }> {
    const id = requireId(payload);
    const shadeIds = (await this.hub.activateScene(id)) ?? [];
    this.log.info('scene %d (%s) activated, moving shades %s',
      id, this.sceneNames.get(id) ?? 'unknown name', shadeIds.length ? shadeIds.join(', ') : 'none reported');
    return { shadeIds };
  }
}
