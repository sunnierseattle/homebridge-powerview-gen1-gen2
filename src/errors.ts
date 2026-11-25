import type { Logging } from 'homebridge';

import type { HubUserData } from './powerviewHub.js';

export enum HubErrorCode {
  /** Hub sent more than the plugin is willing to buffer. */
  ResponseTooLarge = 'ResponseTooLarge',
  /** Hub sent JSON that does not parse. */
  MalformedBody = 'MalformedBody',
  Unreachable = 'Unreachable',
  Timeout = 'Timeout',
  HttpError = 'HttpError',
  Maintenance = 'Maintenance',
  NotFound = 'NotFound',
  BadRequest = 'BadRequest',
  EmptyBody = 'EmptyBody',
}

export class HubError extends Error {
  readonly name = 'HubError';

  constructor(
    message: string,
    public readonly code: HubErrorCode,
    public readonly status?: number,
    public readonly userData?: HubUserData,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export function isHubError(error: unknown): error is HubError {
  return error instanceof HubError;
}

export function isRetryableHubError(error: unknown): boolean {
  return isHubError(error) && error.code === HubErrorCode.Maintenance;
}

/**
 * Formats an unknown thrown value for log output (message and stack when available).
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

/**
 * Logs an error with a message prefix using Homebridge's logging API.
 *
 * The message is an argument, not the format string: it can carry a shade or
 * scene name, and a name with `%s` in it would otherwise be read as a placeholder.
 */
export function logError(log: Logging, message: string, error: unknown): void {
  log.error('%s %s', message, formatError(error));
}
