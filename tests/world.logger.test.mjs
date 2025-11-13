import { test } from 'node:test';
import assert from 'node:assert/strict';

import { World } from '../core.js';
import { composeScheduler, Systems } from '../systems.js';

function makeLogger() {
  const calls = [];
  const logger = {
    info: () => {},
    warn: () => {},
    error: (...args) => { calls.push(args); },
    debug: () => {}
  };
  return { logger, calls };
}

test('world routes system errors through the configured logger', (t) => {
  const { logger, calls } = makeLogger();
  const world = new World({ logger });
  const phase = 'loggerPhase';
  world.system(() => { throw new Error('boom'); }, phase);
  t.after(() => Systems.phase(phase).clear());
  world.setScheduler(composeScheduler(phase));
  world.tick(0);
  assert.equal(calls.length, 1);
  assert.match(String(calls[0][0]), /\[systems] error in phase "loggerPhase"/);
});

test('setLogger swaps logger implementation', () => {
  const world = new World();
  const messages = [];
  world.setLogger({
    info: () => {},
    warn: () => {},
    error: (...args) => messages.push(args),
    debug: () => {}
  });
  world.logger.error('custom');
  assert.equal(messages.length, 1);
  assert.equal(messages[0][0], 'custom');
});
