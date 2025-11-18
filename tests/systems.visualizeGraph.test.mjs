import { assert, test } from './testlib.js';

import { registerSystem, Systems } from '../systems.js';

test('Systems.visualizeGraph emits DOT output for multiple phases', (t) => {
  function alpha() {}
  function beta() {}
  function gamma() {}
  function delta() {}
  function epsilon() {}
  function zeta() {}
  function chi() {}
  function eta() {}
  function theta() {}
  function iota() {}
  function omega() {}
  function phi() {}
  function kappa() {}
  function lambda() {}
  function mu() {}
  
  const firstPhase = 'vizPhase';
  const secondPhase = 'anotherPhase';
  const thirdPhase = 'thirdPhase';
  const fourthPhase = 'cleanupPhase';

  // Phase 1: mixed before/after and implicit ordering
  registerSystem(alpha, firstPhase, { before: [beta, chi] });
  registerSystem(beta, firstPhase, { after: [omega] });
  registerSystem(chi, firstPhase, { after: [beta] });
  registerSystem(omega, firstPhase, { before: [alpha] });

  // Phase 2: explicit order plus before/after edges that cross that order
  registerSystem(phi, secondPhase, { before: [delta], after: [gamma] });
  registerSystem(delta, secondPhase, { before: [epsilon] });
  registerSystem(epsilon, secondPhase);
  registerSystem(gamma, secondPhase, { after: [delta] });
  Systems.phase(secondPhase).order(phi, delta, epsilon, gamma);

  // Phase 3: four nodes with multiple chains
  registerSystem(eta, thirdPhase, { before: [theta] });
  registerSystem(zeta, thirdPhase, { before: [iota], after: [eta] });
  registerSystem(theta, thirdPhase, { after: [zeta] });
  registerSystem(iota, thirdPhase, { after: [theta] });

  // Phase 4: explicit order with before/after mixing into it
  registerSystem(mu, fourthPhase, { before: [kappa, lambda] });
  registerSystem(kappa, fourthPhase);
  registerSystem(lambda, fourthPhase, { after: [kappa] });
  Systems.phase(fourthPhase).order(mu, kappa, lambda);

  t.after(() => {
    Systems.phase(firstPhase).clear();
    Systems.phase(secondPhase).clear();
    Systems.phase(thirdPhase).clear();
    Systems.phase(fourthPhase).clear();
  });

  const dot = Systems.visualizeGraph({ phase: [firstPhase, secondPhase, thirdPhase, fourthPhase] });
    
  assert.match(dot, /digraph Systems/);
  assert.match(dot, /cluster_vizPhase/);
  assert.match(dot, /vizPhase_0/);
  assert.match(dot, /vizPhase_1/);
  assert.match(dot, /vizPhase_2/);
  assert.match(dot, /vizPhase_3/);
  assert.match(dot, /cluster_anotherPhase/);
  assert.match(dot, /anotherPhase_0/);
  assert.match(dot, /anotherPhase_1/);
  assert.match(dot, /anotherPhase_2/);
  assert.match(dot, /anotherPhase_3/);
  assert.match(dot, /cluster_thirdPhase/);
  assert.match(dot, /thirdPhase_0/);
  assert.match(dot, /thirdPhase_1/);
  assert.match(dot, /thirdPhase_2/);
  assert.match(dot, /thirdPhase_3/);
  assert.match(dot, /cluster_cleanupPhase/);
  assert.match(dot, /cleanupPhase_0/);
  assert.match(dot, /cleanupPhase_1/);
  assert.match(dot, /cleanupPhase_2/);

  // Highlights: plain labels, constraints should be represented by dotted edges instead
  assert.match(dot, /"vizPhase_0" \[label="omega"\]/);
  assert.match(dot, /"vizPhase_1" \[label="alpha"\]/);
  assert.match(dot, /"vizPhase_2" \[label="beta"\]/);
  assert.match(dot, /"vizPhase_3" \[label="chi"\]/);
  assert.match(dot, /"anotherPhase_0" \[label="phi"\]/);
  assert.match(dot, /"anotherPhase_3" \[label="gamma"\]/);

  // Only order edges within phases (solid)
  assert.match(dot, /vizPhase_0" -> "vizPhase_1" \[label="order"\]/);
  assert.match(dot, /vizPhase_1" -> "vizPhase_2" \[label="order"\]/);
  assert.match(dot, /vizPhase_2" -> "vizPhase_3" \[label="order"\]/);
  assert.match(dot, /anotherPhase_0" -> "anotherPhase_1" \[label="order"\]/);
  assert.match(dot, /anotherPhase_1" -> "anotherPhase_2" \[label="order"\]/);
  assert.match(dot, /anotherPhase_2" -> "anotherPhase_3" \[label="order"\]/);
  assert.match(dot, /thirdPhase_0" -> "thirdPhase_1" \[label="order"\]/);
  assert.match(dot, /thirdPhase_1" -> "thirdPhase_2" \[label="order"\]/);
  assert.match(dot, /thirdPhase_2" -> "thirdPhase_3" \[label="order"\]/);
  assert.match(dot, /cleanupPhase_0" -> "cleanupPhase_1" \[label="order"\]/);
  assert.match(dot, /cleanupPhase_1" -> "cleanupPhase_2" \[label="order"\]/);

  // Constraint edges (dotted lines)
  assert.match(dot, /vizPhase_2" -> "vizPhase_1" \[label="before", style="dotted", color="gray50", constraint=false, arrowhead="lvee", arrowsize=0.8\]/);
  assert.match(dot, /vizPhase_3" -> "vizPhase_1" \[label="before", style="dotted", color="gray50", constraint=false, arrowhead="lvee", arrowsize=0.8\]/);
  assert.match(dot, /vizPhase_1" -> "vizPhase_0" \[label="before", style="dotted", color="gray50", constraint=false, arrowhead="lvee", arrowsize=0.8\]/);
  assert.match(dot, /vizPhase_2" -> "vizPhase_0" \[label="after", style="dotted", color="gray50", constraint=false, arrowhead="lvee", arrowsize=0.8\]/);
  assert.match(dot, /vizPhase_3" -> "vizPhase_2" \[label="after", style="dotted", color="gray50", constraint=false, arrowhead="lvee", arrowsize=0.8\]/);
  assert.match(dot, /anotherPhase_1" -> "anotherPhase_0" \[label="before", style="dotted", color="gray50", constraint=false, arrowhead="lvee", arrowsize=0.8\]/);
  assert.match(dot, /anotherPhase_2" -> "anotherPhase_1" \[label="before", style="dotted", color="gray50", constraint=false, arrowhead="lvee", arrowsize=0.8\]/);
  assert.match(dot, /anotherPhase_3" -> "anotherPhase_1" \[label="after", style="dotted", color="gray50", constraint=false, arrowhead="lvee", arrowsize=0.8\]/);
  assert.match(dot, /anotherPhase_0" -> "anotherPhase_3" \[label="after", style="dotted", color="gray50", constraint=false, arrowhead="lvee", arrowsize=0.8\]/);
  assert.match(dot, /thirdPhase_2" -> "thirdPhase_0" \[label="before", style="dotted", color="gray50", constraint=false, arrowhead="lvee", arrowsize=0.8\]/);
  assert.match(dot, /thirdPhase_3" -> "thirdPhase_1" \[label="before", style="dotted", color="gray50", constraint=false, arrowhead="lvee", arrowsize=0.8\]/);
  assert.match(dot, /thirdPhase_1" -> "thirdPhase_0" \[label="after", style="dotted", color="gray50", constraint=false, arrowhead="lvee", arrowsize=0.8\]/);
  assert.match(dot, /thirdPhase_2" -> "thirdPhase_1" \[label="after", style="dotted", color="gray50", constraint=false, arrowhead="lvee", arrowsize=0.8\]/);
  assert.match(dot, /thirdPhase_3" -> "thirdPhase_2" \[label="after", style="dotted", color="gray50", constraint=false, arrowhead="lvee", arrowsize=0.8\]/);
  assert.match(dot, /cleanupPhase_1" -> "cleanupPhase_0" \[label="before", style="dotted", color="gray50", constraint=false, arrowhead="lvee", arrowsize=0.8\]/);
  assert.match(dot, /cleanupPhase_2" -> "cleanupPhase_0" \[label="before", style="dotted", color="gray50", constraint=false, arrowhead="lvee", arrowsize=0.8\]/);
  assert.match(dot, /cleanupPhase_2" -> "cleanupPhase_1" \[label="after", style="dotted", color="gray50", constraint=false, arrowhead="lvee", arrowsize=0.8\]/);

  // Phase-to-phase connectors: last system -> first system of next phase
  assert.match(dot, /vizPhase_3" -> "anotherPhase_0" \[label="phase"\]/);
  assert.match(dot, /anotherPhase_3" -> "thirdPhase_0" \[label="phase"\]/);
  assert.match(dot, /thirdPhase_3" -> "cleanupPhase_0" \[label="phase"\]/);
});
