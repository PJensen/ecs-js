// ================================= 1) ecs/scripting.js ========================
// First-class scripting: ScriptRef + attach/tick systems bound to a built-in phase.
// This file does not bake in any concrete event names — routing is externalized.

// FILE: ecs/scripts.js
import { defineComponent, Changed } from './core.js';
import { registerSystem, Systems } from './systems.js';

/** Built-in phase name used by default script systems. */
export const PHASE_SCRIPTS = 'scripts';

/**
 * Reference to a registered script plus constructor args.
 * Contract: factory(world, eid, args) => { onTick?, ...customHandlers }
 */
export const ScriptRef = defineComponent('ScriptRef', { id: '', args: {} }, {
    validate(rec) { return typeof rec.id === 'string'; }
});

/**
 * Per-entity script diagnostics/metadata.
 * - lastError: last thrown error string/stack from any handler
 * - invoked: count of successful onTick invocations
 * - version: world.step when handlers were (re)attached
 */
export const ScriptMeta = defineComponent('ScriptMeta', { lastError: '', invoked: 0, version: 0 });

// Internal registry & entity handler table
/** @type {Map<string, (world:any, eid:number, args:any)=>Record<string,Function>>} */
const _registry = new Map();          // id -> factory(world, eid, args) => handlers
/** @type {Map<number, Record<string, Function>>} */
const _handlersByEntity = new Map();  // eid -> { [hookName]: function }

function _sanitizeHandlers(h) { const o = {}; for (const k in (h || {})) if (typeof h[k] === 'function') o[k] = h[k]; return o; }
function _ctx(world, id) { return { rand: world.rand, emit: (ev, p) => world.emit(ev, p) }; }
function _noteErr(world, id, e) { const msg = (e && e.stack) ? e.stack : String(e); world.has(id, ScriptMeta) ? world.set(id, ScriptMeta, { lastError: msg }) : world.add(id, ScriptMeta, { lastError: msg }); }
function _bump(world, id) { if (world.has(id, ScriptMeta)) world.mutate(id, ScriptMeta, m => { m.invoked++; }); }

function _ensureScriptPhase(phase) {
    const systems = Systems.list(phase);
    if (!systems.includes(ScriptAttachSystem)) {
        registerSystem(ScriptAttachSystem, phase, { before: [ScriptTickSystem] });
    }
    if (!systems.includes(ScriptTickSystem)) {
        registerSystem(ScriptTickSystem, phase);
    }
}

function _makeHelper(world, eid, args) {
    const handlers = {};
    const pendingKeys = new Set();
    const bag = {
        world,
        entity: eid,
        args: (args && typeof args === 'object') ? args : {},
        on(name, fn) {
            if (typeof name !== 'string' || !name) throw new Error('script helper on(name, fn) requires a name');
            if (typeof fn !== 'function') throw new Error(`script handler for ${name} must be a function`);
            handlers[name] = fn;
            return bag;
        },
        use(source) {
            if (!source) return bag;
            if (typeof source === 'function') {
                const res = source(world, eid, args) || {};
                Object.assign(handlers, _sanitizeHandlers(res));
            } else {
                Object.assign(handlers, _sanitizeHandlers(source));
            }
            return bag;
        }
    };
    const helper = new Proxy(bag, {
        get(target, key) {
            if (key in target) return target[key];
            if (typeof key !== 'string') return undefined;
            const keyName = String(key);
            pendingKeys.add(keyName);
            return (fn) => {
                if (typeof fn !== 'function') throw new Error(`script handler for ${keyName} must be a function`);
                pendingKeys.delete(keyName);
                handlers[keyName] = fn;
                return target;
            };
        }
    });
    const assertHandlersUsed = () => {
        if (pendingKeys.size === 0) return;
        const unused = Array.from(pendingKeys).join(', ');
        throw new Error(`script helper properties accessed without assigning handlers: ${unused}`);
    };
    return [helper, handlers, assertHandlersUsed];
}

class ScriptEntityHandle {
    constructor(world, id) {
        this.world = world;
        this.id = id;
    }

    addScript(scriptId, args = {}) {
        this.world.add(this.id, ScriptRef, { id: String(scriptId), args: args || {} });
        return this;
    }

    removeScript() {
        if (this.world.has(this.id, ScriptRef)) this.world.remove(this.id, ScriptRef);
        return this;
    }

    script() {
        return this.world.get(this.id, ScriptRef) || null;
    }
}

function ScriptAttachSystem(world, dt) {
    // (Re)attach handlers when ScriptRef changes
    for (const [id, sref] of world.query(ScriptRef, Changed(ScriptRef))) {
        try {
            const f = _registry.get(sref.id);
            if (!f) throw new Error(`Missing script: ${sref.id}`);
            _handlersByEntity.set(id, _sanitizeHandlers(f(world, id, sref.args || {})));
            if (world.has(id, ScriptMeta)) world.set(id, ScriptMeta, { lastError: '', version: world.step, invoked: 0 });
            else world.add(id, ScriptMeta, { lastError: '', invoked: 0, version: world.step });
        } catch (e) {
            _handlersByEntity.delete(id);
            _noteErr(world, id, e);
        }
    }

    // Cleanup: drop handler tables for entities that no longer carry ScriptRef or are dead
    if (_handlersByEntity.size) {
        for (const eid of Array.from(_handlersByEntity.keys())) {
            if (!world.isAlive(eid) || !world.has(eid, ScriptRef)) _handlersByEntity.delete(eid);
        }
    }
}

function ScriptTickSystem(world, dt) {
    for (const [id] of world.query(ScriptRef)) {
        const h = _handlersByEntity.get(id);
        const fn = h && h.onTick;
        if (typeof fn === 'function') {
            try { fn(world, id, dt, _ctx(world, id)); _bump(world, id); }
            catch (e) { _noteErr(world, id, e); }
        }
    }
}

// Bind systems to the built-in phase on module load
_ensureScriptPhase(PHASE_SCRIPTS);

// Public convenience API — attaches a scripting facet onto world instances
export function installScriptsAPI(world, options = {}) {
    const phase = options.phase || PHASE_SCRIPTS;
    _ensureScriptPhase(phase);
    world.scripts = {
        /** Register a script factory under a string id. */
        register(id, factory) { _registry.set(String(id), factory); },
        /** Clear all registered scripts and per-entity handler tables (hot-reload/test helper). */
        clear() { _registry.clear(); _handlersByEntity.clear(); },
        /** Retrieve the sanitized handler table for an entity if available. */
        handlersOf(eid) { return _handlersByEntity.get(eid) || null; },
        /** Force re-attachment by touching ScriptRef so Changed() matches next frame. */
        refresh() { for (const [eid, sref] of world.query(ScriptRef)) world.set(eid, ScriptRef, { id: sref.id, args: sref.args }); }
    };

    world.script = function script(id, configure) {
        if (typeof id !== 'string' || !id) throw new Error('world.script: id must be a non-empty string');
        if (configure == null) return world;
        if (typeof configure === 'object' && !Array.isArray(configure)) {
            const handlers = _sanitizeHandlers(configure);
            world.scripts.register(id, () => handlers);
            return world;
        }
        if (typeof configure !== 'function') throw new Error('world.script: configure must be a function or object');
        world.scripts.register(id, (w, eid, args) => {
            const [helper, handlers, assertHandlersUsed] = _makeHelper(w, eid, args);
            const result = configure(helper, w, eid, args);
            if (result && typeof result === 'object') Object.assign(handlers, _sanitizeHandlers(result));
            assertHandlersUsed();
            return _sanitizeHandlers(handlers);
        });
        return world;
    };

    world.addScript = function addScript(eid, scriptId, args = {}) {
        world.add(eid, ScriptRef, { id: String(scriptId), args: args || {} });
        return world;
    };

    world.removeScript = function removeScript(eid) {
        if (world.has(eid, ScriptRef)) world.remove(eid, ScriptRef);
        return world;
    };

    if (typeof world.entity !== 'function') {
        world.entity = function entityHandle(id) {
            if (!world.isAlive(id)) throw new Error('entity: id must be alive');
            return new ScriptEntityHandle(world, id);
        };
    }
    return world;
}
