import { readFile } from 'node:fs/promises';

import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils';

import { formatError, isHubError } from './errors.js';
import { PowerViewHub } from './powerviewHub.js';
import { consoleLogging, hubHostFromConfig, quietHoursOffTheOldWay, ShadeTools } from './shadeTools.js';

/**
 * Server half of the shade tools page. Config UI X starts it when the plugin's
 * settings open and stops it when they close; homebridge-ui/server.js loads it.
 */
class PowerViewUiServer extends HomebridgePluginUiServer {
  private tools?: Promise<ShadeTools>;

  constructor() {
    super();
    this.route('/hubinfo', (tools) => tools.hubInfo());
    this.route('/shades', (tools) => tools.shades());
    this.route('/check', (tools, payload) => tools.check(payload));
    this.route('/motion', (tools, payload) => tools.motion(payload));
    this.route('/scenes', (tools) => tools.scenes());
    this.route('/activateScene', (tools, payload) => tools.activateScene(payload));
    this.route('/hubLight', async (tools, payload) => ({ light: await tools.setLight(payload) }));
    this.onRequest('/quietHoursOffTheOldWay', async () => ({ off: quietHoursOffTheOldWay(await this.savedConfig()) }));
    this.ready();
  }

  private route(path: string, handler: (tools: ShadeTools, payload: unknown) => Promise<unknown>): void {
    this.onRequest(path, async (payload: unknown) => {
      try {
        return await handler(await this.getTools(), payload) as Record<string, unknown>;
      } catch (err) {
        // The message goes to a toast in the page; the stack goes to the log.
        console.log('PowerView tools: %s failed: %s', path, formatError(err));
        const message = err instanceof Error ? err.message : String(err);
        throw new RequestError(message, { status: isHubError(err) ? err.status ?? 502 : 500 });
      }
    });
  }

  /** Built once per session from the saved config, so a changed host needs the page reopened. */
  private getTools(): Promise<ShadeTools> {
    this.tools ??= (async () => {
      const host = hubHostFromConfig(await this.savedConfig());
      // stdout reaches the Homebridge log: Config UI X forks this server and
      // logs each line as "[Homebridge UI] [homebridge-powerview-gen1-gen2] ...".
      const log = consoleLogging('PowerView tools');
      return new ShadeTools(new PowerViewHub(log, host), host, log);
    })();
    return this.tools;
  }

  /** config.json as saved on disk, or undefined if it can't be read. */
  private async savedConfig(): Promise<unknown> {
    try {
      return this.homebridgeConfigPath
        ? JSON.parse(await readFile(this.homebridgeConfigPath, 'utf8'))
        : undefined;
    } catch (err) {
      console.log('PowerView tools: could not read config.json (%s); using defaults', formatError(err));
      return undefined;
    }
  }
}

export function startUiServer(): PowerViewUiServer {
  return new PowerViewUiServer();
}
