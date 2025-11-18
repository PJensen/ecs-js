import { assert, test } from './testlib.js';

import { RafLoop, createRealtimeRafLoop } from '../adapters/raf-adapters.js';

function makeWorld() {
  const dts = [];
  return {
    tick(dt) {
      dts.push(dt);
    },
    dts
  };
}

test('RafLoop builder wires hooks and stats aliases', () => {
  const world = makeWorld();
  const callbacks = [];
  const request = (cb) => { callbacks.push(cb); return callbacks.length; };
  const cancelled = [];
  const cancel = (id) => { cancelled.push(id); };

  let before = 0;
  let stepCalls = 0;
  let render = 0;
  let frames = 0;

  const loop = RafLoop.realtime(world)
    .raf(request, cancel)
    .timeSource(() => 0)
    .before(() => { before += 1; })
    .step(() => { stepCalls += 1; })
    .render(() => { render += 1; })
    .onFrame(() => { frames += 1; })
    .start();

  assert.equal(callbacks.length, 1);
  callbacks[0](1000);
  loop.stop();

  assert.ok(before >= 1);
  assert.ok(stepCalls >= 1);
  assert.ok(render >= 1);
  assert.ok(frames >= 1);
  assert.equal(cancelled.length >= 1, true);

  const stats = loop.getStats();
  assert.equal(stats.frameCount, stats.rafFrame);
  assert.equal(stats.fps, stats.fpsEMA);
});

test('createRealtimeRafLoop exposes traditional API', () => {
  const world = makeWorld();
  const loop = createRealtimeRafLoop({
    world,
    request: (cb) => { cb(0); return 1; },
    cancel: () => {}
  });
  loop.stop();
  assert.equal(typeof loop.start, 'function');
});
