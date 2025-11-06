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

function callOptional(fn, dt, stats) {
    if (typeof fn === 'function') fn(dt, cloneStats(stats));
}

function notify(listener, stats) {
    if (typeof listener === 'function') listener(cloneStats(stats));
}

/**
 * Create a RAF loop where render frames and simulation ticks advance in lockstep.
 * @param {Object} options
 * @param {(dt:number)=>void} options.stepSim - simulation step callback
 * @param {(dt:number)=>void} [options.stepFx] - FX/display-only systems step callback
 * @param {(stats:Object)=>void} [options.render] - render callback invoked once per RAF frame
 * @param {(dt:number, stats:Object)=>void} [options.beforeFrame]
 * @param {(dt:number, stats:Object)=>void} [options.afterFrame]
 * @param {(stats:Object)=>void} [options.onStats]
 * @param {number} [options.maxDt]
 * @param {number} [options.fpsAlpha]
 * @param {number} [options.fixedSimInterval]
 * @param {number} [options.maxSimSteps]
 * @param {(cb:FrameRequestCallback)=>number} [options.request]
 * @param {(handle:number)=>void} [options.cancel]
 * @param {()=>number} [options.now]
 */
export function createLockstepRafLoop(options) {
    const {
        stepSim,
        stepFx = NOOP,
        render = NOOP,
        beforeFrame,
        afterFrame,
        onStats,
        maxDt = DEFAULT_MAX_DT,
        fpsAlpha = DEFAULT_FPS_ALPHA,
        fixedSimInterval = 0,
        maxSimSteps = Infinity,
        request,
        cancel,
        now,
    } = options || {};

    if (typeof stepSim !== 'function') {
        throw new TypeError('createLockstepRafLoop requires a stepSim(dt) callback');
    }

    const { request: raf, cancel: caf, now: clock } = ensureRaf(request, cancel, now);
    const stats = createBaseStats();
    let statsListener = onStats;
    let rafHandle = null;
    let running = false;
    let lastTime = 0;
    let simAccumulator = 0;

    function stepSimulation(dt) {
        stepSim(dt);
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

        callOptional(beforeFrame, dt, stats);

        if (fixedSimInterval && fixedSimInterval > 0) {
            simAccumulator += dt;
            drainSimAccumulator(maxSimSteps);
            stats.simLag = simAccumulator;
        } else {
            stepSimulation(dt);
            stats.simLag = 0;
        }

        stepFx(dt);
        render(cloneStats(stats));

        callOptional(afterFrame, dt, stats);
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
        stepSimImmediate: stepSimulation,
        getStats: () => cloneStats(stats),
        resetStats,
        setStatsListener: (listener) => { statsListener = listener; },
    };
}

/**
 * Create a RAF loop where render cadence is decoupled from simulation advancement.
 * Simulation ticks are triggered explicitly via advanceSim() or queueSimStep().
 * @param {Object} options
 * @param {(dt:number)=>void} options.stepSim
 * @param {(dt:number)=>void} [options.stepFx]
 * @param {(stats:Object)=>void} [options.render]
 * @param {(dt:number, stats:Object)=>void} [options.beforeFrame]
 * @param {(dt:number, stats:Object)=>void} [options.afterFrame]
 * @param {(stats:Object)=>void} [options.onStats]
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
        stepSim,
        stepFx = NOOP,
        render = NOOP,
        beforeFrame,
        afterFrame,
        onStats,
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

    if (typeof stepSim !== 'function') {
        throw new TypeError('createDualLoopRafLoop requires a stepSim(dt) callback');
    }

    const { request: raf, cancel: caf, now: clock } = ensureRaf(request, cancel, now);
    const stats = createBaseStats();
    let statsListener = onStats;
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
        stepSim(dt);
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

        callOptional(beforeFrame, dt, stats);

        if (!fxPaused) {
            stepFx(dt);
        }

        processQueuedSim();
        render(cloneStats(stats));

        callOptional(afterFrame, dt, stats);
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
    };
}

/**
 * Factory helper that chooses between lockstep and dual-loop RAF adapters.
 * @param {{ mode:'lockstep'|'dual-loop' } & Object} options
 */
export function createRafLoop(options) {
    if (!options || typeof options !== 'object') {
        throw new TypeError('createRafLoop(options) requires an options object with mode');
    }
    const { mode, ...rest } = options;
    if (mode === 'lockstep') return createLockstepRafLoop(rest);
    if (mode === 'dual-loop') return createDualLoopRafLoop(rest);
    throw new Error(`Unknown RAF loop mode: ${mode}`);
}
