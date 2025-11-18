# Agents & ecs-js

`ecs-js` is written so autonomous agents, copilots, and other automated operators can understand and control simulations without fighting a game-engine stack. This document gives agents (and the humans piloting them) the context needed to reason about the runtime, stay deterministic, and iterate safely inside code-canvas or other tool-augmented environments. Think of it as the field manual that complements the API/source-of-truth in `README.md`—when you need signatures or conceptual deep dives, go there; when you need to keep the project humming, stay here.

## Principles for agents

### Why ecs-js works for agents
- **Deterministic core**: seeded RNG (`mulberry32`) plus deferred-safe mutations mean you can replay every tick exactly. Always pass a seed into `new World({ seed })` so your reasoning remains reproducible.
- **Caller-driven ticks**: you own the loop. Drive discrete steps (`world.tick(1)`) while inspecting state, or stream `dt` from real sensors for real-time sims. No hidden scheduler.
- **Phase-agnostic scripts**: declare whatever phases your workflow needs (`intent → resolve → effects`, `sense → plan → act`, etc.) and pin systems explicitly so an agent can narrate the order of operations.
- **Pure logic, zero IO**: there is no rendering, DOM, or async timing, so agents can manipulate worlds from CLIs, sandboxes, notebooks, or IDE workspaces without side effects.
- **Composable helpers**: builders like `World.create()` or `Systems.phase()` keep configuration declarative, which is easier for LLM-based editors to diff, patch, and explain.

### Step-and-explain workflow
1. `World.create()` or `new World()` with a fixed seed and store (`map` for clarity, `soa` for perf).
2. Install systems/queries with explicit names so you can reference them in explanations.
3. Tick once, inspect (`world.debug.inspect(id)`), log or assert what changed.
4. Repeat with updated inputs or events. Because ticks are synchronous, agents can pause between steps, regenerate code, and resume without drifting state.

```js
import { World, PHASE_SCRIPTS } from 'ecs-js/index.js'

const world = World.create({ seed: 42 })
  .withPhases('sense', 'plan', 'act', PHASE_SCRIPTS)
  .useScripts({ phase: PHASE_SCRIPTS })
  .system(senseSystem, 'sense')
  .system(planSystem, 'plan').after(senseSystem)
  .system(actSystem, 'act').after(planSystem)
  .build()

world.tick(1) // run a single, reviewable step
```

### Simulation modes & loops
- **Discrete / turn-based**: call `world.tick(1)` (or any scalar) manually after each planning phase. Ideal for reasoning sandboxes and roguelikes.
- **Realtime**: let the host compute `dt` (e.g., RAF delta, physics step) and pass it through `world.tick(dt)`. Systems stay pure; only the caller cares about wall time.
- **Scripted phases**: mix declarative schedulers with script adapters (`PHASE_SCRIPTS`, `world.script`) so an agent can inject behavior without editing core systems.
- **Hybrid**: run deterministic bursts (multiple ticks in a loop) between observable checkpoints to keep logs compact while still enabling rewind-friendly seeds.

### Code-canvas / realtime considerations
- Work in small, reviewable diffs so a supervising human can approve each change.
- Prefer scripted scenarios (tests under `tests/`) for regression detection; they double as narrated transcripts for other agents.
- For realtime loops, keep an outer host (browser, node, worker, etc.) responsible for timing and let the agent only manipulate systems/data. This separation keeps `ecs-js` deterministic even when the host is not.
- Use `world.emit` events for asynchronous inputs so agents can enqueue reactions without patching every system.

---

## Maintenance & usage playbook

The rest of this file is the dual-purpose cookbook: follow it to maintain the repository, and you will automatically be using the engine the way it was designed. Whenever you need API minutiae, pull them from `README.md` or the module in question; this playbook keeps things DRY by pointing at those sources rather than repeating them.

### Repository map (know where to edit)
- `README.md` — design principles, terminology, and usage narrative. Update this first when behavior shifts so humans and agents stay aligned.
- `core.js` — `World`, components, entity helpers, RNG glue. Primary import surface for agents wiring bespoke worlds.
- `systems.js` — declarative system registry + scheduler helpers (`Systems`, `registerSystem`, `composeScheduler`).
- `scripts.js` / `scriptsPhasesExtra.js` — built-in script adapters, refs, and phase presets (used by `World.create().useScripts()`).
- `adapters/` — optional integration helpers (script router, timeline utilities). Scan when bridging to external tools.
- `hierarchy.js` / `crossWorld.js` — parenting helpers and cross-world references for multi-scene orchestration.
- `archetype.js` — prefab builder APIs (`defineArchetype`, `Archetype()` fluent). Useful when agents need to batch-spawn entities.
- `tests/` — deterministic transcripts. Add scenario files here so future agents can replay and diff. Run with `deno test --allow-read tests/`.
- `demo/` — runnable sandboxes that double as reality checks for API additions.

### Daily maintenance loop
1. **Boot a deterministic playground**
   - Pick a store (`map` for clarity, `soa` for perf) and seed.
   - Declare phases you can cite in PR/commit summaries (e.g., `"sense"`, `"think"`, `"act"`).
   - Register systems explicitly (`world.system(fn, 'phase')` or `Systems.phase('phase').add(fn)`), mirroring the patterns documented in `README.md`.
2. **Instrument a scenario before editing**
   - Snapshot entity state via `world.debug.inspect(id)` before/after ticks.
   - Emit events (`world.emit('damage', payload)`) to simulate inputs without editing every system.
   - Route events to entities with `makeScriptRouter` when a script-per-entity pattern fits; document the route map near the system registration.
3. **Make surgical changes**
   - Define components/tags in isolated modules so diffs remain scoped.
   - Use archetypes for repeatable spawn logic; commit both definition and usage for end-to-end traceability.
   - When touching schedulers, show the intended order in prose (or include `Systems.visualizeGraph()` output) so the next agent can reason about causality quickly.
4. **Regressions & transcripts**
   - Drop focused repros inside `tests/` (plain JS modules are fine; `node tests/<file>.js` keeps them executable without build tooling).
   - Capture expected diffs (logs/asserts) so other agents can verify behavior without re-deriving context.
   - Mention test entry points in commit messages or PR notes (e.g., “repro: `node tests/turn-order.js`”).

### Runtime instrumentation & safety
- Enable `debug` mode to unlock `.inspect`, `.forget`, and per-entity change logs. Leave hooks in place—when disabled they are zero-cost.
- Use `world.on` / `world.emit` for synchronous event routing; pair with script routers for entity-targeted signals.
- Serialize or clone worlds with `serialization.js` helpers when an agent needs to branch scenarios in parallel sandboxes.
- Leverage `hierarchy.js` (`attach`, `children`, `destroySubtree`) to reason about parent/child lifecycles when modeling GUIs, squads, or nested objects.
- Never mutate component schemas at runtime; define them once per module so references stay stable.
- Remember to `destroySubtree` or `world.destroy(id)` when cleaning up spawned entities to avoid phantom references.
- When collaborating with other agents, agree on phase names and seeds to avoid divergent worlds.
- Document any non-default scheduler orderings or script routers in comments/commits so the next agent can reconstruct the control flow.
- Prefer additive diffs over rewrites; when removal is required, mention why in the commit/DX log to preserve shared mental models.

### Documentation & release hygiene
- Update `README.md` whenever new capabilities or terminology are introduced—that is the public contract.
- Mirror significant changes here in `AGENTS.md` only when the maintenance workflow needs to adjust; otherwise link to the README section to avoid DRY breaks.
- Keep `AGENTS.md` close to reality by noting new maintenance rituals (e.g., “run `node tests/foo.js` before touching `scripts.js`”).
- Tag alpha/beta releases only after replaying key demos under identical seeds. Document the seeds in `CHANGELOG` or release notes so agents can cross-check quickly.

Happy sim-building!
