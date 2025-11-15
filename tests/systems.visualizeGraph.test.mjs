import { test } from 'node:test';
import assert from 'node:assert/strict';

import { registerSystem, Systems } from '../systems.js';

test('Systems.visualizeGraph emits DOT output for a phase', (t) => {
  function alpha() {}
  function beta() {}
  const phase = 'vizPhase';
  registerSystem(alpha, phase, { before: [beta] });
  registerSystem(beta, phase);
  t.after(() => Systems.phase(phase).clear());

  const dot = Systems.visualizeGraph({ phase });
  assert.match(dot, /digraph Systems/);
  assert.match(dot, /cluster_vizPhase/);
  assert.match(dot, /vizPhase_0/);
  assert.match(dot, /vizPhase_1/);
  assert.match(dot, /before/);
});
