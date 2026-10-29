/*
 * MOTORLABOR: One physical clock and procedural sound on both audio backends.
 * This file is embedded into index.html. It has no runtime dependencies.
 * Audio is an acoustic approximation, not a travelling-wave gas solver.
 */
const SimulationDriver = (() => {
  'use strict';
  // Local references are the same intrinsics. In isolated VM/worklet contexts
  // this avoids repeated context-global proxy lookups on the sample hot path.
  const Math = globalThis.Math, Number = globalThis.Number;
  const PHYSICS_DT = 1 / 24000;

