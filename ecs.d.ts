export type StoreMode = 'map' | 'soa';

export interface Logger {
  info(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
  debug(...args: any[]): void;
}

export type LoggerLike = Logger | ((...args: any[]) => void);

export type FrameRequestCallback = (timestamp: number) => void;

export interface WorldOptions {
  seed?: number;
  store?: StoreMode;
  strict?: boolean;
  debug?: boolean;
  onTick?: (duration: number, world: World) => void;
  logger?: LoggerLike | null;
}

export interface Component<T = any> {
  key: symbol;
  name: string;
  defaults: Readonly<T>;
  validate?(value: T): boolean;
  isTag?: boolean;
}

export type ComponentTerm<T extends Component<any> = Component<any>> =
  | T
  | ReturnType<typeof Not>
  | ReturnType<typeof Changed>;

export function defineComponent<T extends Record<string, any>>(name: string, defaults: T, options?: {
  validate?(value: T): boolean;
}): Component<T>;

export function defineTag(name: string): Component<Record<string, never>> & { isTag: true };

export interface ComponentBuilder<T extends Record<string, any>> {
  defaults(values: Partial<T>): this;
  validate(fn: (value: T) => boolean): this;
  taggable(): Component<T> & { isTag: true };
  tag(): Component<Record<string, never>> & { isTag: true };
  build(): Component<T>;
  create(): Component<T>;
}

export function Component<T extends Record<string, any> = any>(name: string): ComponentBuilder<T>;

export interface QueryResult<T> extends Iterable<T> {
  run(fn: T extends any[] ? (...value: T) => void : (value: T) => void): World;
  count(options?: { cheap?: boolean }): number;
}

export interface QueryHandle<T = any> {
  (): QueryResult<T>;
  where(predicate: (...args: any[]) => boolean): QueryHandle<T>;
  project<R>(projector: (...args: any[]) => R): QueryHandle<R>;
  orderBy(comparator: (...args: any[]) => number): QueryHandle<T>;
  offset(value: number): QueryHandle<T>;
  limit(value: number): QueryHandle<T>;
}

export interface StrictContext {
  op: string;
  args: any[];
  world: World;
  error: Error;
  defer(): void;
}

export type StrictHandler = (context: StrictContext) => 'ignore' | 'defer' | void;

export interface EventDisposer {
  (): void;
}

export interface WorldDebugProfilePhase {
  phase: string;
  duration: number;
}

export interface WorldDebugProfileEntry {
  phase: string;
  system: (world: World, dt: number) => void;
  name: string;
  duration: number;
}

export interface WorldDebugProfilePayload {
  total: number;
  dt: number;
  systems: WorldDebugProfileEntry[];
  phases: WorldDebugProfilePhase[];
}

export interface WorldDebug {
  enable(on?: boolean): this;
  useTimeSource(fn: () => number): this;
  now(): number;
  enableProfiling(on?: boolean): this;
  isProfiling(): boolean;
  onProfile(fn: (profile: WorldDebugProfilePayload, world: World) => void): () => void;
  clearProfiles(): this;
  inspect(entity: number): { id: number; alive: boolean; components: Record<string, any>; removed: string[] };
  forget(entity: number): this;
  lastProfile: WorldDebugProfilePayload | null;
}

export class World {
  constructor(options?: WorldOptions);
  static create(options?: WorldOptions): WorldBuilder;

  logger: Logger;
  debug: WorldDebug;
  scheduler: ((world: World, dt: number) => void) | null;
  seed: number;
  rand: () => number;
  strict: boolean;
  time: number;
  step: number;

  setLogger(logger: LoggerLike | null | undefined): this;
  setScheduler(fn: (world: World, dt: number) => void): this;
  system(fn: (world: World, dt: number) => void, phase?: string, opts?: { before?: Function[]; after?: Function[] }): this;
  tick(dt: number): void;

  create(): number;
  destroy(id: number): boolean | null;
  isAlive(id: number): boolean;

  add<T>(id: number, component: Component<T>, values?: Partial<T>): T | null;
  set<T>(id: number, component: Component<T>, patch: Partial<T>): T | null;
  mutate<T>(id: number, component: Component<T>, fn: (value: T) => void): T | null;
  get<T>(id: number, component: Component<T>): T | null;
  getInstance<T>(id: number, component: Component<T>): T | null;
  has(id: number, component: Component<any>): boolean;
  remove(id: number, component: Component<any>): boolean | null;

  query<T extends any[]>(...terms: [...ComponentTerm[], object?]): QueryResult<T>;
  defineQuery<T extends any[]>(...terms: [...ComponentTerm[], object?]): QueryHandle<T>;

  command(op: any): this;
  pendingOps(): any[];

  onStrictError(handler: StrictHandler): this;

  markChanged(id: number, component: Component<any>): void;
  changed(id: number, component: Component<any>): boolean;

  enableDebug(on?: boolean): this;

  on(event: string | symbol, handler: (payload: any, world: World) => void): EventDisposer;
  off(event: string | symbol, handler: (payload: any, world: World) => void): void;
  emit(event: string | symbol, payload?: any): number;

  script?(id: string, configure: ScriptConfigure): this;
  addScript?(entity: number, id: string, args?: any): this;
  removeScript?(entity: number): this;
  entity?(id: number): ScriptEntityHandle;

  scripts?: ScriptsAPI;
}

export class WorldBuilder {
  constructor(options?: WorldOptions);
  useSoA(): this;
  useMap(): this;
  withSeed(seed: number): this;
  enableStrict(on?: boolean): this;
  enableDebug(on?: boolean): this;
  withLogger(logger: LoggerLike | null | undefined): this;
  withOptions(options: WorldOptions): this;
  withScheduler(...steps: (string | ((world: World, dt: number) => void))[]): this;
  withSchedulerFn(fn: (world: World, dt: number) => void): this;
  withPhases(...phases: string[]): this;
  system(fn: (world: World, dt: number) => void, phase?: string, opts?: { before?: Function[]; after?: Function[] }): this;
  install(installer: (world: World) => void): this;
  onStrictError(handler: StrictHandler): this;
  useScripts(options?: { phase?: string; autoPhase?: boolean }): this;
  build(): World;
}

export const Not: <T extends Component<any>>(component: T) => { kind: symbol; Comp: T };
export const Changed: <T extends Component<any>>(component: T) => { kind: symbol; Comp: T };

export function composeScheduler(...steps: (string | ((world: World, dt: number) => void))[]): (world: World, dt: number) => void;

export interface Archetype {
  name: string;
  steps: any[];
}

export type ArchetypeOverride = Map<string | symbol, any> | Record<string | symbol, any>;

export type ArchetypeStep =
  | ((world: World, id: number, params: any) => void)
  | [Component<any>, any]
  | { use: Archetype; with?: ArchetypeOverride }
  | { t: 'comp'; Comp: Component<any>; init: any };

export function defineArchetype(name: string, ...steps: ArchetypeStep[]): Archetype;
export function compose(name: string, ...parts: (Archetype | ArchetypeStep | ArchetypeStep[])[]): Archetype;
export function createFrom(world: World, archetype: Archetype, params?: Record<string, any>): number;
export function createMany(world: World, archetype: Archetype, count: number, paramsMaker?: (i: number, id: number) => any): number[];
export function createDeferred(world: World, archetype: Archetype, params?: Record<string, any>): void;
export function withOverrides(archetype: Archetype, overrides: ArchetypeOverride): Archetype;
export function cloneFrom(world: World, sourceId: number, comps?: Component<any>[]): number;

export interface ArchetypeBuilder {
  add<T>(component: Component<T>, init?: Partial<T> | ((params: any, world: World, id: number) => Partial<T> | undefined | void)): ArchetypeBuilder;
  include(...steps: (Archetype | ArchetypeStep | ArchetypeStep[])[]): ArchetypeBuilder;
  step(fn: (world: World, id: number, params: any) => void): ArchetypeBuilder;
  run(fn: (world: World, id: number, params: any) => void): ArchetypeBuilder;
  use(archetype: Archetype, overrides?: ArchetypeOverride): ArchetypeBuilder;
  with(overrides: ArchetypeOverride): ArchetypeBuilder;
  build(name?: string): Archetype;
  create(name?: string): Archetype;
}

export function Archetype(name: string): ArchetypeBuilder;

export function registerSystem(system: (world: World, dt: number) => void, phase: string, opts?: {
  before?: ((world: World, dt: number) => void)[];
  after?: ((world: World, dt: number) => void)[];
}): { system: (world: World, dt: number) => void; before: Set<Function>; after: Set<Function> };

export function getOrderedSystems(phase: string): ((world: World, dt: number) => void)[];
export function setSystemOrder(phase: string, systems: ((world: World, dt: number) => void)[]): void;
export function runSystems(phase: string, world: World, dt: number): void;
export function runPhases(phases: string[], world: World, dt: number): void;
export function clearSystems(): void;
export function visualizeGraph(options?: { phase?: string }): string;

export interface SystemsStepConfig {
  before(...systems: ((world: World, dt: number) => void)[]): SystemsStepConfig;
  after(...systems: ((world: World, dt: number) => void)[]): SystemsStepConfig;
  add(system: (world: World, dt: number) => void, opts?: { before?: Function[]; after?: Function[] }): SystemsStepConfig;
  list(): ((world: World, dt: number) => void)[];
  clear(): SystemsPhaseBuilder;
  order(...systems: ((world: World, dt: number) => void)[]): SystemsPhaseBuilder;
}

export interface SystemsPhaseBuilder {
  add(system: (world: World, dt: number) => void, opts?: { before?: Function[]; after?: Function[] }): SystemsStepConfig;
  clear(): SystemsPhaseBuilder;
  list(): ((world: World, dt: number) => void)[];
  order(...systems: ((world: World, dt: number) => void)[]): SystemsPhaseBuilder;
}

export const Systems: {
  phase(name: string): SystemsPhaseBuilder;
  clear(): typeof Systems;
  list(name: string): ((world: World, dt: number) => void)[];
  visualizeGraph(options?: { phase?: string }): string;
};

export const Parent: Component<{ first: number; last: number; count: number }>;
export const Sibling: Component<{ parent: number; prev: number; next: number; index: number }>;
export function ensureParent(world: World, id: number): number;
export function isChild(world: World, id: number): boolean;
export function getParent(world: World, child: number): number;
export function children(world: World, parent: number): Iterable<number>;
export function childrenWith(world: World, parent: number, ...components: Component<any>[]): Iterable<any>;
export function childCount(world: World, parent: number): number;
export function attach(world: World, child: number, parent: number, opts?: { before?: number; after?: number; index?: number }): number;
export function detach(world: World, child: number, opts?: { remove?: boolean }): number;
export function destroySubtree(world: World, root: number): void;
export function reparent(world: World, child: number, parent: number, opts?: { before?: number; after?: number; index?: number }): number;
export function indexOf(world: World, child: number): number;
export function nthChild(world: World, parent: number, index: number): number;

export interface TreeAttachBuilder {
  to(parent: number, opts?: { before?: number; after?: number; index?: number }): TreeOrderBuilder;
}

export interface TreeOrderBuilder {
  before(id: number): TreeOrderBuilder;
  after(id: number): TreeOrderBuilder;
  at(index: number): TreeOrderBuilder;
  first(): TreeOrderBuilder;
  last(): TreeOrderBuilder;
  append(): TreeOrderBuilder;
  to(parent: number, opts?: { before?: number; after?: number; index?: number }): TreeOrderBuilder;
  done(): TreeFacade;
}

export interface TreeFacade {
  attach(child: number): TreeAttachBuilder;
  reparent(child: number): TreeAttachBuilder;
  detach(child: number, opts?: { remove?: boolean }): TreeFacade;
  destroySubtree(root: number): TreeFacade;
  ensure(parent: number): TreeFacade;
  children(parent: number): number[];
  childrenWith(parent: number, ...components: Component<any>[]): any[];
  childCount(parent: number): number;
}

export function Tree(world: World): TreeFacade;

export const PHASE_SCRIPTS: string;
export const ScriptRef: Component<{ id: string; args: any }>;
export const ScriptMeta: Component<{ lastError: string; invoked: number; version: number }>;

export interface ScriptsAPI {
  register(id: string, factory: (world: World, entity: number, args: any) => Record<string, Function>): void;
  clear(): void;
  handlersOf(entity: number): Record<string, Function> | null;
  refresh(): void;
}

export type ScriptConfigure =
  | Record<string, Function>
  | ((helpers: ScriptHelpers, world: World, entity: number, args: any) => Record<string, Function> | void);

export interface ScriptHelpers {
  world: World;
  entity: number;
  args: any;
  on(name: string, fn: Function): ScriptHelpers;
  use(source: Record<string, Function> | ((world: World, entity: number, args: any) => Record<string, Function> | void)): ScriptHelpers;
  [handler: string]: any;
}

export interface ScriptEntityHandle {
  addScript(id: string, args?: any): ScriptEntityHandle;
  removeScript(): ScriptEntityHandle;
  script(): { id: string; args: any } | null;
}

export interface ScriptsInstallerOptions {
  phase?: string;
}

export function installScriptsAPI(world: World, options?: ScriptsInstallerOptions): World;

export interface RafLoopStats {
  rafFrame: number;
  rafDt: number;
  fpsEMA: number;
  totalRafTime: number;
  simTicks: number;
  simTime: number;
  simLag: number;
  lastSimDt: number;
  queuedSimTime: number;
  frameTasksPaused: boolean;
  frameCount: number;
  frameDt: number;
  fps: number;
  simDt: number;
}

export interface RafLoopFrameEvent {
  timestamp: number;
  dt: number;
  requestId: number | null;
  stats: RafLoopStats;
}

export interface RafLoopController {
  start(options?: { reset?: boolean }): void;
  stop(): void;
  isRunning(): boolean;
  stepWorldImmediate(dt: number): void;
  getStats(): RafLoopStats;
  resetStats(): void;
  setStatsListener(listener: (stats: RafLoopStats) => void): void;
  setAnimationFrameListener(listener: (frame: RafLoopFrameEvent) => void): void;
}

export interface RafLoopOptions {
  world: World;
  stepFrame?: (dt: number, stats: RafLoopStats, timestamp?: number, requestId?: number) => void;
  render?: (stats: RafLoopStats, dt?: number, timestamp?: number, requestId?: number) => void;
  beforeFrame?: (dt: number, stats: RafLoopStats, timestamp?: number, requestId?: number) => void;
  afterFrame?: (dt: number, stats: RafLoopStats, timestamp?: number, requestId?: number) => void;
  onStats?: (stats: RafLoopStats) => void;
  onAnimationFrame?: (frame: RafLoopFrameEvent) => void;
  maxDt?: number;
  fpsAlpha?: number;
  fixedSimInterval?: number;
  maxSimSteps?: number;
  request?: (cb: FrameRequestCallback) => number;
  cancel?: (handle: number) => void;
  now?: () => number;
}

export interface DualRafLoopOptions extends RafLoopOptions {
  maxQueuedStepsPerFrame?: number;
  idleSimStep?: boolean;
}

export function createRealtimeRafLoop(options: RafLoopOptions): RafLoopController;
export function createDualLoopRafLoop(options: DualRafLoopOptions): RafLoopController;

export interface RafLoopBuilder {
  world(world: World): RafLoopBuilder;
  before(fn: (dt: number, stats: RafLoopStats, timestamp?: number, requestId?: number) => void): RafLoopBuilder;
  step(fn: (dt: number, stats: RafLoopStats, timestamp?: number, requestId?: number) => void): RafLoopBuilder;
  render(fn: (stats: RafLoopStats, dt?: number, timestamp?: number, requestId?: number) => void): RafLoopBuilder;
  after(fn: (dt: number, stats: RafLoopStats, timestamp?: number, requestId?: number) => void): RafLoopBuilder;
  onStats(fn: (stats: RafLoopStats) => void): RafLoopBuilder;
  onFrame(fn: (frame: RafLoopFrameEvent) => void): RafLoopBuilder;
  maxDt(value: number): RafLoopBuilder;
  fpsAlpha(value: number): RafLoopBuilder;
  fixed(interval: number): RafLoopBuilder;
  maxSimSteps(value: number): RafLoopBuilder;
  queueLimit(value: number): RafLoopBuilder;
  idleSim(flag?: boolean): RafLoopBuilder;
  raf(request: (cb: FrameRequestCallback) => number, cancel?: (handle: number) => void): RafLoopBuilder;
  timeSource(now: () => number): RafLoopBuilder;
  options(opts: Partial<RafLoopOptions>): RafLoopBuilder;
  build(extra?: Partial<RafLoopOptions>): RafLoopController;
  start(options?: { reset?: boolean }): RafLoopController;
}

export const RafLoop: {
  realtime(world?: World, opts?: Partial<RafLoopOptions>): RafLoopBuilder;
  dual(world?: World, opts?: Partial<DualRafLoopOptions>): RafLoopBuilder;
};

export function createLogger(logger?: LoggerLike | null): Logger;
