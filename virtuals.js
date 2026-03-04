// ecs/virtuals.js
// Memoized virtual components — computed views cached per tick step.
// No archetypes are affected; virtuals are invisible to queries.
/**
 * @module ecs/virtuals
 * Virtual components provide memoized computed views of world state, scoped to
 * the current tick step. They do not affect archetypes, storage, or queries.
 *
 * Usage:
 *   const virtuals = createVirtualRegistry(world);
 *   const MyVirtual = virtuals.define('MyVirtual', (world, id) => compute(world, id));
 *   const result    = virtuals.get(entityId, MyVirtual); // cached for this tick step
 *   virtuals.clear();                                    // invalidate all caches
 */

/**
 * @typedef {import('./core.js').World} World
 */

/**
 * @typedef {Object} VirtualComponent
 * @property {symbol} key      - Unique symbol key for this virtual.
 * @property {string} name     - Display name.
 * @property {true}   isVirtual - Sentinel: always true.
 */

/**
 * @typedef {Object} VirtualRegistry
 * @property {(name: string, compute: (world: World, id: number) => *) => VirtualComponent} define
 * @property {(id: number, VComp: VirtualComponent) => *} get
 * @property {(VComp?: VirtualComponent) => void} clear
 */

/**
 * Create a virtual component registry bound to a world instance.
 * Multiple independent registries can coexist on the same world.
 *
 * @param {World} world
 * @returns {VirtualRegistry}
 */
export function createVirtualRegistry(world) {
  const _defs = new Map(); // symbol → { compute, cache: Map<id, {step, val}> }

  /**
   * Define a named virtual component.
   * @param {string} name
   * @param {(world: World, id: number) => *} compute
   * @returns {VirtualComponent}
   */
  function define(name, compute) {
    if (typeof compute !== 'function') throw new Error('define: compute must be a function');
    const key = Symbol(String(name || 'Virtual'));
    const VComp = Object.freeze({ key, name: String(name || 'Virtual'), isVirtual: true });
    _defs.set(key, { compute, cache: new Map() });
    return VComp;
  }

  /**
   * Get the virtual value for an entity, recomputing only when the tick step
   * has advanced since the last call.
   * @param {number} id
   * @param {VirtualComponent} VComp
   * @returns {*}
   */
  function get(id, VComp) {
    const def = _defs.get(VComp?.key);
    if (!def) throw new Error(`get: unknown virtual '${VComp?.name || '?'}'`);
    const cached = def.cache.get(id);
    if (cached && cached.step === world.step) return cached.val;
    const val = def.compute(world, id);
    def.cache.set(id, { step: world.step, val });
    return val;
  }

  /**
   * Invalidate the cache for one or all virtual components.
   * Call at the end of each tick to ensure stale values are not returned.
   * @param {VirtualComponent} [VComp] - If omitted, clears all caches.
   */
  function clear(VComp) {
    if (!VComp) {
      for (const d of _defs.values()) d.cache.clear();
      return;
    }
    const def = _defs.get(VComp.key);
    if (def) def.cache.clear();
  }

  return { define, get, clear };
}
