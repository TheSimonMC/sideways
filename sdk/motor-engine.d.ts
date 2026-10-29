/** MotorLab 1.6.3: compatible game wrapper with passive exhaust observations and modular audio. */
export type Json = null | boolean | number | string | Json[] | {[key: string]: Json};
export type Configuration = {[key: string]: Json};
/** Existing signal fields retain their units and meaning. Optional additions support old signal producers. */
export type EngineSignal = {[key: string]: Json} & {
  /** Signed exhaust jet-momentum flux per chamber in N, averaged over the complete physical step. */
  exhaustMomentumFluxes?: number[];
  /** Sum of exhaustMomentumFluxes in N. A passive acoustic observation, not added shaft force or torque. */
  exhaustMomentumFlux?: number;
};
export type EngineConfiguration = Configuration & {
  /** Display the redline marker. This does not enable or disable physical fuel/ignition cut. */
  redlineEnabled?: boolean;
  /** Redline marker and reference RPM. Also used by the limiter when revLimitRpm is zero. */
  redlineRpm?: number;
  /** Enable the physical RPM cut; false leaves RPM to the simulated torque balance. */
  revLimiterEnabled?: boolean;
  /** Separate RPM cut threshold; zero follows redlineRpm. */
  revLimitRpm?: number;
  /** Optional 1-based order, for example '1-8-4-3-6-5-7-2'; empty or absent preserves the legacy order. */
  firingOrder?: string;
};
export type Clock = 'manual' | 'pcm' | 'browser' | 'connecting-audio' | 'disposed';
export type Rate = 1 | 0.25 | 0.1 | 0.02;
export interface CreateOptions {
  preset?: string;
  /** Use boost: 'turbo', turboCount: 2 for two automatically sized parallel units. */
  family?: EngineConfiguration;
  /** Total displacement in cubic centimetres, resizes the existing design. */
  displacementCc?: number;
  overrides?: EngineConfiguration;
  /** Engine config, or {engine, drivetrain} for createVehicle. */
  configuration?: EngineConfiguration | {engine: EngineConfiguration; drivetrain: Configuration};
  /** Opaque, unmodified legacy serialize() result. */
  coreState?: Configuration;
  maxStepsPerUpdate?: number;
}
export interface Inputs {
  throttle?: number;
  /** Positive resisting load in Nm, alias of the legacy load input. */
  loadNm?: number;
  load?: number;
  /** Engine-only signed external shaft torque in Nm; positive accelerates. */
  externalTorqueNm?: number;
  fuel?: boolean;
  ignition?: boolean;
  starter?: boolean;
  starterSeconds?: number;
  lambdaTarget?: number;
  advance?: number;
  injectionAdvance?: number;
  /** Relative charge pressure target in Pa, 0 to 500000. Acts through the real boost valves. */
  boostTarget?: number;
  /** Four-stroke only, -40 to 40 crank degrees; positive advances both valve edges. */
  intakeCamAdvance?: number;
  exhaustCamAdvance?: number;
  cylinders?: boolean[];
  wastegate?: number;
  bypass?: number;
  /** Vehicle only: 1 is pedal depressed, clutch open; 0 is released. */
  clutch?: number;
  brake?: number;
  parking?: boolean;
  reverseUnlock?: boolean;
  /** Vehicle only: -1 reverse, 0 neutral, 1 through the configured forward gear count (at most 12). */
  gear?: number;
  gearRequest?: number;
}
export interface Timing {
  clock: Clock;
  paused: boolean;
  rate: Rate;
  stepSeconds: number;
  maxStepsPerUpdate: number;
  pendingSeconds: number;
  simulatedSeconds: number;
  acceptedSeconds: number;
  discardedSeconds: number;
  totalSteps: number;
  lastUpdate: {acceptedSeconds: number; simulatedSeconds: number; steps: number};
}
export type AudioSource = 'exhaust' | 'intake' | 'combustion' | 'valve' | 'bearing' | 'boost' | 'manifold' | 'mechanical' | 'gearbox' | 'chain';
export interface AudioLayerSettings {
  enabled?: boolean;
  /** Explicitly audition this layer. Several layers can be soloed together. */
  solo?: boolean;
  /** Gain before local distortion, from 0 to 4; default 1. */
  preGain?: number;
  /** Per-layer distortion amount from 0 to 1, multiplied by the global bite control. */
  distortion?: number;
}
export interface AudioEmitterScene {
  position: [number, number, number];
  right: [number, number, number];
  emitters: Array<{id: string; source: AudioSource; position: [number, number, number]; direction?: [number, number, number]; gain?: number; reflections?: Array<{position: [number, number, number]; gain: number}>}>;
}
export interface AudioListenerSettings {
  /** SIDEWAYS extension: explicit world emitters; null restores legacy positioning. */
  scene?: AudioEmitterScene | null;
  mode?: 'direct' | 'outside' | 'engine' | 'cabin';
  /** Listener distance in metres, 0.5 to 20; default 1.5. */
  distance?: number;
  /** Listener azimuth in degrees, -180 to 180; default 90, beside the vehicle. */
  azimuth?: number;
  /** Reflection amount from 0 to 1; default 0.12. */
  reflections?: number;
}
export interface AudioSettings {
  /** Linear final output gain from 0 to 1; default 0.6 for a new session. Saved values are retained. */
  master?: number; exhaust?: number; intake?: number; combustion?: number;
  valve?: number; bearing?: number; boost?: number; muted?: boolean;
  /** Upstream exhaust room, separately from the outlet sound. */
  manifold?: number;
  /** Estimated piston/rod forces and piston contacts; silent on rotary engines. */
  mechanical?: number;
  /** Vehicle transmission; silent for an engine-only session. */
  gearbox?: number;
  /** Declared timing or final-drive chains only. */
  chain?: number;
  /** Global local-distortion strength in [0, 1], default 0.6. Zero bypasses tonal distortion. */
  bite?: number;
  /** Nested patches preserve omitted fields and other layers. Flat source gains remain post-layer levels. */
  layers?: Partial<Record<AudioSource, AudioLayerSettings>>;
  /** Nested patches preserve omitted listener settings. Default mode is outside. */
  listener?: AudioListenerSettings;
}
export interface AudioLevel {rms: number; peak: number; dbRms: number; dbPeak: number;}
export type AudioPreOptions = {config?: EngineConfiguration} & (
  {name: AudioSource; index?: number} | {index: number; name?: AudioSource}
);
export interface AcousticPreDescription {
  name: AudioSource;
  model: 'fixed-linear-source-reference';
  referenceGain: number;
  presenceCornerHz: number;
  radiationStages: 1 | 2;
  /** Steady-state weight after the complete linear pre stage. */
  dcWeight: number;
  lowWeight: number;
  highWeight: number;
  maximumLinearGainBound: number;
  adaptive: false;
  calibratedSPL: false;
}
export interface AcousticPre {
  process(raw: number): number;
  clear(): void;
  describe(): AcousticPreDescription;
}
export interface AudioLayerOptions {
  name?: string;
  index?: number;
  /** Maximum independent layer contribution; default 0.1. */
  budget?: number;
  /** Absolute coefficient sum of a subsequent output filter, at least 1; default 1. */
  outputKernelNorm?: number;
  /** Local distortion oversampling; default 2. This does not change the physics clock. */
  oversample?: 2 | 4;
}
export interface AcousticLayer {
  readonly latencySamples: number;
  process(input: number, preGain?: number, distortion?: number, bite?: number): number;
  clear(): void;
}
export interface AcousticListenerDescription {
  model: 'generic-two-ear';
  settings: Required<AudioListenerSettings>;
  soundSpeed: number;
  listenerPosition: number[];
  headRadius: number;
  sources: Array<{
    name: AudioSource;
    position: number[];
    leftDelaySeconds: number;
    rightDelaySeconds: number;
    leftGain: number;
    rightGain: number;
  }>;
  calibratedHRTF: false;
  linear: true;
}
export interface AcousticListener {
  outputL: number; outputR: number;
  configure(config: EngineConfiguration): void;
  setSettings(patch: AudioListenerSettings): void;
  process(layers: Float64Array): void;
  clear(): void;
  describe(): AcousticListenerDescription;
}
export interface AcousticMeter {
  available: boolean; windowSeconds: number; master: AudioLevel;
  sources: Record<AudioSource, AudioLevel>;
  layers: Record<AudioSource, AudioLevel>;
  mix: {guaranteedPeak: number; ceiling: number; limiterGain: number; headroomDb: number; reserveGain?: number; exhaustBaseBudget?: number; exhaustPresenceBudget?: number};
}
export interface MotorAcoustics {
  outputL: number; outputR: number;
  configure(config: EngineConfiguration): void;
  clear(): void;
  setAudio(patch: AudioSettings): void;
  setPlaybackRate(rate: Rate): void;
  /** Physical signal supplied by the legacy engine. Optional exhaustMomentumFluxes/Flux are in N; absent fields retain the legacy flow path. */
  capture(signal: {[key: string]: unknown}): void;
  sample(fraction: number, active: boolean, transitionGain: number): void;
  /** Reads and resets the acoustic measurement window. */
  meter(): AcousticMeter;
}
export interface AudioModules {
  Pre: new (sampleRate: number, options: AudioPreOptions) => AcousticPre;
  Layer: new (sampleRate: number, options?: AudioLayerOptions) => AcousticLayer;
  Listener: new (sampleRate: number, sourceNames: readonly AudioSource[], engineConfig: EngineConfiguration) => AcousticListener;
  Acoustics: new (sampleRate: number, engineConfig: EngineConfiguration) => MotorAcoustics;
}
export interface AudioStatus {
  connected: boolean;
  backend: 'none' | 'pcm' | 'script-processor';
  contextState: string | null;
  sampleRate: number | null;
  bufferSize: number | null;
  volume: number;
  muted: boolean;
  meter: {rms: number; peak: number; frames: number};
  /** Last measured source window on the acoustic clock, not a resetting read. */
  sourceWindowSeconds?: number;
  /** Legacy source plane after the flat fader, before local processing and master. */
  sources?: Partial<Record<AudioSource, AudioLevel>>;
  /** Actual processed layer after its flat post fader, before listener rendering and master. */
  layers?: Partial<Record<AudioSource, AudioLevel>>;
  /** Headroom comes from the emitted/resampled Float32 block. */
  mix?: {guaranteedPeak: number; ceiling: number; limiterGain: number; headroomDb: number; reserveGain?: number; exhaustBaseBudget?: number; exhaustPresenceBudget?: number};
  error: string | null;
}
/** Actual rate-limited cam positions in crank degrees; positive advances the valve edges. */
export interface CamPhaserState {
  intakeAdvance: number;
  exhaustAdvance: number;
}
/** Physical state of one parallel turbocharger. Hardware values are per unit. */
export interface TurboUnitState {
  angle: number;
  omega: number;
  rpm: number;
  energy: number;
  compressorFlow: number;
  compressorPower: number;
  compressorPressureRise: number;
  turbineFlow: number;
  turbinePower: number;
  wastegateFlow: number;
  wastegateOpening: number;
  bypassFlow: number;
  bypassOpening: number;
  surgeEvents: number;
  surgeActive: boolean;
  [key: string]: unknown;
}
export interface BoostState {
  /** First shaft; use units for all parallel shafts. */
  angle: number;
  omega: number;
  rpm: number;
  /** Sum of shaft energies. Flows and powers are also totals. */
  energy: number;
  compressorFlow: number;
  compressorPower: number;
  turbinePower: number;
  /** Present only for a parallel twin-turbo engine. */
  units?: TurboUnitState[];
  [key: string]: unknown;
}
export interface GameState {
  kind: 'engine' | 'vehicle'; time: number; rpm: number; omega: number;
  torque: number; brakeTorque: number; meanTorque: number; power: number;
  shaftAngularVelocityRadPerSec: number;
  /** Null for engine-only sessions. */
  speedMps: number | null;
  speedKph: number | null;
  config: EngineConfiguration;
  /** Actual physical cutoff state, independent of the optional redline marker. */
  revCut: boolean;
  controls: Inputs;
  camPhaser: CamPhaserState;
  boost: BoostState;
  drive?: {[key: string]: Json};
  signal: EngineSignal;
  totals: {[key: string]: Json};
  timing: Timing;
  audio: AudioStatus;
  /** Other real legacy snapshot fields remain available. */
  [key: string]: unknown;
}
export interface SaveDocument {
  format: 'MotorLab.Session'; version: 1; kind: 'engine' | 'vehicle';
  coreState: Configuration;
  timing: Timing;
  externalTorqueNm: number;
  audio: AudioSettings;
}
/** Minimal transport interfaces also compile in projects without DOM lib types. */
export interface AudioContextLike {
  state: string;
  sampleRate: number;
  destination: unknown;
  resume(): Promise<void>;
  close(): Promise<void>;
  createScriptProcessor(bufferSize: number, inputChannels: number, outputChannels: number): AudioNodeLike;
}
export interface AudioNodeLike {
  /** Broad callback boundary accepts the native AudioProcessingEvent signature. */
  onaudioprocess: ((event: any) => any) | null;
  connect(destination: any): unknown;
  disconnect(): void;
}
export interface AudioOptions { context?: AudioContextLike; destination?: unknown; bufferSize?: number; timeoutMs?: number; }
export interface Session {
  readonly kind: 'engine' | 'vehicle';
  start(options?: {starterSeconds?: number}): this;
  stop(): this;
  pause(paused?: boolean): this;
  setInputs(inputs: Inputs): this;
  applyShaftImpulse(impulseNmSeconds: number): {impulse: number; work: number};
  setRate(rate: Rate): this;
  setVolume(volume: number): this;
  setAudio(settings: AudioSettings): this;
  update(deltaSeconds: number, options?: {maxSteps?: number}): GameState;
  getState(): GameState;
  getTiming(): Timing;
  getAudioStatus(): AudioStatus;
  discardPendingTime(): number;
  save(): SaveDocument;
  load(document: SaveDocument): this;
  loadCoreState(state: Configuration): this;
  reset(): this;
  renderAudio(left: Float32Array, right: Float32Array, options?: {sampleRate?: number}): AudioStatus;
  connectAudio(options?: AudioOptions): Promise<AudioStatus>;
  enableAudio(options?: AudioOptions): Promise<AudioStatus>;
  disconnectAudio(): Promise<AudioStatus>;
  dispose(): Promise<void>;
}
/** Legacy exports retain their original shapes; no adapter prototypes are injected. */
export const EngineCore: any;
export const VehicleCore: any;
export const SimulationDriver: any;
export interface MotorLabAPI {
  readonly version: string; readonly physicsRelease: number; readonly audioRelease: number; readonly stepSeconds: number;
  /** Advanced reusable stages; these constructors do not own a physical clock or audio device. */
  audioModules(): AudioModules;
  createEngine(options?: string | CreateOptions): Session;
  createVehicle(options?: string | CreateOptions): Session;
  fromState(document: SaveDocument): Session;
  presets(): string[];
  readonly legacy: {EngineCore: typeof EngineCore; VehicleCore: typeof VehicleCore; SimulationDriver: typeof SimulationDriver};
}
export const MotorLab: MotorLabAPI;
export default MotorLab;
declare global {
  const MotorLab: MotorLabAPI;
}
