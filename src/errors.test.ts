import type { Logging } from 'homebridge';
import { describe, expect, it, vi } from 'vitest';

import { logError } from './errors.js';

describe('logError', () => {
  it('passes the message as an argument, so a % in a shade name is not a placeholder', () => {
    const log = { error: vi.fn() };
    logError(log as unknown as Logging, 'Background refresh failed for shade 7 (Bedroom %s):', 'fetch failed');
    expect(log.error).toHaveBeenCalledWith('%s %s', 'Background refresh failed for shade 7 (Bedroom %s):', 'fetch failed');
  });
});
