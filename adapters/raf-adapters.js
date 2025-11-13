// adapters/raf-adapters.js
// Canonical requestAnimationFrame loop adapters for ECS integrations.
// - No dependencies, no rendering assumptions.
// - Works with worlds that expose either world.step(dt) or world.tick(dt).
// - All dt values are in *seconds*. Timestamps come from performance.now()/Date.now() in *milliseconds*.

const NOOP = () => {};
const DEFAULT_MAX_DT = 1 / 15; // ~66ms clamp for burst-lag safety
const DEFAULT_FPS_ALPHA = 0.1;

function makeNow(now) {
    if (typeof now === 'function') return now;
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return () => performance.now();
    }
    return () => Date.now();
}

function ensureRaf(request, cancel, now) {
    const clock = makeNow(now);

    const req = (typeof request === 'function')
        ? request
        : (typeof requestAnimationFrame === 'function')
            ? requestAnimationFrame.bind(globalThis)
            : ((cb) => setTimeout(() => cb(clock()), 1000 / 60));

    const caf = (typeof cancel === 'function')
        ? cancel
        : (typeof cancelAnimationFrame === 'function')
            ? cancelAnimationFrame.bind(globalThis)
            : ((id) => clearTimeout(id));

    return { request: req, cancel: caf, now: clock };
}

function resolveWorldStep(world) {
    if (!world || typeof world !== 'object') {
        throw new TypeError('RAF adapters require a world instance');
    }
    const step = typeof world.step === 'function' ? world.step.bind(world) : null;
    const tick = typeof world.tick === 'function' ? world.tick.bind(world) : null;
    if (step) return step;
    if (tick) return tick;
    throw new TypeError('World instance must expose a step(dt) or tick(dt) method');
}

function createBaseStats() {
    return {
        // RAF / frame stats
        rafFrame: 0,
        rafDt: 0,                // seconds
        fpsEMA: 0,               // exponential moving average of FPS
        totalRafTime: 0,         // seconds

        // Simulation stats
        simTicks: 0,
        simTime: 0,              // seconds of simulated time advanced
        simLag: 0,               // seconds of unprocessed sim time in accumulator/queue
        lastSimDt: 0,            // seconds (last sim step)
        queuedSimTime: 0,        // seconds (decoupled mode queue)

        // Control flags
        frameTasksPaused: false,
    };
}

function cloneStats(stats) {
    // Shallow copy is sufficient (all fields are primitives)
    const view = { ...stats };
    view.frameCount = stats.rafFrame;
    view.frameDt = stats.rafDt;
    view.fps = stats.fpsEMA;
    view.simTime = stats.simTime;
    view.simTicks = stats.simTicks;
    view.simDt = stats.lastSimDt;
    view.simLag = stats.simLag;
    return view;
}

function updateFps(stats, dt, alpha) {
    if (dt <= 0) return;
    const instFps = 1 / dt;
    stats.fpsEMA = stats.fpsEMA
        ? stats.fpsEMA + (instFps - stats.fpsEMA) * alpha
        : instFps;
}

// Helper to invoke optional hooks with a shared per-frame statsView
function callOptional(fn, dt, statsView, time, requestId) {
    if (typeof fn === 'function') fn(dt, statsView, time, requestId);
}

function notify(listener, statsView) {
    if (typeof listener === 'function') listener(statsView);
}

function emitFrameEvent(listener, dt, statsView, time, requestId) {
    if (typeof listener === 'function') {
        listener({
            timestamp: time, // ms
            dt,              // seconds
            requestId,
            stats: statsView
        });
    }
}

/**
 * Create a RAF loop where render frames and simulation ticks advance together in real time.
 *
 * Time semantics:
 * - All dt arguments are in *seconds*.
 * - Timestamps are from performance.now()/Date.now() in *milliseconds*.
 *
 * Callback signatures (actual call order):
 * - beforeFrame(dtSec, statsView, timestampMs, requestId?)
 * - stepFrame(dtSec,  statsView, timestampMs, requestId?)
 * - render(statsView, dtSec,     timestampMs, requestId?)
 * - afterFrame(dtSec, statsView, timestampMs, requestId?)
 * - onStats(statsView)
 * - onAnimationFrame({ timestamp, dt, requestId, stats })
 *
 * @param {Object} options
 * @param {import('../core.js').World} options.world - world instance to advance
 * @param {(dt:number, stats:Object, timestamp?:number, requestId?:number)=>void} [options.stepFrame] - per-frame side effects (FX, cameras, HUD)
 * @param {(stats:Object, dt?:number, timestamp?:number, requestId?:number)=>void} [options.render]
 * @param {(dt:number, stats:Object, timestamp?:number, requestId?:number)=>void} [options.beforeFrame]
 * @param {(dt:number, stats:Object, timestamp?:number, requestId?:number)=>void} [options.afterFrame]
 * @param {(stats:Object)=>void} [options.onStats]
 * @param {(frame:{timestamp:number, dt:number, requestId:number|null, stats:Object})=>void} [options.onAnimationFrame]
 * @param {number} [options.maxDt]                 - clamp (seconds) for burst-lag (default ~66ms)
 * @param {number} [options.fpsAlpha]              - EMA smoothing factor for fps
 * @param {number} [options.fixedSimInterval]      - if >0, run fixed-step sim with accumulator (seconds)
 * @param {number} [options.maxSimSteps]           - cap sim steps per frame when accumulator overflows
 * @param {(cb:FrameRequestCallback)=>number} [options.request]
 * @param {(handle:number)=>void} [options.cancel]
 * @param {()=>number} [options.now]
 */
export function createRealtimeRafLoop(options) {
    const {
        world,
        stepFrame: stepFrameOption,
        render = NOOP,
        beforeFrame,
        afterFrame,
        onStats,
        onAnimationFrame,
        maxDt = DEFAULT_MAX_DT,
        fpsAlpha = DEFAULT_FPS_ALPHA,
        fixedSimInterval = 0,
        maxSimSteps = Infinity,
        request,
        cancel,
        now,
    } = options || {};

    const worldStep = resolveWorldStep(world);
    const stepFrame = typeof stepFrameOption === 'function' ? stepFrameOption : NOOP;

    const { request: raf, cancel: caf, now: clock } = ensureRaf(request, cancel, now);
    const stats = createBaseStats();
    let statsListener = onStats;
    let frameListener = onAnimationFrame;

    let rafHandle = null;
    let running = false;
    let lastTime = 0;       // ms
    let simAccumulator = 0; // seconds

    function stepSimulation(dt) {
        worldStep(dt);
        stats.simTicks += 1;
        stats.simTime += dt;
        stats.lastSimDt = dt;
    }

    function drainSimAccumulator(limit) {
        let steps = 0;
        const ceiling = Number.isFinite(limit) ? limit : Infinity;
        while (fixedSimInterval > 0 && simAccumulator >= fixedSimInterval && steps < ceiling) {
            stepSimulation(fixedSimInterval);
            simAccumulator -= fixedSimInterval;
            steps += 1;
        }
        return steps;
    }

    function frame(ts) {
        if (!running) return;
        rafHandle = raf(frame);

        const time = typeof ts === 'number' ? ts : clock(); // ms
        let dt = Math.max(0, (time - lastTime) / 1000);     // seconds
        lastTime = time;
        if (dt > maxDt) dt = maxDt;

        stats.rafFrame += 1;
        stats.rafDt = dt;
        stats.totalRafTime += dt;
        updateFps(stats, dt, fpsAlpha);

        // Single per-frame immutable view to minimize GC
        const statsView = cloneStats(stats);

        callOptional(beforeFrame, dt, statsView, time, rafHandle);

        if (fixedSimInterval && fixedSimInterval > 0) {
            simAccumulator += dt;
            drainSimAccumulator(maxSimSteps);
            stats.simLag = simAccumulator;
        } else {
            stepSimulation(dt);
            stats.simLag = 0;
        }

        // Refresh view after sim updates
        const statsView2 = cloneStats(stats);

        stepFrame(dt, statsView2, time, rafHandle);
        render(statsView2, dt, time, rafHandle);

        callOptional(afterFrame, dt, statsView2, time, rafHandle);
        emitFrameEvent(frameListener, dt, statsView2, time, rafHandle);
        notify(statsListener, statsView2);
    }

    function start({ reset = false } = {}) {
        if (running) return;
        if (reset) resetStats();
        running = true;
        lastTime = clock(); // seed to avoid giant first dt
        rafHandle = raf(frame);
    }

    function stop() {
        if (!running) return;
        running = false;
        if (rafHandle !== null) {
            caf(rafHandle);
            rafHandle = null;
        }
    }

    function resetStats() {
        Object.assign(stats, createBaseStats());
        simAccumulator = 0;
    }

    return {
        start,
        stop,
        isRunning: () => running,
        stepWorldImmediate: stepSimulation, // keep as-is per request
        getStats: () => cloneStats(stats),
        resetStats,
        setStatsListener: (listener) => { statsListener = listener; },
        setAnimationFrameListener: (listener) => { frameListener = listener; },
    };
}

/**
 * Create a RAF loop where render cadence is decoupled from simulation advancement.
 * Simulation ticks are triggered via advanceSim() or queueSimStep(). The RAF drives presentation.
 *
 * Time semantics:
 * - dt parameters are *seconds*.
 * - timestamp is *milliseconds* from performance.now()/Date.now().
 *
 * Callback signatures (actual call order):
 * - beforeFrame(dtSec, statsView, timestampMs, requestId?)
 * - stepFrame(dtSec,  statsView, timestampMs, requestId?)
 * - render(statsView, dtSec,     timestampMs, requestId?)
 * - afterFrame(dtSec, statsView, timestampMs, requestId?)
 * - onStats(statsView)
 * - onAnimationFrame({ timestamp, dt, requestId, stats })
 *
 * @param {Object} options
 * @param {import('../core.js').World} options.world
 * @param {(dt:number, stats:Object, timestamp?:number, requestId?:number)=>void} [options.stepFrame]
 * @param {(stats:Object, dt?:number, timestamp?:number, requestId?:number)=>void} [options.render]
 * @param {(dt:number, stats:Object, timestamp?:number, requestId?:number)=>void} [options.beforeFrame]
 * @param {(dt:number, stats:Object, timestamp?:number, requestId?:number)=>void} [options.afterFrame]
 * @param {(stats:Object)=>void} [options.onStats]
 * @param {(frame:{timestamp:number, dt:number, requestId:number|null, stats:Object})=>void} [options.onAnimationFrame]
 * @param {number} [options.maxDt]
 * @param {number} [options.fpsAlpha]
 * @param {number} [options.fixedSimInterval]         - if >0, steps use an accumulator (seconds)
 * @param {number} [options.maxSimSteps]              - cap accumulator drain per frame
 * @param {number} [options.maxQueuedStepsPerFrame]   - cap queued drain per frame (fixed-step mode)
 * @param {boolean} [options.idleSimStep=false]       - when true, emit stepSimulation(0) if nothing is queued
 * @param {(cb:FrameRequestCallback)=>number} [options.request]
 * @param {(handle:number)=>void} [options.cancel]
 * @param {()=>number} [options.now]
 */
export function createDualLoopRafLoop(options) {
    const {
        world,
        stepFrame: stepFrameOption,
        render = NOOP,
        beforeFrame,
        afterFrame,
        onStats,
        onAnimationFrame,
        maxDt = DEFAULT_MAX_DT,
        fpsAlpha = DEFAULT_FPS_ALPHA,
        fixedSimInterval = 0,
        maxSimSteps = Infinity,
        maxQueuedStepsPerFrame = Infinity,
        idleSimStep = false, // default to false (less surprising)
        request,
        cancel,
        now,
    } = options || {};

    const worldStep = resolveWorldStep(world);
    const stepFrame = typeof stepFrameOption === 'function' ? stepFrameOption : NOOP;

    const { request: raf, cancel: caf, now: clock } = ensureRaf(request, cancel, now);
    const stats = createBaseStats();
    let statsListener = onStats;
    let frameListener = onAnimationFrame;

    let rafHandle = null;
    let running = false;
    let frameTasksPaused = false;
    let lastTime = 0;          // ms
    let queuedSimTime = 0;     // seconds
    let simAccumulator = 0;    // seconds

    function updateFrameTasksPaused(flag) {
        frameTasksPaused = !!flag;
        stats.frameTasksPaused = frameTasksPaused;
    }

    function stepSimulation(dt) {
        worldStep(dt);
        stats.simTicks += 1;
        stats.simTime += dt;
        stats.lastSimDt = dt;
    }

    function drainSimAccumulator(limit) {
        if (!(fixedSimInterval && fixedSimInterval > 0)) {
            stats.simLag = queuedSimTime;
            return 0;
        }
        let steps = 0;
        const ceiling = Number.isFinite(limit) ? limit : Infinity;
        while (simAccumulator >= fixedSimInterval && steps < ceiling) {
            stepSimulation(fixedSimInterval);
            simAccumulator -= fixedSimInterval;
            steps += 1;
        }
        stats.simLag = simAccumulator + queuedSimTime;
        return steps;
    }

    function processQueuedSim() {
        let processed = 0;
        if (queuedSimTime > 0) {
            if (fixedSimInterval && fixedSimInterval > 0) {
                simAccumulator += queuedSimTime;
                queuedSimTime = 0;
                processed = drainSimAccumulator(maxQueuedStepsPerFrame);
            } else {
                const dt = queuedSimTime;
                queuedSimTime = 0;
                stepSimulation(dt);
                processed = 1;
            }
        } else if (idleSimStep) {
            // Maintain "heartbeat" for systems listening to ticks even when no time is queued
            stepSimulation(0);
            processed = 1;
        }
        stats.queuedSimTime = queuedSimTime;
        stats.simLag = simAccumulator + queuedSimTime;
        return processed;
    }

    function frame(ts) {
        if (!running) return;
        rafHandle = raf(frame);

        const time = typeof ts === 'number' ? ts : clock(); // ms
        let dt = Math.max(0, (time - lastTime) / 1000);     // seconds
        lastTime = time;
        if (dt > maxDt) dt = maxDt;

        stats.rafFrame += 1;
        stats.rafDt = dt;
        stats.totalRafTime += dt;
        updateFps(stats, dt, fpsAlpha);

        // One per-frame immutable view before any changes
        const statsView = cloneStats(stats);

        callOptional(beforeFrame, dt, statsView, time, rafHandle);

        if (!frameTasksPaused) {
            stepFrame(dt, statsView, time, rafHandle);
        }

        // Process any queued / accumulated sim time *after* stepFrame so visuals can lead or follow intentionally
        processQueuedSim();

        // Refresh view after potential sim updates
        const statsView2 = cloneStats(stats);

        render(statsView2, dt, time, rafHandle);

        callOptional(afterFrame, dt, statsView2, time, rafHandle);
        emitFrameEvent(frameListener, dt, statsView2, time, rafHandle);
        notify(statsListener, statsView2);
    }

    function start({ reset = false } = {}) {
        if (running) return;
        if (reset) resetStats();
        running = true;
        lastTime = clock();
        rafHandle = raf(frame);
    }

    function stop() {
        if (!running) return;
        running = false;
        if (rafHandle !== null) {
            caf(rafHandle);
            rafHandle = null;
        }
    }

    function resetStats() {
        Object.assign(stats, createBaseStats());
        queuedSimTime = 0;
        simAccumulator = 0;
        updateFrameTasksPaused(false);
    }

    /**
     * Immediately advance simulation by delta seconds (or fixed steps via accumulator).
     * Returns a shallow clone of current stats after advancement.
     */
    function advanceSim(dt = fixedSimInterval || 0, { maxSteps = maxSimSteps } = {}) {
        const delta = Math.max(0, Number(dt) || 0);
        if (fixedSimInterval && fixedSimInterval > 0) {
            simAccumulator += delta;
            const steps = drainSimAccumulator(maxSteps);
            if (steps === 0 && idleSimStep && delta === 0) {
                stepSimulation(0);
            }
        } else {
            stepSimulation(delta);
        }
        stats.simLag = simAccumulator + queuedSimTime;
        return cloneStats(stats);
    }

    /**
     * Queue simulation time to be processed on the next RAF frame(s).
     * Returns a shallow clone of current stats after queuing.
     */
    function queueSimStep(dt = fixedSimInterval || 0) {
        const delta = Math.max(0, Number(dt) || 0);
        queuedSimTime += delta;
        stats.queuedSimTime = queuedSimTime;
        stats.simLag = simAccumulator + queuedSimTime;
        return cloneStats(stats);
    }

    return {
        start,
        stop,
        isRunning: () => running,
        pauseFrameTasks: () => updateFrameTasksPaused(true),
        resumeFrameTasks: () => updateFrameTasksPaused(false),
        areFrameTasksPaused: () => frameTasksPaused,
        advanceSim,
        queueSimStep,
        processQueuedSim,
        getStats: () => cloneStats(stats),
        resetStats,
        setStatsListener: (listener) => { statsListener = listener; },
        setAnimationFrameListener: (listener) => { frameListener = listener; },
    };
}

class RafLoopBuilder {
    constructor(factory, defaults = {}) {
        this._factory = factory;
        this._opts = { ...(defaults || {}) };
    }

    world(world) { this._opts.world = world; return this; }
    before(fn) { this._opts.beforeFrame = fn; return this; }
    step(fn) { this._opts.stepFrame = fn; return this; }
    render(fn) { this._opts.render = fn; return this; }
    after(fn) { this._opts.afterFrame = fn; return this; }
    onStats(fn) { this._opts.onStats = fn; return this; }
    onFrame(fn) { this._opts.onAnimationFrame = fn; return this; }
    maxDt(value) { this._opts.maxDt = value; return this; }
    fpsAlpha(value) { this._opts.fpsAlpha = value; return this; }
    fixed(interval) { this._opts.fixedSimInterval = interval; return this; }
    maxSimSteps(value) { this._opts.maxSimSteps = value; return this; }
    queueLimit(value) { this._opts.maxQueuedStepsPerFrame = value; return this; }
    idleSim(flag = true) { this._opts.idleSimStep = flag; return this; }
    raf(request, cancel) { this._opts.request = request; this._opts.cancel = cancel; return this; }
    timeSource(now) { this._opts.now = now; return this; }
    options(opts = {}) { Object.assign(this._opts, opts || {}); return this; }
    build(extra = {}) { return this._factory({ ...this._opts, ...(extra || {}) }); }
    start(startOptions) { const loop = this.build(); loop.start(startOptions); return loop; }
}

export const RafLoop = {
    realtime(world, opts = {}) {
        const builder = new RafLoopBuilder(createRealtimeRafLoop, opts || {});
        if (world) builder.world(world);
        return builder;
    },
    dual(world, opts = {}) {
        const builder = new RafLoopBuilder(createDualLoopRafLoop, opts || {});
        if (world) builder.world(world);
        return builder;
    }
};

/**
 * Factory helper that chooses between realtime and dual-loop RAF adapters.
 * @param {{ mode:'realtime'|'dual-loop' } & Object} options
 */
export function createRafLoop(options) {
    if (!options || typeof options !== 'object') {
        throw new TypeError('createRafLoop(options) requires an options object with mode');
    }
    const { mode, ...rest } = options;
    if (mode === 'realtime') return createRealtimeRafLoop(rest);
    if (mode === 'dual-loop') return createDualLoopRafLoop(rest);
    throw new Error(`Unknown RAF loop mode: ${mode}`);
}
