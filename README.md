# ECS.js 
Entity–Component–System architecture for JavaScript
Zero dependencies. No build step. Deterministic, phase-agnostic, and caller-driven — your loop, your rules.

Purpose-built for agents of all kinds — from autonomous copilots to code-canvas assistants — so they can reason about worlds step-by-step while driving real-time or discrete simulations with confidence.

Suitable for both discrete-event and real-time updates.

`ecs-js` is a minimal, browser-friendly ECS core designed for simulations, roguelikes, and other logic-driven systems that demand determinism and composability, especially when agents need transparent, step-based control.

[Visit Built-in Demos](https://pjensen.github.io/ecs-js/)

---

## ✳️ Design Principles

**Caller-driven**
 You decide when and how often a tick runs — from discrete events to real-time loops.

**Phase-agnostic**
 Define your own lifecycle phases (`"intent"`, `"resolve"`, `"effects"`, etc.).

**Deterministic**
	Built-in seeded RNG (`mulberry32`) ensures reproducible runs. See `rng.js` helpers or import from `ecs-js/index.js`.

**Deferred-safe**
 Structural mutations during iteration are automatically queued.

**Store-flexible**
 `'map'` for clarity, `'soa'` for raw performance.

**Pure logic**
 No rendering or timing assumptions — plug into any UI, engine, or visualization layer.

**Ergonomic helpers**
 Optional builders (`World.create`, `world.script`, entity handles) keep advanced setups terse without hiding the underlying primitives.

---

## 🧩 Core Concepts

### World

```js
import { World } from 'ecs-js/core.js'
const world = new World({ seed: 12345, store: 'map' })
```

A `World` manages all entities, components, and systems.
Each call to `world.tick(dt)` advances the simulation deterministically by one step.

When you need to wire multiple phases, installers, or strict/debug tooling, reach for the fluent builder:

```js
import { World, PHASE_SCRIPTS } from 'ecs-js/index.js'

const world = World.create({ seed: 9 })
  .useSoA()
  .system(moveSystem, 'update')
  .withPhases('update', PHASE_SCRIPTS)   // ensure scheduler covers required phases
  .useScripts({ phase: PHASE_SCRIPTS })  // auto-install ScriptRef systems
  .withScheduler('update', PHASE_SCRIPTS)
  .onStrictError(ctx => ctx.defer())     // optional strict-mode policy
  .build()
```

`World.create()` collects options, systems, installers, and scheduler steps before producing a world. Mix and match `.useMap()/.useSoA()`, `.withSchedulerFn(fn)`, `.install(world => { ... })`, or `.enableStrict()` to keep setup declarative without hiding the primitives. You can still register systems later via `world.system(fn, 'phase')`.

`useScripts({ phase: 'update' })` lets you co-locate the built-in script systems inside an existing phase; omit the option to leave them under the default `scripts` phase.

---

### Components

```js
import { defineComponent, defineTag } from 'ecs-js/core.js'

export const Position = defineComponent('Position', { x: 0, y: 0 })
export const Velocity = defineComponent('Velocity', { dx: 0, dy: 0 })
export const Visible  = defineTag('Visible')
```

Components are pure data containers.
Tags are zero-data markers for boolean traits or group membership.

Prefer the fluent builder when you want validation or want to flip between data components and tags without changing call sites:

```js
import { Component } from 'ecs-js/core.js'

export const Velocity = Component('Velocity')
  .defaults({ dx: 0, dy: 0 })
  .validate(v => Number.isFinite(v.dx) && Number.isFinite(v.dy))
  .build()

export const Visible = Component('Visible').tag()
```

---

### Entities

```js
const e = world.create()
world.add(e, Position, { x: 10, y: 5 })
world.add(e, Velocity, { dx: 1, dy: 0 })
```

Entities are lightweight IDs with dynamically attached components.

---

### Queries

```js
for (const [id, pos, vel] of world.query(Position, Velocity)) {
  pos.x += vel.dx
  pos.y += vel.dy
}
```

Queries return iterable tuples.
Supports `Not(Comp)`, `Changed(Comp)`, and query options like `orderBy`, `limit`, and `offset`.

Each iterator also exposes `.run(fn)` (to execute a callback for every tuple) and `.count({ cheap })` when you just need the
cardinality.

#### Query Builder

Hoist frequently used queries — with baked-in filters or projections — via `world.defineQuery(...)`.

```js
const moving = world
  .defineQuery(Position, Velocity)
  .where((pos, vel) => Math.abs(vel.dx) + Math.abs(vel.dy) > 0)
  .orderBy((a, b) => a.id - b.id)

for (const [id, pos, vel] of moving()) {
  // executes with cached component lists + your filters
}

const projected = moving.project((pos, vel, id) => ({ id, vel }))
projected.run(({ id, vel }) => console.log(id, vel))
```

The builder returns an immutable handle; chaining `where`, `project`, `orderBy`, `offset`, or `limit` creates a new handle while
sharing the cached core query. Calling the handle executes the query immediately (optionally passing per-call overrides).
Comparators receive the cached row objects (`{ id, comps, p }`), so you can sort by entity id or by a projected value (`a.p`).
Handles also expose `.options()` for introspection and `.spec` for access to the normalized component set.

---

## ⚙️ Systems & Scheduling

Systems are pure functions operating over queries.
You register them under named phases and compose those phases into a scheduler.

```js
import { registerSystem, composeScheduler } from 'ecs-js/systems.js'

function moveSystem(world) {
  for (const [id, pos, vel] of world.query(Position, Velocity)) {
    world.set(id, Position, { x: pos.x + vel.dx, y: pos.y + vel.dy })
  }
}

registerSystem(moveSystem, 'update')
world.setScheduler(composeScheduler('update'))
world.tick(1)
```

Each phase name is arbitrary — you decide the lifecycle.
System order can be declared via `before` / `after` or pinned explicitly with `setSystemOrder`.

You can also skip the globals entirely and register straight off a world:

```js
world.system(moveSystem, 'update')   // internally pipes to registerSystem
```

For larger setups, use the fluent registry to keep dependency declarations next to the systems they affect:

```js
import { Systems } from 'ecs-js/systems.js'

Systems.phase('update')
  .add(moveSystem)
  .add(applyIntentSystem).after(moveSystem)
  .order(moveSystem, applyIntentSystem)

console.log(Systems.visualizeGraph({ phase: 'update' })) // DOT graph for quick sanity checks
```

`composeScheduler` happily mixes phase names and inline functions. The builder variant (`World.create().withScheduler(...)`) simply pre-populates those same steps before the world is built.

---

🛰️ Events, Messaging, & Routing

The world includes a built-in event bus for lightweight signaling between systems or external logic.

```js
// Subscribe
const unsubscribe = world.on('damage', (payload, world) => {
  console.log('damage event:', payload)
})

// Emit
world.emit('damage', { id: 1, amount: 10 })

// Unsubscribe
unsubscribe()
```


Events are synchronous and scoped per World.

Each listener receives (payload, world) arguments.

Useful for decoupling input handlers, UI triggers, or cross-system notifications.

For large worlds, route events to specific entities via the script router adapter. Provide a route map that selects the entity IDs that should receive a handler call:

```js
export const EXAMPLE_ROUTES = {
  use:     p => [p.targetId],
  drop:    p => [p.itemId],
};
```

`makeScriptRouter(routes)` wires each event name to a function that returns an array of entity IDs. When the event fires, any script handler named after the event (e.g. `use`, `drop`) runs on the matched entities. This keeps the global event bus efficient and expressive without manual lookup plumbing.

---

## 🛠️ Debugging

Every world ships with a `debug` facade. Opt in with `{ debug: true }` or toggle later via `world.enableDebug(true)` whenever you need visibility:

```js
const world = new World({ debug: true })

const snapshot = world.debug.inspect(entityId)
console.log(snapshot.components.Position.diff) // per-component change info

world.debug.forget(entityId) // drop retained history for that entity
```

Highlights:

- `debug.inspect(id)` stores the latest snapshot and diff per component so you can trace what changed across ticks. Snapshots include `alive`, `removed`, and per-component `changed` flags.
- `debug.forget(id)` discards the cached history for an entity so future inspections start fresh — handy for large worlds or long-running sessions.
- `world.enableDebug(false)` leaves the helper in place but stops capturing history until you re-enable it, keeping overhead out of release builds.

Inspection hooks are inert when debug mode is disabled, so you can leave calls in place without paying the cost at runtime.

---

## 🌳 Hierarchies

```js
import { attach, detach, children, destroySubtree } from 'ecs-js/hierarchy.js'

const parent = world.create()
const child  = world.create()
attach(world, child, parent)

for (const c of children(world, parent))
  console.log('child', c)

attach() prevents cycles automatically.
destroySubtree() is iterative to avoid recursion limits.
```

---

## 🌐 Cross-World References

```js
import { createCrossWorldReference, resolveCrossWorldReference } from 'ecs-js/crossWorld.js'

const ref = createCrossWorldReference(worldA, entityId)
const id = resolveCrossWorldReference(ref)
```

Enables entity references that remain valid across multiple `World` instances — ideal for multi-scene simulations or client/server worlds.
Works seamlessly with `world.isAlive(id)` (O(1) Set check).

---

## 🧱 Archetypes

Prefab-style entity definitions for repeatable or composite setups.

```js
import { defineArchetype, compose, createFrom, createMany, cloneFrom, Archetype } from 'ecs-js/archetype.js'

// --- Define a base archetype ---
export const MovingEntity = defineArchetype('MovingEntity',
  [Position, { x: 0, y: 0 }],
  [Velocity, { dx: 0, dy: 0 }],
  (world, id) => world.add(id, Visible)
)

// --- Compose from other archetypes ---
export const Player = compose('Player', MovingEntity, [Velocity, { dx: 1, dy: 0 }])

// --- Or build fluently ---
export const FluentPlayer = Archetype('Player')
  .include(MovingEntity)
  .add(Velocity, { dx: 1, dy: 0 })
  .build()

// --- Create entities from archetypes ---
const e = createFrom(world, Player)
const swarm = createMany(world, MovingEntity, 10, i => ({ x: i * 2, y: 0 }))
```

Supports composition, deferred creation (`createDeferred`), and parameterized overrides via `withOverrides()`.
Archetypes can nest, clone existing entities, or define reusable spawn logic.

---

## 💾 Serialization

```js
import { serializeWorld, deserializeWorld, makeRegistry } from 'ecs-js/serialization.js'

const reg = makeRegistry(Position, Velocity, Visible)
const snap = serializeWorld(world)
const clone = deserializeWorld(snap, reg, { World })
```

Serialization is schema-driven via a component registry, ensuring name-based round-tripping across runs.
Snapshots include metadata: seed, frame, store, and time.
Supports filters, partial exports, and append/replace modes.

---

## 🧠 System Ordering

```js
registerSystem(fn, phase, { before, after })
setSystemOrder(phase, [fnA, fnB])
```

Deterministic, topologically sorted order between systems within each phase.

---

## 🧱 Store Modes

* `'map'` – HashMap per component, simple and readable
* `'soa'` – Struct-of-Arrays, optimized for numeric and heavy iteration workloads

---

## 🎞️ RequestAnimationFrame Adapters

`adapters/raf-adapters.js` ships canonical loops for browser integrations:

* `createRealtimeRafLoop(options)` — advances simulation and presentation together, optionally clamping `dt`, smoothing FPS, and supporting fixed-step accumulators.
* `createDualLoopRafLoop(options)` — decouples rendering from simulation; queue or advance sim time manually while RAF drives the view layer.
* `createRafLoop({ mode: 'realtime' | 'dual-loop', ... })` — convenience factory that chooses between the two.

Both adapters accept `request`, `cancel`, and `now` overrides (for tests or custom hosts), surface immutable stats via `getStats()`, and expose lifecycle hooks (`beforeFrame`, `afterFrame`, `onAnimationFrame`, `onStats`). Each adapter returns a controller with `start()`, `stop()`, and helpers such as `advanceSim()`, `queueSimStep()`, and `resetStats()`.

Use them when you want a declarative RAF loop without rebuilding state tracking or worrying about accumulator drift. The manual example below remains for developers who prefer bespoke wiring.

---

## 🚀 Usage Examples

### 1. As a Git Submodule

```bash
git submodule add https://github.com/your-org/ecs-js.git lib/ecs-js
git commit -m "Add ecs-js as submodule"
```

### 2. Integrating ecs-js with requestAnimationFrame

This example connects a turn-based ECS world to a render loop using the browser’s native requestAnimationFrame.

The ECS remains deterministic and pure — rendering is handled externally.

```js
import { World, defineComponent } from '../core.js'
import { createRng } from '../rng.js'
import { registerSystem, composeScheduler } from '../systems.js'

// --- Components ---
const Position = defineComponent('Position', { x: 0, y: 0 })
const Velocity = defineComponent('Velocity', { dx: 0, dy: 0 })

// --- Systems ---
function moveSystem(world) {
  for (const [id, pos, vel] of world.query(Position, Velocity)) {
    pos.x += vel.dx
    pos.y += vel.dy
  }
}

function renderSystem(world) {
  const ctx = world.ctx
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.fillStyle = 'lime'
  for (const [id, pos] of world.query(Position)) {
    ctx.fillRect(pos.x, pos.y, 8, 8)
  }
}

// --- Setup ---
const canvas = document.createElement('canvas')
canvas.width = 320
canvas.height = 240
document.body.appendChild(canvas)

const world = new World({ seed: 1 })
// Optional: a separate RNG for gameplay logic outside of world.rand
const rng = createRng(1)
world.ctx = canvas.getContext('2d')

registerSystem(moveSystem, 'update')
registerSystem(renderSystem, 'render')
world.setScheduler(composeScheduler('update', 'render'))

// --- Entities ---
const e = world.create()
world.add(e, Position, { x: 10, y: 10 })
world.add(e, Velocity, { dx: 0.5, dy: 0.25 })

// --- Render Loop ---
let last = performance.now()
function frame(now) {
  const dt = (now - last) / 16.6667 // ~1 = 60fps
  last = now
  world.tick(dt)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
```

### 3. Serialization Example

```js
import { World, defineComponent, defineTag } from './core.js'
import { mulberry32 } from './rng.js'
import { serializeWorld, makeRegistry } from './serialization.js'

// Components (examples)
const Position = defineComponent('Position', { x: 0, y: 0 })
const Velocity = defineComponent('Velocity', { dx: 0, dy: 0 })
const Visible  = defineTag('Visible')

// Build a world with a couple entities
const world = new World({ seed: 1234 })
const e = world.create()
world.add(e, Position, { x: 10, y: 5 })
world.add(e, Velocity, { dx: 1, dy: 0 })
world.add(e, Visible)

// Create a registry so names round-trip
const reg = makeRegistry(Position, Velocity, Visible)

// Serialize the entire world
const snapshot = serializeWorld(world)

// Download helper
function downloadJSON(obj, filename = 'world-snapshot.json') {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}

// Trigger save
downloadJSON(snapshot)
```

---

## 🎛️ Scripting (First-class)

Add behavior to entities by attaching a ScriptRef that resolves to a small handler table. Core provides a default "scripts" phase and helpers for error reporting and optional extra phases.

### Quick start

```js
import { World } from './core.js'
import { registerSystem, composeScheduler } from './systems.js'
import { installScriptsAPI, ScriptRef, ScriptMeta, PHASE_SCRIPTS } from './scripts.js'

const world = installScriptsAPI(new World({ seed: 42 }))

// Register a script factory under an id
world.scripts.register('pulse', (world, eid, args) => {
  let t = 0
  return {
    onTick(w, id, dt, ctx) {
      t += dt
      if (t >= (args.period ?? 1)) {
        t = 0
        ctx.emit('pulse', { id, at: w.step })
      }
    },
    // You can add custom event-named handlers as well, e.g. on damage events
    damage(w, id, payload, ctx) { /* ... */ }
  }
})

// Create an entity and attach the script
const e = world.create()
world.add(e, ScriptRef, { id: 'pulse', args: { period: 3 } })

// Schedule the built-in scripts phase (you can mix with your other phases)
world.setScheduler(composeScheduler(PHASE_SCRIPTS))

world.on('pulse', p => console.log('PULSE', p))
world.tick(1); world.tick(1); world.tick(1) // emits once at step 3

// Diagnostics (last thrown error, count of ticks, attach version)
console.log(world.get(e, ScriptMeta))
```

### Fluent script registration & helpers

Wrap your script definitions in `world.script(id, configure)` to get builder-style ergonomics:

```js
world
  .script('pulse', (helper, _world, _eid, args) => {
    let elapsed = 0
    return helper
      .onTick((w, id, dt, ctx) => {
        elapsed += dt
        if (elapsed >= (args.period ?? 1)) {
          elapsed = 0
          ctx.emit('pulse', { id, at: w.step })
        }
      })
      .damage((w, id, payload, ctx) => ctx.emit('log', { id, text: `took ${payload.amount}` }))
  })
  .script('logger', {
    onTick(w, id, dt, ctx) { /* object literals work too */ }
  })

world.addScript(e, 'pulse', { period: 0.5 })
world.entity(e).addScript('logger')     // fluent entity handle
world.removeScript(e)                   // or world.entity(e).removeScript()
```

The helper exposes:

- `helper.on(name, fn)` or `helper.someHook(fn)` for named handlers (`onTick`, custom events, etc.).
- Arbitrary property access is proxied, so `helper.damage(fn)` is shorthand for `helper.on('damage', fn)` — any name you read turns into a handler registration function.
- `helper.use(factoryOrHandlers)` to compose other handler tables.
- Access to `helper.world`, `helper.entity`, and `helper.args` so you can stash local state.

`world.scripts.handlersOf(eid)` returns the sanitized handler table, `.refresh()` forces reattachment (useful after hot reloads), and `.clear()` resets the registry between tests. All helpers return the world so you can chain registrations inline with your setup.

Behavior contract: a script factory receives `(world, eid, args)` and returns an object whose function values are handlers. Special name `onTick` is called each scripts phase; other names can be invoked via the event router (see below).

Errors thrown by handlers are captured into `ScriptMeta.lastError`. Re-attaching a script (changing `ScriptRef`) resets `invoked` and updates `version` to `world.step`.

Handler tables are automatically cleaned up when an entity is destroyed or loses `ScriptRef`.

### Optional extra phases

You can define additional script phases and/or per-entity phase selection.

```js
import { addScriptTickPhase, ScriptPhase } from './scriptsPhasesExtra.js'
import { composeScheduler } from './systems.js'

// Add early/late phases that call optional hooks on handlers
addScriptTickPhase('scripts:early', 'onTickEarly')
addScriptTickPhase('scripts:late',  'onTickLate')

// Use them in your scheduler
world.setScheduler(composeScheduler('scripts:early', PHASE_SCRIPTS, 'scripts:late'))

// Per-entity: select which phase a script should tick in
world.add(e, ScriptPhase, { tick: 'scripts:early' })
```

Exceptions in extra phases are also recorded in `ScriptMeta.lastError`.

### Routing world events to handlers

Use the adapter to forward world events to handler functions named after the event.

```js
import { makeScriptRouter } from './adapters/scriptRouter.js'

// Route map: event name → function that returns target entity ids
const wire = makeScriptRouter({
  moved: (payload) => [payload.id],   // notify the moving entity
  damage: ({ targetId }) => [targetId]
})

wire(world) // registers listeners

// In your script factory, define functions named after events you care about:
world.scripts.register('reactive', () => ({
  damage(w, id, payload, ctx) {
    ctx.emit('log', { id, text: `took ${payload.amount}` })
  }
}))
```

If a routed handler throws, the error is recorded into `ScriptMeta.lastError` for that entity.

### Import paths

When used as a submodule, import directly from these files (as shown above) or from the barrel for convenience:

```js
// Barrel re-exports
import { installScriptsAPI, PHASE_SCRIPTS, addScriptTickPhase, makeScriptRouter } from './index.js'
```

---

## 🧠 Notes

* The ECS has no built-in `requestAnimationFrame`, so simulation remains deterministic and replayable (see [RequestAnimationFrame Adapters](#-requestanimationframe-adapters) if you want a ready-made loop).
* You control the time step (`dt`) passed to `world.tick(dt)`.
* Rendering is just another system phase (`'render'`), which can use WebGL, Canvas2D, or DOM updates.
* Works seamlessly with snapshot/replay systems — only the visual layer depends on real time.

---

## 📦 Install

```bash
git submodule add https://github.com/PJensen/ECS.js.git lib/ecs-js
git commit -m "Add ecs-js as submodule"
```

directly in the browser:

```html
<script type="module" src="ecs/core.js"></script>
```

---

## 📚 Module Reference

| File                      | Purpose                                                   |
| ------------------------- | --------------------------------------------------------- |
| **core.js**               | World + builder, debug/logging, components, queries, query builder |
| **systems.js**            | System registry, fluent phase builder, composition        |
| **hierarchy.js**          | Parent–child tree operations                              |
| **serialization.js**      | Snapshot, registry, deserialization                       |
| **crossWorld.js**         | Entity linking across worlds                              |
| **archetype.js**          | Prefab-style archetypes and reusable spawn logic          |
| **rng.js**                | Seeded RNG utilities (mulberry32, helpers)                |
| **scripts.js**            | First-class scripting (ScriptRef, ScriptMeta, fluent APIs)|
| **scriptsPhasesExtra.js** | Optional extra script phases and per-entity phase control |
| **adapters/raf-adapters.js** | requestAnimationFrame loop helpers (realtime & dual-loop) |
| **adapters/scriptRouter.js** | Route world events to script handlers                    |
| **index.js**              | Barrel re-export of core, systems, adapters, helpers      |
| **ecs.d.ts**              | TypeScript declarations for editor/IDE intellisense      |

---

## ⚖️ License

HSSL © 2025 Pete Jensen
Lightweight, deterministic, and proudly build-free.
