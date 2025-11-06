// adapters/raf-adapters.js
// Canonical requestAnimationFrame loop adapters for ECS integrations.

const NOOP = () => {};
const DEFAULT_MAX_DT = 1 / 15; // ~66ms safety clamp
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
            : ((cb) => setTimeout(() => cb(clock()), 16));
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
        rafFrame: 0,
        rafDt: 0,
        fpsEMA: 0,
        totalRafTime: 0,
        simTicks: 0,
        simTime: 0,
        simLag: 0,
        lastSimDt: 0,
        queuedSimTime: 0,
        fxPaused: false,
    };
}

function cloneStats(stats) {
    return { ...stats };
}

function updateFps(stats, dt, alpha) {
    if (dt <= 0) return;
    const instFps = 1 / dt;
    stats.fpsEMA = stats.fpsEMA
        ? stats.fpsEMA + (instFps - stats.fpsEMA) * alpha
        : instFps;
}

function callOptional(fn, dt, stats, time, requestId) {
    if (typeof fn === 'function') fn(dt, cloneStats(stats), time, requestId);
}

function notify(listener, stats) {
    if (typeof listener === 'function') listener(cloneStats(stats));
}

function emitFrameEvent(listener, dt, stats, time, requestId) {
    if (typeof listener === 'function') {
        listener({
            timestamp: time,
            dt,
            requestId,
            stats: cloneStats(stats),
        });
    }
}

/**
 * Create a RAF loop where render frames and simulation ticks advance together in real time.
 * @param {Object} options
 * @param {import('../core.js').World} options.world - world instance to advance
 * @param {(dt:number)=>void} [options.stepFrame] - per-frame side effects (FX, cameras, HUD)
 * @param {(stats:Object, dt?:number, timestamp?:number, requestId?:number)=>void} [options.render]
 * @param {(dt:number, stats:Object, timestamp?:number, requestId?:number)=>void} [options.beforeFrame]
 * @param {(dt:number, stats:Object, timestamp?:number, requestId?:number)=>void} [options.afterFrame]
 * @param {(stats:Object)=>void} [options.onStats]
 * @param {(frame:{timestamp:number, dt:number, requestId:number|null, stats:Object})=>void} [options.onAnimationFrame]
 * @param {number} [options.maxDt]
 * @param {number} [options.fpsAlpha]
 * @param {number} [options.fixedSimInterval]
 * @param {number} [options.maxSimSteps]
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
    const stepFrame = typeof stepFrameOption === 'function'
        ? stepFrameOption
        : NOOP;

    const { request: raf, cancel: caf, now: clock } = ensureRaf(request, cancel, now);
    const stats = createBaseStats();
    let statsListener = onStats;
    let frameListener = onAnimationFrame;
    let rafHandle = null;
    let running = false;
    let lastTime = 0;
    let simAccumulator = 0;

    function stepSimulation(dt) {
        worldStep(dt);
        stats.simTicks += 1;
        stats.simTime += dt;
        stats.lastSimDt = dt;
    }

    function drainSimAccumulator(limit) {
        let steps = 0;
        while (simAccumulator >= fixedSimInterval && steps < limit) {
            stepSimulation(fixedSimInterval);
            simAccumulator -= fixedSimInterval;
            steps += 1;
        }
        return steps;
    }

    function frame(ts) {
        if (!running) return;
        rafHandle = raf(frame);
        const time = typeof ts === 'number' ? ts : clock();
        let dt = Math.max(0, (time - lastTime) / 1000);
        lastTime = time;
        if (dt > maxDt) dt = maxDt;

        stats.rafFrame += 1;
        stats.rafDt = dt;
        stats.totalRafTime += dt;
        updateFps(stats, dt, fpsAlpha);

        callOptional(beforeFrame, dt, stats, time, rafHandle);

        if (fixedSimInterval && fixedSimInterval > 0) {
            simAccumulator += dt;
            drainSimAccumulator(maxSimSteps);
            stats.simLag = simAccumulator;
        } else {
            stepSimulation(dt);
            stats.simLag = 0;
        }

        stepFrame(dt, cloneStats(stats), time, rafHandle);
        render(cloneStats(stats), dt, time, rafHandle);

        callOptional(afterFrame, dt, stats, time, rafHandle);
        emitFrameEvent(frameListener, dt, stats, time, rafHandle);
        notify(statsListener, stats);
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
        simAccumulator = 0;
    }

    return {
        start,
        stop,
        isRunning: () => running,
        stepWorldImmediate: stepSimulation,
        getStats: () => cloneStats(stats),
        resetStats,
        setStatsListener: (listener) => { statsListener = listener; },
        setAnimationFrameListener: (listener) => { frameListener = listener; },
    };
}

/**
 * Create a RAF loop where render cadence is decoupled from simulation advancement.
 * Simulation ticks are triggered explicitly via advanceSim() or queueSimStep().
 * @param {Object} options
 * @param {import('../core.js').World} options.world
 * @param {(dt:number)=>void} [options.stepFrame]
 * @param {(stats:Object, dt?:number, timestamp?:number, requestId?:number)=>void} [options.render]
 * @param {(dt:number, stats:Object, timestamp?:number, requestId?:number)=>void} [options.beforeFrame]
 * @param {(dt:number, stats:Object, timestamp?:number, requestId?:number)=>void} [options.afterFrame]
 * @param {(stats:Object)=>void} [options.onStats]
 * @param {(frame:{timestamp:number, dt:number, requestId:number|null, stats:Object})=>void} [options.onAnimationFrame]
 * @param {number} [options.maxDt]
 * @param {number} [options.fpsAlpha]
 * @param {number} [options.fixedSimInterval]
 * @param {number} [options.maxSimSteps]
 * @param {number} [options.maxQueuedStepsPerFrame]
 * @param {boolean} [options.idleSimStep]
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
        idleSimStep = true,
        request,
        cancel,
        now,
    } = options || {};

    const worldStep = resolveWorldStep(world);
    const stepFrame = typeof stepFrameOption === 'function'
        ? stepFrameOption
        : NOOP;

    const { request: raf, cancel: caf, now: clock } = ensureRaf(request, cancel, now);
    const stats = createBaseStats();
    let statsListener = onStats;
    let frameListener = onAnimationFrame;
    let rafHandle = null;
    let running = false;
    let fxPaused = false;
    let lastTime = 0;
    let queuedSimTime = 0;
    let simAccumulator = 0;

    function updateFxPaused(flag) {
        fxPaused = !!flag;
        stats.fxPaused = fxPaused;
    }

    function stepSimulation(dt) {
        worldStep(dt);
        stats.simTicks += 1;
        stats.simTime += dt;
        stats.lastSimDt = dt;
    }

    function drainSimAccumulator(limit) {
        if (!(fixedSimInterval && fixedSimInterval > 0)) return 0;
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
        const time = typeof ts === 'number' ? ts : clock();
        let dt = Math.max(0, (time - lastTime) / 1000);
        lastTime = time;
        if (dt > maxDt) dt = maxDt;

        stats.rafFrame += 1;
        stats.rafDt = dt;
        stats.totalRafTime += dt;
        updateFps(stats, dt, fpsAlpha);

        callOptional(beforeFrame, dt, stats, time, rafHandle);

        if (!fxPaused) {
            stepFrame(dt, cloneStats(stats), time, rafHandle);
        }

        processQueuedSim();
        render(cloneStats(stats), dt, time, rafHandle);

        callOptional(afterFrame, dt, stats, time, rafHandle);
        emitFrameEvent(frameListener, dt, stats, time, rafHandle);
        notify(statsListener, stats);
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
        updateFxPaused(false);
    }

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
        pauseFx: () => updateFxPaused(true),
        resumeFx: () => updateFxPaused(false),
        isFxPaused: () => fxPaused,
        advanceSim,
        queueSimStep,
        processQueuedSim,
        getStats: () => cloneStats(stats),
        resetStats,
        setStatsListener: (listener) => { statsListener = listener; },
        setAnimationFrameListener: (listener) => { frameListener = listener; },
    };
}

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
