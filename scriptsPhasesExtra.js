
// ====================== 8) ecs/scriptsPhasesExtra.js (OPTIONAL) =============
// Subtle per-phase overrides without changing core semantics.
// You can:
// - register extra tick phases (e.g., 'scripts:early', 'scripts:late')
// - opt-in per-entity phase selection with a small ScriptPhase component
// Backward compatible: if you ignore this file, default 'scripts' phase works.
//
// FILE: ecs/scriptsPhasesExtra.js
import { defineComponent } from './core.js';
import { registerSystem } from './systems.js';
import { ScriptRef, ScriptMeta } from './scripts.js';


// Optional per-entity override: which phase should this script's tick run in?
export const ScriptPhase = defineComponent('ScriptPhase', { tick: 'scripts' }, {
    validate(rec) { return typeof rec?.tick === 'string' && rec.tick.length > 0; }
});


// Register an additional tick phase that calls a named hook (default 'onTick').
export function addScriptTickPhase(phaseName, hookName = 'onTick') {
    function ScriptTickAtPhase(world, dt) {
        for (const [eid] of world.query(ScriptRef)) {
            // If entity declares a ScriptPhase, only run when it matches this phase
            const sp = world.get(eid, ScriptPhase);
            if (sp && sp.tick !== phaseName) continue;
            const h = world.scripts?.handlersOf?.(eid);
            const fn = h && h[hookName];
            if (typeof fn === 'function') {
                try { fn(world, eid, dt, { rand: world.rand, emit: (e, p) => world.emit(e, p) }); }
                catch (e) {
                    const msg = (e && e.stack) ? e.stack : String(e);
                    world.has(eid, ScriptMeta)
                      ? world.set(eid, ScriptMeta, { lastError: msg })
                      : world.add(eid, ScriptMeta, { lastError: msg });
                }
            }
        }
    }
    registerSystem(ScriptTickAtPhase, phaseName);
}

/*
USAGE EXAMPLES:


// a) Three-tier scripts schedule
import { addScriptTickPhase } from './ecs/scriptsPhasesExtra.js';
addScriptTickPhase('scripts:early', 'onTickEarly');
// 'scripts' (mid) already exists via core scripts.js calling onTick
addScriptTickPhase('scripts:late', 'onTickLate');


// Your scheduler can then be:
world.setScheduler(composeScheduler('intents','resolve','scripts:early','scripts','scripts:late','effects','cleanup'));


// b) Per-entity phase override
import { ScriptPhase } from './ecs/scriptsPhasesExtra.js';
world.add(potionId, ScriptPhase, { tick: 'scripts:early' });


// c) Combat-specific phases
addScriptTickPhase('combat:early', 'onCombatEarly');
addScriptTickPhase('combat:late', 'onCombatLate');


// Entities can implement those optional hooks if they care.
*/
// ============================================================================
