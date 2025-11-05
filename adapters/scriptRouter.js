// =========================== 2) adapters/scriptRouter.js =====================
// Generic, domain-configurable adapter that forwards world events to script
// handlers whose names match the event. Event routing is external to core.
import { ScriptMeta } from '../scripts.js';

/**
 * Create a router that wires world events to per-entity script handlers.
 * @param {{ [eventName:string]: (payload:any, world?:any)=>number[] }} routes - map event→resolver returning target entity ids
 * @returns {(world:any)=>void} function that registers listeners on the given world
 */
export function makeScriptRouter(routes) {
    return function wire(world) {
        for (const [ev, resolveIds] of Object.entries(routes)) {
            world.on(ev, (payload) => {
                const ids = (resolveIds?.(payload, world) || []).filter(Boolean);
                for (const eid of ids) {
                    const handlers = world.scripts?.handlersOf?.(eid);
                    const fn = handlers?.[ev];
                    if (typeof fn === 'function') {
                        try { fn(world, eid, payload, { rand: world.rand, emit: (e, p) => world.emit(e, p) }); }
                        catch (e) {
                            const msg = (e && e.stack) ? e.stack : String(e);
                            world.has(eid, ScriptMeta)
                                ? world.set(eid, ScriptMeta, { lastError: msg })
                                : world.add(eid, ScriptMeta, { lastError: msg });
                        }
                    }
                }
            });
        }
    };
}
