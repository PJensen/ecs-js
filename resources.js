// ecs/resources.js
// World-local resource definitions, World appendage methods, and snapshot helpers.

/**
 * Define a named world-local resource slot.
 *
 * Resources are explicit, named values owned by a World rather than ad hoc
 * properties on the World object. They are best suited for runtime queues,
 * caches, handles, extension-private state, and other world-local infrastructure.
 * Prefer singleton components for durable simulation facts.
 * @param {string} name
 * @param {{
 *   key?: any,
 *   create?:(world:any, resource:any)=>any,
 *   reset?:(value:any, world:any, resource:any)=>any,
 *   dispose?:(value:any, world:any, resource:any)=>void,
 *   serialize?:(value:any, world:any, resource:any)=>any,
 *   deserialize?:(payload:any, world:any, resource:any)=>any,
 *   serializable?:boolean
 * }} [options]
 * @returns {{ key:any, name:string, create:Function, reset:Function|null, dispose:Function|null, serialize:Function|null, deserialize:Function|null, serializable:boolean }}
 */
export function defineWorldResource(name, options = {}) {
  if (typeof name !== 'string' || !name) {
    throw new Error('defineWorldResource: name must be a non-empty string');
  }
  const opts = options || {};
  const key = Object.prototype.hasOwnProperty.call(opts, 'key')
    ? opts.key
    : Symbol(name);
  const create = opts.create == null ? (() => undefined) : opts.create;
  const reset = opts.reset == null ? null : opts.reset;
  const dispose = opts.dispose == null ? null : opts.dispose;
  const serialize = opts.serialize == null ? null : opts.serialize;
  const deserialize = opts.deserialize == null ? null : opts.deserialize;
  if (typeof create !== 'function') throw new Error('defineWorldResource: create must be a function');
  if (reset !== null && typeof reset !== 'function') throw new Error('defineWorldResource: reset must be a function');
  if (dispose !== null && typeof dispose !== 'function') throw new Error('defineWorldResource: dispose must be a function');
  if (serialize !== null && typeof serialize !== 'function') throw new Error('defineWorldResource: serialize must be a function');
  if (deserialize !== null && typeof deserialize !== 'function') throw new Error('defineWorldResource: deserialize must be a function');
  return Object.freeze({
    key,
    name,
    create,
    reset,
    dispose,
    serialize,
    deserialize,
    serializable: opts.serializable === true
  });
}

export function installWorldResourceAPI(WorldCtor, options = {}) {
  const logError = typeof options.logError === 'function' ? options.logError : () => {};

  Object.assign(WorldCtor.prototype, {
    /** Get a world-local resource value, lazily creating it if needed.
     * @param {{ key:any, name:string, create?:Function }} resource
     * @returns {any}
     */
    resource(resource) {
      const key = resourceKey(resource, 'resource');
      if (this._resources.has(key)) return this._resources.get(key).value;

      this._resourceDefs.set(key, resource);
      const create = typeof resource.create === 'function' ? resource.create : (() => undefined);
      const value = create(this, resource);
      this._resources.set(key, {
        key,
        name: resourceName(resource),
        resource,
        value
      });
      return value;
    },

    /** Check whether a world-local resource has been created or explicitly set.
     * @param {{ key:any }} resource
     * @returns {boolean}
     */
    hasResource(resource) {
      return this._resources.has(resourceKey(resource, 'hasResource'));
    },

    /** Explicitly set or replace a world-local resource value.
     * Replacing an existing value invokes the resource dispose hook first.
     * @param {{ key:any, name:string, dispose?:Function }} resource
     * @param {any} value
     * @returns {any}
     */
    setResource(resource, value) {
      const key = resourceKey(resource, 'setResource');
      this._resourceDefs.set(key, resource);
      const existing = this._resources.get(key);
      if (existing && existing.value !== value) this._disposeResourceRecord(existing);
      this._resources.set(key, {
        key,
        name: resourceName(resource),
        resource,
        value
      });
      return value;
    },

    /** Reset a resource using its reset hook, or dispose and recreate it.
     * @param {{ key:any, name:string, create?:Function, reset?:Function, dispose?:Function }} resource
     * @returns {any}
     */
    resetResource(resource) {
      const key = resourceKey(resource, 'resetResource');
      if (!this._resources.has(key)) return this.resource(resource);

      const rec = this._resources.get(key);
      this._resourceDefs.set(key, resource);
      const reset = typeof resource.reset === 'function' ? resource.reset : null;
      if (reset) {
        const next = reset(rec.value, this, resource);
        if (next !== undefined && next !== rec.value) {
          this._disposeResourceRecord(rec);
          rec.value = next;
        }
        rec.resource = resource;
        rec.name = resourceName(resource);
        return rec.value;
      }

      this._disposeResourceRecord(rec);
      this._resources.delete(key);
      return this.resource(resource);
    },

    /** Delete a created resource, invoking its dispose hook if present.
     * @param {{ key:any }} resource
     * @returns {boolean}
     */
    deleteResource(resource) {
      const key = resourceKey(resource, 'deleteResource');
      const rec = this._resources.get(key);
      if (!rec) return false;
      this._resources.delete(key);
      this._disposeResourceRecord(rec);
      return true;
    },

    _disposeResourceRecord(rec) {
      const dispose = typeof rec?.resource?.dispose === 'function' ? rec.resource.dispose : null;
      if (!dispose) return;
      try {
        dispose(rec.value, this, rec.resource);
      } catch (e) {
        logError(`[ecs] resource "${rec.name}" dispose failed`, e);
      }
    },

    /** Return diagnostic records for created world-local resources.
     * @returns {Array<{ name:string, key:any, resource:any, value:any, serializable:boolean, resettable:boolean, disposable:boolean }>}
     */
    resources() {
      return Array.from(this._resources.values()).map(rec => ({
        name: rec.name,
        key: rec.key,
        resource: rec.resource,
        value: rec.value,
        serializable: rec.resource?.serializable === true,
        resettable: typeof rec.resource?.reset === 'function',
        disposable: typeof rec.resource?.dispose === 'function'
      }));
    }
  });
}

export function resourceRegistryFromWorld(world) {
  const map = new Map();
  for (const resource of world._resourceDefs?.values?.() || []) {
    if (resource?.name) map.set(resource.name, resource);
  }
  for (const rec of world._resources?.values?.() || []) {
    if (rec?.resource?.name) map.set(rec.resource.name, rec.resource);
  }
  return map;
}

export function normalizeResourceRegistry(reg, world) {
  const m = resourceRegistryFromWorld(world);
  if (!reg) return m;
  if (reg instanceof Map) {
    for (const [name, resource] of reg) m.set(name, resource);
    return m;
  }
  if (Array.isArray(reg)) {
    for (const resource of reg) if (resource?.name) m.set(resource.name, resource);
    return m;
  }
  for (const [name, resource] of Object.entries(reg)) m.set(name, resource);
  return m;
}

export function serializeResources(world, include) {
  const included = normalizeResourceInclude(include);
  const out = {};
  for (const rec of world.resources?.() || []) {
    const resource = rec.resource;
    if (!included.has(resource) && !included.has(resource?.name)) continue;
    if (resource?.serializable !== true) continue;
    out[resource.name] = typeof resource.serialize === 'function'
      ? resource.serialize(rec.value, world, resource)
      : clonePlain(rec.value);
  }
  return out;
}

export function applyResourceSnapshot(world, resources, registry, opts = {}) {
  if (!resources) return;
  const context = opts.context || 'applyResourceSnapshot';
  for (const [name, payload] of Object.entries(resources || {})) {
    const resource = registry.get(name);
    if (!resource) {
      if (!opts.skipUnknown) throw new Error(`${context}: unknown resource '${name}'`);
      continue;
    }
    if (resource.serializable !== true) {
      throw new Error(`${context}: resource '${name}' is not serializable`);
    }
    const value = typeof resource.deserialize === 'function'
      ? resource.deserialize(clonePlain(payload), world, resource)
      : clonePlain(payload);
    world.setResource(resource, value);
  }
}

function resourceKey(resource, label = 'resource') {
  if (!resource || typeof resource !== 'object') throw new Error(`${label}: resource definition required`);
  if (!Object.prototype.hasOwnProperty.call(resource, 'key')) throw new Error(`${label}: resource definition requires a key`);
  if (typeof resource.name !== 'string' || !resource.name) throw new Error(`${label}: resource definition requires a non-empty name`);
  return resource.key;
}

function resourceName(resource) {
  return String(resource?.name || '<anonymous resource>');
}

function normalizeResourceInclude(include) {
  if (include === true) {
    throw new Error('includeResources: name resource definitions explicitly; boolean true would serialize every eligible resource');
  }
  if (!include) return new Set();
  if (include instanceof Set) return include;
  return new Set(Array.isArray(include) ? include : [include]);
}

function clonePlain(x) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(x); } catch {}
  }
  if (!x || typeof x !== 'object') return x;
  if (Array.isArray(x)) return x.map(clonePlain);
  const proto = Object.getPrototypeOf(x);
  const isPlain = (proto === Object.prototype || proto === null);
  if (!isPlain) return x;
  const out = {};
  for (const key of Object.keys(x)) out[key] = clonePlain(x[key]);
  return out;
}
