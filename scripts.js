// ================================= 1) ecs/scripting.js ========================
// First-class scripting: ScriptRef + attach/tick systems bound to a built-in phase.
// This file does not bake in any concrete event names — routing is externalized.

// FILE: ecs/scripts.js
import { defineComponent, Changed } from './core.js';
import { registerSystem } from './systems.js';

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
registerSystem(ScriptAttachSystem, PHASE_SCRIPTS, { before: [ScriptTickSystem] });
registerSystem(ScriptTickSystem, PHASE_SCRIPTS);

// Public convenience API — attaches a scripting facet onto world instances
export function installScriptsAPI(world) {
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
    return world;
}
