// ecs/core.js
// Step-based, phase-agnostic ECS core. No timers. No built-in phases. No rendering.
/**
 * @module ecs/core
 * Core ECS primitives: components, entity world, queries, and scheduling hooks.
 *
 * Design goals:
 * - Deterministic and framework-agnostic
 * - Minimal, explicit APIs (no implicit phases)
 * - Efficient queries with cache invalidation upon structural changes
 * - Two store modes: Map-of-records (default) and SoA (struct-of-arrays)
 */

import { composeScheduler, registerSystem } from './systems.js';
import { installScriptsAPI, PHASE_SCRIPTS } from './scripts.js';
import { mulberry32 } from './rng.js';

const globalConsole = (typeof console !== 'undefined') ? console : null;
const logError = (globalConsole && typeof globalConsole.error === 'function') ? globalConsole.error.bind(globalConsole) : () => {};

class WorldDebug {
  constructor(world) {
    this.world = world;
    this.enabled = !!world?._debug;
    this._history = new Map(); // Map<entityId, Map<compKey, snapshot>>
  }

  enable(on = true) { this.enabled = !!on; return this; }

  inspect(id) {
    const world = this.world;
    const alive = world.isAlive(id);
    const components = {};
    const removed = [];

    const prev = this._history.get(id) || new Map();
    const nextHistory = new Map();

    for (const [ckey, Comp] of world._components) {
      const rec = world.get(id, Comp);
      if (rec != null) {
        const snapshot = deepClone(rec);
        const previous = prev.has(ckey) ? prev.get(ckey) : null;
        const diff = previous ? diffRecords(previous, snapshot) : null;
        nextHistory.set(ckey, snapshot);
        components[Comp.name] = {
          value: snapshot,
          changed: world.changed(id, Comp),
          previous,
          diff,
        };
      } else if (prev.has(ckey)) {
        removed.push(Comp.name);
      }
    }

    if (nextHistory.size) this._history.set(id, nextHistory);
    else this._history.delete(id);

    return Object.freeze({ id, alive, components, removed });
  }

  forget(id) {
    this._history.delete(id);
    return this;
  }

}

/**
 * @typedef {object} Component
 * @property {symbol} key - Opaque unique identifier.
 * @property {string} name - Human-readable name.
 * @property {object} defaults - Default record shape for instances.
 * @property {(function(object):boolean)=} validate - Optional predicate for validation; returning false throws when adding/setting.
 */

/**
 * @typedef {Component & { isTag?: true }} TagComponent
 */

/** Deterministic RNG provided by rng.js (mulberry32). */

const $NOT = Symbol('Not');
const $CHANGED = Symbol('Changed');
/**
 * Negated component term for queries.
 * @param {Component} Comp
 * @returns {{kind:symbol, Comp:Component}}
 */
export const Not = (Comp) => ({ kind: $NOT, Comp });
/**
 * Changed-in-last-tick component term for queries.
 * Matches entities whose given component was modified since the previous tick.
 * @param {Component} Comp
 * @returns {{kind:symbol, Comp:Component}}
 */
export const Changed = (Comp) => ({ kind: $CHANGED, Comp });

/**
 * Define a structured component with defaults and optional validation.
 * Instances added to entities start as deep clones of defaults merged with provided data.
 * @param {string} name
 * @param {object} defaults - Plain-object defaults (no functions). Nested arrays/objects are deep-cloned on add/set.
 * @param {{ validate?:(rec:object)=>boolean }} [options]
 * @returns {Component}
 */
export function defineComponent(name, defaults, options = {}) {
  const key = Symbol(name);
  const shape = Object.freeze({ ...(defaults ?? {}) });
  const validate = typeof options.validate === 'function' ? options.validate : undefined;
  return Object.freeze({ key, name, defaults: shape, validate });
}

/**
 * Define a tag component (no data). Useful for filtering.
 * @param {string} name
 * @returns {TagComponent}
 */
export function defineTag(name) {
  const C = defineComponent(name, Object.freeze({}));
  return Object.freeze({ ...C, isTag: true });
}

/**
 * ECS World containing entities, component stores, and query engine.
 *
 * Contract:
 * - Entity ids are positive integers; 0 is reserved as a "null" sentinel.
 * - Structural mutations (create/destroy/add/remove) are deferred if performed inside a tick
 *   unless strict mode throws. Mutations via set/mutate mark components changed.
 * - Query caching: a positive set of entity ids per unique component set is cached and
 *   invalidated on any structural change.
 */
export class World {
  constructor(opts = {}) {
    // scheduler
    this.scheduler = null;

    // hooks
    this.onTick = opts.onTick || null;

    // rng
    this.seed = (opts.seed ?? (Math.random() * 2 ** 32) | 0) >>> 0;
    this.rand = mulberry32(this.seed);

    // stores / caches
    this.storeMode = opts.store || 'map';
    this._store = new Map();    // Map<Comp.key, store>
    this._cache = new Map();    // query positive set cache
    this._changed = new Map();  // Map<Comp.key, Set<id>>
    this._components = new Map(); // Map<Comp.key, Comp>

    // command queue for deferred structural mutations
    this._cmd = [];

    // entity bookkeeping
    this._free = [];
    this._nextId = 1;
    this.alive = new Set();

    // flags & timing
    this._inTick = false;
    this.strict = !!opts.strict;
    this._debug = !!opts.debug;
    this._strictHandler = null;
    this.time = 0;
    this.step = 0;

    this.debug = new WorldDebug(this);
    this.debug.enable(this._debug);
  }

  static create(opts = {}) {
    return new WorldBuilder(opts);
  }

  /** Construct a new world from a snapshot and component registry.
   * Similar to deserialize helpers, but available from the core API.
   * @param {object} json - A v1 snapshot ({@link import('./serialization.js').Snapshot}).
   * @param {Map<string, Component>|Record<string, Component>} registry
   * @param {{ seed?: number, store?: string, skipUnknown?: boolean }} [opts]
   * @returns {World}
   */
  static fromSnapshot(json, registry, opts = {}) {
    const { seed: seedOpt, store: storeOpt, skipUnknown, ...worldOpts } = opts || {};
    const store = storeOpt || json?.meta?.store;
    const seed = (seedOpt != null) ? (seedOpt >>> 0) : (json?.meta?.seed >>> 0);
    const world = new this({ ...worldOpts, seed, store });
    const reg = _registryToMap(registry, 'fromSnapshot');
    for (const Comp of reg.values()) {
      if (Comp?.key && typeof Comp.name === 'string') world._components.set(Comp.key, Comp);
    }
    world.load(json, { skipUnknown: !!skipUnknown });
    return world;
  }

  /** Install/replace the scheduler. Must be (world, dt) => void.
   * @param {(world:World, dt:number)=>void} fn
   * @returns {this}
   */
  setScheduler(fn) {
    if (typeof fn !== 'function') throw new Error('setScheduler: scheduler must be a function (world, dt) => void');
    this.scheduler = fn;
    return this;
  }

  /** System registration pass-through (core does not know phase semantics).
   * @param {(world:World, dt:number)=>void} fn
   * @param {string} [phase='default']
   * @param {{ before?:Function[], after?:Function[] }} [opts]
   * @returns {this}
   */
  system(fn, phase = 'default', opts = {}) {
    try { registerSystem(fn, phase, opts); } catch (e) { logError('[ecs] system registration failed', e); }
    return this;
  }

  /** Advance the world by a discrete dt using the installed scheduler.
   * Flushes deferred operations and clears change marks at the end of the tick.
   * @param {number} dt
   */
  tick(dt) {
    if (!this.scheduler) throw new Error('tick: no scheduler installed. Call world.setScheduler(...) first.');
    this.time += dt;
    this.step++;
    this._inTick = true;
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    try { this.scheduler(this, dt); }
    catch (e) { logError('[ecs] scheduler error', e); }

    // Flush deferred ops (bounded)
    if (this._cmd.length) {
      const cmds = this._cmd.slice(); this._cmd.length = 0;
      const MAX = 1000;
      const limit = Math.min(MAX, cmds.length);
      const prev = this._inTick; this._inTick = false;
      try {
        for (let i = 0; i < limit; i++) this._applyOp(cmds[i]);
      } finally { this._inTick = prev; }
      if (cmds.length > limit) this._cmd.push(...cmds.slice(limit));
    }

    // Clear change marks
    this._changed.clear();
    this._inTick = false;

    const took = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    if (typeof this.onTick === 'function') {
      try { this.onTick(took, this); }
      catch (e) { logError('[ecs] onTick error', e); }
    }
  }

  /** ===== Entity lifecycle ===== */
  /** Create a new entity id and mark it alive.
   * @returns {number}
   */
  create() {
    const id = this._free.length ? this._free.pop() : this._nextId++;
    this.alive.add(id);
    return id;
  }
  /** Replace world state from a JSON snapshot, preserving original entity IDs
   * so that cross-entity references embedded in component payloads remain valid.
   * Builds a component registry automatically from previously seen components.
   * @param {object} json - A v1 snapshot ({@link import('./serialization.js').Snapshot}).
   * @param {{ skipUnknown?: boolean }} [opts]
   * @returns {World}
   */
  load(json, opts = {}) {
    if (this._inTick) throw new Error('load: cannot be called during tick');
    if (!json || typeof json !== 'object' || json.v !== 1 || !json.comps || typeof json.comps !== 'object')
      throw new Error('load: invalid snapshot format');

    // Build name→Comp registry from components this world already knows.
    const reg = new Map();
    for (const Comp of this._components.values()) {
      if (Comp?.name) reg.set(Comp.name, Comp);
    }

    if (!opts.skipUnknown) {
      for (const name of Object.keys(json.comps)) {
        if (!reg.has(name)) throw new Error(`load: unknown component '${name}'`);
      }
    }

    const _apply = () => {
      // Clear existing entities.
      for (const id of Array.from(this.alive)) this.destroy(id);

      // Restore original entity IDs directly.
      const sourceAlive = (json.alive || _aliveFromComps(json.comps)).slice().sort((a, b) => a - b);
      for (const id of sourceAlive) {
        if (!Number.isInteger(id) || id <= 0) throw new Error(`load: invalid entity id '${id}'`);
      }
      this._free.length = 0;
      const maxId = sourceAlive.length ? sourceAlive[sourceAlive.length - 1] : 0;
      this._nextId = maxId + 1;
      for (const id of sourceAlive) this.alive.add(id);

      // Apply component data.
      for (const [name, rows] of Object.entries(json.comps)) {
        const Comp = reg.get(name);
        if (!Comp) continue;
        for (const [id, payload] of rows) {
          if (!this.alive.has(id)) continue;
          this.add(id, Comp, payload);
        }
      }

      if (json.meta && typeof json.meta === 'object') {
        if (Object.prototype.hasOwnProperty.call(json.meta, 'time')) {
          const t = Number(json.meta.time);
          this.time = Number.isFinite(t) ? t : 0;
        }
        if (Object.prototype.hasOwnProperty.call(json.meta, 'frame')) {
          const f = Number(json.meta.frame);
          this.frame = Number.isFinite(f) ? (f | 0) : 0;
        }
      }
      return this;
    };

    return this.batch?.(() => _apply()) ?? _apply();
  }
  /** Destroy an entity immediately or defer if inside a tick.
   * @param {number} id
   * @returns {boolean|null}
   */
  destroy(id) {
    if (!this.alive.has(id)) return false;
    if (this._inTick) {
      if (this.strict) {
        const outcome = this._handleStrictDuringTick('destroy', [id], () => {
          this.command(['destroy', id]);
        });
        if (outcome) return null;
      } else {
        this.command(['destroy', id]); return null;
      }
    }
    for (const [k, store] of this._store) { if (store.delete(id)) this._markChanged(k, id); }
    this.alive.delete(id); this._free.push(id);
    this._invalidateCaches();
    return true;
  }
  /** Check if an entity id is currently alive.
   * @param {number} id
   * @returns {boolean}
   */
  isAlive(id) {
    return this.alive.has(id);
  }


  /** ===== Components ===== */
  _mapFor(Comp) {
    const k = Comp.key;
    if (!this._store.has(k)) {
      const store = (this.storeMode === 'soa') ? makeSoAStore(Comp) : makeMapStore();
      this._store.set(k, store);
    }
    if (!this._components.has(k)) this._components.set(k, Comp);
    return this._store.get(k);
  }
  _markChanged(ckey, id) {
    if (!this._changed.has(ckey)) this._changed.set(ckey, new Set());
    this._changed.get(ckey).add(id);
  }

  /**
   * Add a component record to an entity (structural change).
   * Deep-clones defaults and provided data; validates if component has a validator.
   * Deferred if called inside {@link World#tick} unless strict mode is enabled.
   * @param {number} id
   * @param {Component} Comp
   * @param {object} [data]
   * @returns {object|null} The stored record (or null if deferred)
   */
  add(id, Comp, data) {
    if (!this.alive.has(id)) throw new Error('add: entity not alive');
    if (this._inTick) {
      if (this.strict) {
        const outcome = this._handleStrictDuringTick('add', [id, Comp, data], () => {
          this.command(['add', id, Comp, data]);
        });
        if (outcome) return null;
      } else {
        this.command(['add', id, Comp, data]); return null;
      }
    }
    const rec = Object.assign({}, deepClone(Comp.defaults), deepClone(data || {}));
    assertNoFunctions(rec, Comp.name, '');
    if (typeof Comp.validate === 'function' && !Comp.validate(rec)) throw new Error(`Validation failed for component ${Comp.name}`);
    this._mapFor(Comp).set(id, rec);
    this._markChanged(Comp.key, id);
    this._invalidateCaches();
    return rec;
  }

  /** Get a component record or null if absent.
   * @param {number} id
   * @param {Component} Comp
   * @returns {object|null}
   */
  get(id, Comp) { return this._mapFor(Comp).get(id) || null; }
  /** Get the backing record instance if available (SoA may return a live view object).
   * @param {number} id
   * @param {Component} Comp
   * @returns {object|null}
   */
  getInstance(id, Comp) {
    const store = this._store.get(Comp.key);
    if (!store) return null;
    if (store.fast) return store.fast[id] || null;
    if (store.get) return store.get(id) || null;
    return null;
  }
  /** Test whether an entity has a component.
   * @param {number} id
   * @param {Component} Comp
   * @returns {boolean}
   */
  has(id, Comp) { return this._mapFor(Comp).has(id); }

  /** Remove a component from an entity (structural change). Deferred during tick unless strict.
   * @param {number} id
   * @param {Component} Comp
   * @returns {boolean|null}
   */
  remove(id, Comp) {
    if (this._inTick) {
      if (this.strict) {
        const outcome = this._handleStrictDuringTick('remove', [id, Comp], () => {
          this.command(['remove', id, Comp]);
        });
        if (outcome) return null;
      } else {
        this.command(['remove', id, Comp]); return null;
      }
    }
    const ok = this._mapFor(Comp).delete(id);
    if (ok) { this._markChanged(Comp.key, id); this._invalidateCaches(); }
    return ok;
  }

  /** Patch-assign fields on a component record (non-structural change). Validates before assignment.
   * Deferred during tick unless strict.
   * @param {number} id
   * @param {Component} Comp
   * @param {object} patch
   * @returns {object|null}
   */
  set(id, Comp, patch) {
    if (this._inTick) {
      if (this.strict) {
        const outcome = this._handleStrictDuringTick('set', [id, Comp, patch], () => {
          this.command(['set', id, Comp, patch]);
        });
        if (outcome) return null;
      } else {
        this.command(['set', id, Comp, patch]); return null;
      }
    }
    const rec = this.get(id, Comp);
    if (!rec) throw new Error('set: entity lacks component');
    const next = Object.assign({}, rec, patch);
    assertNoFunctions(next, Comp.name, '');
    if (typeof Comp.validate === 'function' && !Comp.validate(next)) throw new Error(`Validation failed for component ${Comp.name}`);
    Object.assign(rec, patch);
    this._markChanged(Comp.key, id);
    return rec;
  }

  /** Mutate a component record in place (non-structural change).
   * @param {number} id
   * @param {Component} Comp
   * @param {(rec:object)=>void} fn
   * @returns {object|null}
   */
  mutate(id, Comp, fn) {
    if (this._inTick) {
      if (this.strict) {
        const outcome = this._handleStrictDuringTick('mutate', [id, Comp, fn], () => {
          this.command(['mutate', id, Comp, fn]);
        });
        if (outcome) return null;
      } else {
        this.command(['mutate', id, Comp, fn]); return null;
      }
    }
    const rec = this.get(id, Comp);
    if (!rec) throw new Error('mutate: entity lacks component');
    fn(rec);
    assertNoFunctions(rec, Comp.name, '');
    this._markChanged(Comp.key, id);
    return rec;
  }

  /** ===== Queries ===== */
  _isOpts(o) { return o && typeof o === 'object' && !('key' in o) && !('kind' in o); }

  /** Query entities by component presence/absence and change status.
   * Returns a lazy iterable of [id, ...components] tuples, augmented with run(fn) and count({cheap?:boolean}).
   * With options object, supports where/project/orderBy/offset/limit.
   * @param {...(Component|ReturnType<typeof Not>|ReturnType<typeof Changed>|object)} terms
   * @returns {Iterable & { run(fn:Function): World, count(opts?:{cheap?:boolean}): number }}
   */
  query(...terms) {
    let opts = null;
    if (terms.length && this._isOpts(terms[terms.length - 1])) opts = terms.pop();
    const spec = normalizeTerms(terms);
    return this._executeQuery(spec, opts);
  }

  defineQuery(...terms) {
    let opts = null;
    if (terms.length && this._isOpts(terms[terms.length - 1])) opts = terms.pop();
    const spec = normalizeTerms(terms);
    const baseOpts = opts ? { ...opts } : null;

    const mergeOpts = (a, b) => {
      if (!a && !b) return null;
      const res = { ...(a || {}) };
      if (b) Object.assign(res, b);
      return res;
    };

    const makeHandle = (state) => {
      const snapshot = state ? { ...state } : null;
      const handle = (runtime) => {
        const finalOpts = mergeOpts(snapshot, runtime);
        return this._executeQuery(spec, finalOpts);
      };
      const chain = (key, value) => {
        const nextState = Object.assign({}, snapshot || {});
        nextState[key] = value;
        return makeHandle(nextState);
      };
      handle.where = (fn) => chain('where', fn);
      handle.project = (fn) => chain('project', fn);
      handle.orderBy = (fn) => chain('orderBy', fn);
      handle.offset = (n) => chain('offset', n);
      handle.limit = (n) => chain('limit', n);
      handle.options = () => snapshot ? { ...snapshot } : {};
      handle.spec = spec;
      handle.world = this;
      return handle;
    };

    return makeHandle(baseOpts);
  }

  /** Generator form of query yielding [id, ...components].
   * @param {...(Component|ReturnType<typeof Not>|ReturnType<typeof Changed>)} terms
   */
  *queryGen(...terms) {
    const spec = normalizeTerms(terms);
    const list = this._cachedEntityList(spec, spec.cacheKey);
    for (let i = 0; i < list.length; i++) {
      const id = list[i];
      if (!passesDynamicFilters(this, id, spec)) continue;
      yield [id, ...spec.all.map(c => this.get(id, c))];
    }
  }

  _executeQuery(spec, opts) {
    const key = spec.cacheKey;
    const baseList = this._cachedEntityList(spec, key);

    if (!opts) {
      const tuples = this._tuplesFromList(baseList, spec);
      tuples._world = this;
      tuples.run = function(fn) { for (const row of tuples) fn(...row); return this._world; };
      tuples.count = function(o) { return (o && o.cheap) ? baseList.length : countFiltered(this._world, baseList, spec); };
      return tuples;
    }

    const where = typeof opts.where === 'function' ? opts.where : null;
    const project = typeof opts.project === 'function' ? opts.project : null;

    let list = baseList;

    if (opts.orderBy) {
      const rows = [];
      for (let i = 0; i < list.length; i++) {
        const id = list[i];
        if (!passesDynamicFilters(this, id, spec)) continue;
        const comps = spec.all.map(c => this.get(id, c));
        if (where && !where(...comps, id)) continue;
        rows.push({ id, comps });
      }
      rows.forEach(r => r.p = project ? project(r.id, ...r.comps) : r);
      rows.sort((A, B) => opts.orderBy(A, B));
      list = rows.map(r => r.id);

      let idx = 0, start = Math.max(0, ~~(opts.offset || 0));
      const lim = (opts.limit == null) ? Infinity : Math.max(0, ~~opts.limit);
      return {
        _world: this,
        [Symbol.iterator]() {
          let used = 0;
          return {
            next() {
              while (idx < rows.length && used < lim) {
                const r = rows[idx++]; if (start-- > 0) continue;
                used++;
                const out = project ? project(r.id, ...r.comps) : [r.id, ...r.comps];
                return { value: out, done: false };
              }
              return { done: true };
            }
          };
        },
        run(fn) { for (const row of this) fn(row); return this._world; },
        count(o) { return (o && o.cheap) ? baseList.length : rows.length; }
      };
    }

    const start = Math.max(0, ~~(opts.offset || 0));
    const lim = (opts.limit == null) ? Infinity : Math.max(0, ~~opts.limit);
    const iter = function* () {
      let seen = 0, used = 0;
      for (let i = 0; i < list.length; i++) {
        const id = list[i];
        if (!passesDynamicFilters(this, id, spec)) continue;
        const comps = spec.all.map(c => this.get(id, c));
        if (where && !where(...comps, id)) continue;
        if (seen++ < start) continue;
        if (used++ >= lim) break;
        yield project ? project(id, ...comps) : [id, ...comps];
      }
    }.bind(this);
    const tuples = { _world: this, [Symbol.iterator]: iter };
    tuples.run = function(fn) { for (const row of tuples) fn(row); return this._world; };
    tuples.count = (o) => (o && o.cheap) ? list.length : countFiltered(this, list, spec, where);
    return tuples;
  }

  _tuplesFromList(list, spec) {
    const iter = function* () {
      for (let i = 0; i < list.length; i++) {
        const id = list[i];
        if (!passesDynamicFilters(this, id, spec)) continue;
        yield [id, ...spec.all.map(c => this.get(id, c))];
      }
    }.bind(this);
    return { [Symbol.iterator]: iter };
  }

  _cachedEntityList(spec, key) {
    if (this._cache.has(key)) return this._cache.get(key);
    let result = null;
    for (const c of spec.all) {
      const store = this._mapFor(c);
      const arr = store.entityIds();
      result = result ? intersectSorted(result, arr) : arr;
      if (!result.length) break;
    }
    if (spec.all.length === 0) result = Array.from(this.alive).sort((a, b) => a - b);
    this._cache.set(key, result);
    return result;
  }

  _invalidateCaches() {
    this._cache.clear();
  }

  /** ===== Events ===== */
  /** Subscribe to a named event.
   * @param {string} event
   * @param {(payload:any, world:World)=>void} fn
   * @returns {()=>void} unsubscribe
   */
  on(event, fn) { (this._ev ||= new Map()); if (!this._ev.has(event)) this._ev.set(event, new Set()); this._ev.get(event).add(fn); return () => this.off(event, fn); }
  /** Unsubscribe a listener. @param {string} event @param {(payload:any)=>void} fn */
  off(event, fn) { const set = this._ev?.get(event); if (set) set.delete(fn); }
  /** Emit an event to listeners. @param {string} event @param {any} payload @returns {number} count of listeners invoked */
  emit(event, payload) {
    const set = this._ev?.get(event);
    if (!set) return 0;
    let n = 0;
    for (const f of set) {
      try { f(payload, this); n++; }
      catch (e) { logError('event error', e); }
    }
    return n;
  }

  /** ===== Deferral ===== */
  /** Queue a deferred operation or function to run outside of tick context. @param {any} opOrFn */
  command(opOrFn) { this._cmd.push(opOrFn); return this; }

  /** Return a snapshot of pending deferred operations. Useful for debugging. */
  pendingOps() { return this._cmd.slice(); }

  /** Install a strict-mode handler invoked when structural mutations occur mid-tick in strict worlds.
   * Handler receives a context object ({ op, args, world, error, defer }).
   * Call ctx.defer() or return 'defer' to queue the operation despite strict mode.
   * Return 'ignore' (or false) to swallow the mutation. Throw to propagate custom errors.
   * @param {(ctx:{ op:string, args:readonly any[], world:World, error:Error, defer:()=>void })=>('defer'|'ignore'|false|void)} fn
   * @returns {this}
   */
  onStrictError(fn) {
    if (fn != null && typeof fn !== 'function') throw new Error('onStrictError: handler must be a function or null');
    this._strictHandler = fn || null;
    return this;
  }

  _handleStrictDuringTick(op, args, fallback) {
    const error = new Error(`${op}: structural mutation during tick (strict)`);
    if (typeof this._strictHandler === 'function') {
      let deferred = false;
      const ctx = {
        op,
        args: Object.freeze([...args]),
        world: this,
        error,
        defer: () => {
          if (!deferred && typeof fallback === 'function') fallback();
          deferred = true;
        }
      };
      try {
        const res = this._strictHandler(ctx);
        if (res === 'defer' && !deferred) ctx.defer();
        if (deferred) return 'defer';
        if (res === 'ignore' || res === false) return 'ignore';
      } catch (handlerErr) {
        logError('[ecs] strict handler error', handlerErr);
      }
    }
    throw error;
  }
  _applyOp(op) {
    try {
      if (typeof op === 'function') return op();
      const t = op[0];
      if (t === 'destroy') return this.destroy(op[1]);
      if (t === 'add')     return this.add(op[1], op[2], op[3]);
      if (t === 'remove')  return this.remove(op[1], op[2]);
      if (t === 'set')     return this.set(op[1], op[2], op[3]);
      if (t === 'mutate')  return this.mutate(op[1], op[2], op[3]);
    } catch (e) { logError('applyOp error', e); }
  }

  /** ===== Diagnostics ===== */
  /** Mark a component as changed (diagnostics/testing). @param {number} id @param {Component} Comp */
  markChanged(id, Comp) { this._markChanged(Comp.key, id); }
  /** Has the entity's component changed since last tick? @param {number} id @param {Component} Comp @returns {boolean} */
  changed(id, Comp) { const s = this._changed.get(Comp.key); return !!(s && s.has(id)); }
  /** Enable or disable debug mode. @param {boolean} [on=true] @returns {this} */
  enableDebug(on = true) {
    this._debug = !!on;
    if (this.debug) this.debug.enable(this._debug);
    return this;
  }
}

export class WorldBuilder {
  constructor(opts = {}) {
    this._opts = { ...(opts || {}) };
    this._systems = [];
    this._installers = [];
    this._schedulerSteps = [];
    this._customScheduler = null;
    this._requiredPhases = new Set();
    this._strictHandlers = [];
  }

  useSoA() { this._opts.store = 'soa'; return this; }
  useMap() { this._opts.store = 'map'; return this; }
  withSeed(seed) { this._opts.seed = seed >>> 0; return this; }
  enableStrict(on = true) { this._opts.strict = !!on; return this; }
  enableDebug(on = true) { this._opts.debug = !!on; return this; }
  withOptions(opts = {}) { Object.assign(this._opts, opts || {}); return this; }
  withScheduler(...steps) { this._customScheduler = null; this._schedulerSteps = steps.flat().filter(Boolean); return this; }
  withSchedulerFn(fn) {
    if (typeof fn !== 'function') throw new Error('withSchedulerFn: scheduler must be a function');
    this._customScheduler = fn;
    return this;
  }
  withPhases(...phases) {
    phases.flat().forEach(ph => { if (typeof ph === 'string' && ph) this._requiredPhases.add(ph); });
    return this;
  }
  system(fn, phase = 'default', opts = {}) {
    this._systems.push({ fn, phase, opts });
    return this;
  }
  install(installer) {
    if (typeof installer !== 'function') throw new Error('install: installer must be a function');
    this._installers.push(installer);
    return this;
  }
  onStrictError(fn) { this._strictHandlers.push(fn); return this; }
  useScripts(options = {}) {
    const scriptOptions = { ...(options || {}) };
    const installer = (world) => installScriptsAPI(world, scriptOptions);
    this._installers.push(installer);
    if (scriptOptions.autoPhase !== false) {
      const phase = scriptOptions.phase || PHASE_SCRIPTS;
      this.withPhases(phase);
    }
    return this;
  }
  build() {
    const world = new World(this._opts);
    for (const fn of this._strictHandlers) world.onStrictError(fn);
    for (const { fn, phase, opts } of this._systems) world.system(fn, phase, opts);
    if (this._customScheduler) {
      world.setScheduler(this._customScheduler);
    } else {
      const steps = [...this._schedulerSteps];
      this._requiredPhases.forEach(ph => { if (!steps.includes(ph)) steps.push(ph); });
      if (steps.length) world.setScheduler(composeScheduler(...steps));
    }
    for (const inst of this._installers) inst(world);
    return world;
  }
}

export function Component(name) {
  if (typeof name !== 'string' || !name) throw new Error('Component builder requires a non-empty name');
  const state = { name, defaults: {}, validate: null, tag: false };
  const builder = {
    defaults(obj = {}) { state.defaults = { ...(obj || {}) }; return builder; },
    validate(fn) { if (typeof fn !== 'function') throw new Error('Component.validate expects a function'); state.validate = fn; return builder; },
    taggable() { state.tag = true; return builder.build(); },
    tag() { return builder.taggable(); },
    build() {
      const opts = state.validate ? { validate: state.validate } : undefined;
      if (state.tag) {
        const tagComp = defineTag(state.name);
        return tagComp;
      }
      return defineComponent(state.name, state.defaults, opts);
    },
    create() { return builder.build(); }
  };
  return builder;
}

/** ===== Query helpers ===== */
function normalizeTerms(terms) {
  const all = [], none = [], changed = [];
  for (const t of terms) {
    if (!t) continue;
    if (t.kind === $NOT) none.push(t.Comp);
    else if (t.kind === $CHANGED) changed.push(t.Comp);
    else all.push(t);
  }
  const cacheKey = all.map(c => c.key.description || 'c').sort().join('|') || '*';
  return { all, none, changed, cacheKey };
}
function passesDynamicFilters(world, id, spec) {
  for (const c of spec.none)    if (world.has(id, c)) return false;
  for (const c of spec.changed) if (!world.changed(id, c)) return false;
  return true;
}
function countFiltered(world, list, spec, where = null) {
  let c = 0;
  for (let i = 0; i < list.length; i++) {
    const id = list[i];
    if (!passesDynamicFilters(world, id, spec)) continue;
    if (where) {
      const comps = spec.all.map(k => world.get(id, k));
      if (!where(...comps, id)) continue;
    }
    c++;
  }
  return c;
}

/** ===== Set stores ===== */
function makeMapStore() {
  const map = new Map();
  const fast = Object.create(null);
  return {
    set(id, rec) { map.set(id, rec); fast[id] = rec; },
    get(id) { return map.get(id); },
    has(id) { return map.has(id); },
    delete(id) { const ok = map.delete(id); delete fast[id]; return ok; },
    entityIds() { const arr = Array.from(map.keys()); arr.sort((a, b) => a - b); return arr; },
    fast
  };
}

function makeSoAStore(Comp) {
  const fields = Object.keys(Comp.defaults || {});
  const arrays = Object.fromEntries(fields.map(f => [f, []]));
  const present = new Set();
  const views = new Map();
  function view(id) {
    if (views.has(id)) return views.get(id);
    const obj = {};
    for (const f of fields) {
      Object.defineProperty(obj, f, {
        enumerable: true,
        get() { return arrays[f][id] ?? Comp.defaults[f]; },
        set(v) { arrays[f][id] = v; }
      });
    }
    views.set(id, obj);
    return obj;
  }
  const fast = undefined;
  return {
    set(id, rec) { present.add(id); for (const f of fields) arrays[f][id] = (rec[f] ?? Comp.defaults[f]); },
    get(id) { return present.has(id) ? view(id) : undefined; },
    has(id) { return present.has(id); },
    delete(id) { const had = present.delete(id); views.delete(id); return had; },
    entityIds() { const arr = Array.from(present.values()); arr.sort((a, b) => a - b); return arr; },
    fast
  };
}

/** Reject function values anywhere in component data (components must be pure serializable data). */
function assertNoFunctions(obj, compName, path) {
  if (typeof obj === 'function') {
    throw new TypeError(
      `Component "${compName}": function values are not allowed in component data (at "${path || 'root'}")`
    );
  }
  if (obj !== null && typeof obj === 'object' && !ArrayBuffer.isView(obj)) {
    const keys = Array.isArray(obj) ? obj.keys() : Object.keys(obj);
    for (const k of keys) assertNoFunctions(obj[k], compName, path ? `${path}.${k}` : String(k));
  }
}

/** Deep clone for component defaults/data (keeps host objects by ref). */
function deepClone(v) {
  if (typeof structuredClone === 'function') { try { return structuredClone(v); } catch { /* structuredClone not supported */ } }
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(deepClone);
  const proto = Object.getPrototypeOf(v);
  const isPlain = (proto === Object.prototype || proto === null);
  if (!isPlain) return v;
  const out = {};
  for (const k of Object.keys(v)) out[k] = deepClone(v[k]);
  return out;
}

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (a && b && typeof a === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    const seen = new Set([...keysA, ...keysB]);
    for (const key of seen) {
      if (!Object.prototype.hasOwnProperty.call(a, key) || !Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

function diffRecords(prev = {}, next = {}) {
  const added = {};
  const removed = {};
  const changed = {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    const inPrev = Object.prototype.hasOwnProperty.call(prev, key);
    const inNext = Object.prototype.hasOwnProperty.call(next, key);
    if (!inPrev && inNext) {
      added[key] = next[key];
    } else if (inPrev && !inNext) {
      removed[key] = prev[key];
    } else if (inPrev && inNext && !deepEqual(prev[key], next[key])) {
      changed[key] = { before: prev[key], after: next[key] };
    }
  }
  const result = {};
  if (Object.keys(added).length) result.added = added;
  if (Object.keys(removed).length) result.removed = removed;
  if (Object.keys(changed).length) result.changed = changed;
  return Object.keys(result).length ? result : null;
}

/** Collect alive ids from component rows when snapshot.alive is absent. */
function _aliveFromComps(comps) {
  const s = new Set();
  for (const rows of Object.values(comps || {})) for (const [id] of rows) s.add(id);
  return Array.from(s);
}

function _registryToMap(registry, context = 'registry') {
  if (!registry) throw new Error(`${context}: registry required`);
  if (registry instanceof Map) return registry;
  const map = new Map();
  for (const [name, Comp] of Object.entries(registry)) map.set(name, Comp);
  return map;
}

/** Sorted intersection helper. */
function intersectSorted(a, b) {
  let i = 0, j = 0; const out = [];
  while (i < a.length && j < b.length) {
    const A = a[i], B = b[j];
    if (A === B) { out.push(A); i++; j++; }
    else if (A < B) i++; else j++;
  }
  return out;
}
