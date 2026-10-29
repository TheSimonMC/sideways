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

  // This class is copied verbatim into both isolated execution contexts.
  // History is written into reusable numeric storage on the audio thread.
  class MotorRuntime {
    constructor(post) {
      this.post = post;
      this.engine = null;
      this.model = null;
      this.dt = 1 / 24000;
      this.paused = false;
      this.rate = 1;
      this.failed = false;
      this.history = new Float64Array(0);
      this.historyCount = 0;
      this.historyDropped = 0;
      this.lastBin = null;
      this.lastHistoryTime = -Infinity;
      this.ratio = 1;
      this.audioMeter = null;
      this.audioBlockFrames = 0;
      this.audioSampleRate = 0;
      this.commandSequence = 0;
      this.configurationId = 0;
    }
    static silentMeter(available) {
      const zero = () => ({ rms: 0, peak: 0, dbRms: -120, dbPeak: -120 });
      const sources = {};
      for (const key of ['exhaust', 'intake', 'combustion', 'valve', 'bearing', 'boost', 'manifold', 'mechanical', 'gearbox', 'chain']) sources[key] = zero();
      return { available, windowSeconds: 0, master: zero(), sources };
    }
    configure(message) {
      const check = VehicleCore.validate(message.config);
      if (!check.ok) throw new Error(check.errors.join(' '));
      this.model = new VehicleCore.Simulation(check.config, { dt: this.dt });
      this.engine = this.model.engine;
      // One row contains vehicle values plus every physical gas chamber.
      // Rotary engines have three chambers per rotor; no cylinder is dropped.
      this.history = new Float64Array(1500 * (12 + this.engine.cyl.length * 3));
      if (message.serialized) this.model.restore(message.serialized);
      if (message.controls) {
        const overlay = { ...message.controls };
        // A restored starter includes its physical-clock deadline. A cached
        // starter:true would cancel that deadline and must never be reapplied.
        if (message.serialized) { delete overlay.starter; delete overlay.starterSeconds; }
        this.model.setControls(overlay);
      }
      this.paused = !!message.paused;
      this.rate = Number.isFinite(message.rate) ? message.rate : 1;
      this.failed = false;
      this.commandSequence = Number.isSafeInteger(message.commandSequence) ? message.commandSequence : 0;
      this.configurationId = Number.isSafeInteger(message.configurationId) ? message.configurationId : 0;
      this.ratio = 1;
      this.historyCount = 0;
      this.historyDropped = 0;
      this.lastHistoryTime = -Infinity;
      this.lastBin = null;
      this.record();
    }
    fail(error) {
      if (this.failed) return;
      this.failed = true;
      this.paused = true;
      this.post({ type: 'error', message: 'Simulation angehalten: ' + (error && error.message ? error.message : String(error)) });
    }
    record() {
      const e = this.engine;
      if (!e) return;
      const bin = Math.floor(e.angle / (Math.PI / 90));
      if (bin === this.lastBin && e.time - this.lastHistoryTime < 0.01 - 1e-10) return;
      this.lastBin = bin;
      this.lastHistoryTime = e.time;
      if (this.historyCount >= 1500) { this.historyDropped++; return; }
      const n = e.cyl.length;
      const stride = 12 + n * 3;
      let k = this.historyCount++ * stride;
      this.history[k++] = e.time;
      this.history[k++] = e.angle;
      this.history[k++] = e.omega * 30 / Math.PI;
      this.history[k++] = e.torque;
      const d = this.model.drive;
      this.history[k++] = d.v;
      this.history[k++] = d.gear;
      this.history[k++] = d.clutchTorque;
      this.history[k++] = d.clutchSlip;
      this.history[k++] = e.intake.p - e.config.ambientP;
      this.history[k++] = e.meanTorque;
      this.history[k++] = e.power;
      this.history[k++] = this.model.controls.brake;
      for (let i = 0; i < n; i++) {
        this.history[k++] = e.cyl[i].p;
        this.history[k++] = e.cyl[i].volume;
        this.history[k++] = e.cyl[i].phase;
      }
    }
    step() {
      if (!this.engine || this.failed) return;
      try {
        this.model.step(this.dt);
        this.record();
      } catch (error) { this.fail(error); }
    }
    push(backend) {
      if (!this.engine) return;
      try {
        const s = this.model.snapshot();
        s.audioMeter = this.audioMeter ? this.audioMeter() : MotorRuntime.silentMeter(false);
        const stride = 12 + s.cyl.length * 3;
        const packed = this.history.slice(0, this.historyCount * stride);
        s.timing = { backend, dt: this.dt, rate: this.rate, paused: this.paused, realtimeRatio: this.ratio,
          historyAngleStep: 2, historyDropped: this.historyDropped, failed: this.failed,
          audioBlockFrames: this.audioBlockFrames || null, audioSampleRate: this.audioSampleRate || null };
        // An AudioContext can disappear without answering a final handoff.
        // Preserve the last published REAL model state and the commands that
        // have actually been applied to it. Recovery may rewind the short
        // unpublished interval; it never fabricates a new running engine.
        const recovery = { serialized: this.model.serialize(), config: this.model.config,
          controls: s.controls, paused: this.paused, rate: this.rate,
          commandSequence: this.commandSequence, configurationId: this.configurationId };
        this.post({ type: 'snapshot', snapshot: s, packed, stride, count: this.historyCount, recovery }, [packed.buffer]);
        this.historyCount = 0;
        this.historyDropped = 0;
      } catch (error) { this.fail(error); }
    }
    command(message, backend) {
      try {
        let publish = false;
        switch (message.type) {
          case 'controls':
            if (this.engine && !this.failed) this.model.setControls(message.controls);
            publish = this.paused;
            break;
          case 'freeze':
            this.paused = true;
            if (this.model && !this.failed) this.model.setControls(message.controls || {});
            publish = true;
            break;
          case 'paused':
            if (!this.failed) this.paused = !!message.paused;
            publish = true;
            break;
          case 'rate':
            if (![1, 0.25, 0.1, 0.02].includes(message.rate)) throw new Error('Ungültiger Zeitfaktor.');
            this.rate = message.rate;
            break;
          case 'step':
            if (this.paused && !this.failed) {
              for (let i = 0; i < 24; i++) this.step();
              publish = true;
            }
            break;
          case 'handoff': {
            if (!this.engine) throw new Error('Kein Motorzustand vorhanden.');
            const paused = this.paused;
            this.paused = true;
            this.post({ type: 'reply', id: message.id, serialized: this.model.serialize(), paused,
              rate: this.rate, config: this.model.config, controls: this.model.snapshot().controls,
              commandSequence: this.commandSequence, configurationId: this.configurationId });
            return;
          }
          case 'resumeHandoff':
            this.paused = !!message.paused;
            this.rate = message.rate;
            // One message makes the control boundary atomic with respect to
            // physical steps. Only fresh user commands are replayed, once.
            for (const command of message.commands || []) {
              if (['controls', 'paused', 'rate', 'step'].includes(command.type)) this.command(command, backend);
            }
            publish = true;
            break;
        }
        if (Number.isSafeInteger(message.commandSequence)) this.commandSequence = Math.max(this.commandSequence, message.commandSequence);
        if (publish) this.push(backend);
        if (message.id) this.post({ type: 'reply', id: message.id, ok: true });
      } catch (error) {
        if (message.id) this.post({ type: 'reply', id: message.id, error: error.message || String(error) });
        this.fail(error);
      }
    }
  }

  // Fixed linear source calibration before AcousticLayer. The raw solver and
  // radiation signals have different numerical reference units; these static
  // factors are engineering calibration, not an SPL or OEM microphone model.
  // No RMS detector, other voice, throttle clock or free oscillator is used.
  class AcousticPre {
    constructor(sr, options = {}) {
      if (!(Number.isFinite(sr) && sr >= 8000)) throw new RangeError('Ungültige Pre-Abtastrate.');
      const names = ['exhaust','intake','combustion','valve','bearing','boost','manifold','mechanical','gearbox','chain'];
      const index = Number.isInteger(options.index) ? options.index : names.indexOf(options.name);
      if (index < 0 || index >= names.length) throw new RangeError('Unbekannte Pre-Quelle.');
      const c = options.config || {}, temperature = Math.max(150, Math.min(350, Number.isFinite(c.ambientT) ? c.ambientT : 293.15));
      const soundSpeed = Math.sqrt(1.4 * 287 * temperature);
      const exhaustDiameter = Math.max(.015, Number.isFinite(c.exhaustDiameter) ? c.exhaustDiameter : .06);
      const intakeDiameter = Math.max(.015, Number.isFinite(c.intakeDiameter) ? c.intakeDiameter : .06);
      const structureSize = Math.max(.025, c.kind === 'rotary' ? 2 * (c.rotorRadius || .1) : (c.bore || .086));
      // Presence is a named shelf, followed for exhaust/collector pressure by
      // a second bounded differentiating section. This explicit engineering
      // radiation profile keeps slow gas displacement from masking the fronts.
      // Its corner follows aperture/structure size within a finite useful band;
      // it is not a measured OEM transfer function or additional gas dynamics.
      // Contacts have zero DC weight, so an isolated contact has no lasting area.
      const gains = [3,.30,.10,.08,1,.10,4,.06,.50,.25];
      const low = [.06,.22,.18,0,1,.82,.10,.12,.28,.40];
      const corners = [
        Math.max(650, Math.min(2000, 1.6 * soundSpeed / (2 * Math.PI * exhaustDiameter))),
        Math.max(300, Math.min(1000, .55 * soundSpeed / (2 * Math.PI * intakeDiameter))),
        Math.max(350, Math.min(850, 45 / structureSize)),
        Math.max(600, Math.min(1800, 80 / structureSize)),
        100, 2200,
        Math.max(650, Math.min(2000, 1.6 * soundSpeed / (2 * Math.PI * exhaustDiameter))),
        Math.max(400, Math.min(1200, 55 / structureSize)),
        600, 1800
      ];
      this.sr = sr; this.name = names[index]; this.index = index;
      this.bankCount = c.kind !== 'rotary' && ['v','boxer','w'].includes(c.layout) ? (c.layout === 'w' ? 4 : 2) : 1;
      this.referenceGain = gains[index] / (index === 0 ? this.bankCount : 1);
      // The mechanical compressor's sustained transport texture uses the
      // established reference. The higher turbo reference exposes its relief
      // flow without also doubling supercharger hiss; shaft phase stays clean.
      if (index === 5 && c.boost === 'supercharger') this.referenceGain = .05;
      this.radiationStages = index === 0 || index === 6 ? 2 : 1;
      this.lowWeight = low[index];
      this.cornerHz = Math.min(.35 * sr, corners[index]);
      // The optional force-presence voice owns a separate fixed transfer.
      // Six broad, nonresonant sections keep its small independent peak
      // allowance on pressure-front detail rather than slow displacement.
      // This is authored digital calibration, not six physical derivatives
      // or an OEM acoustic measurement. The original source Pre stays exact.
      this.presenceReference = index === 0 && options.profile === 'exhaust-presence';
      if (this.presenceReference) {
        this.referenceGain = 1359.375 / this.bankCount;
        this.cornerHz = Math.min(.35 * sr, 1500);
        this.radiationStages = 6;
        this.presenceLow = new Float64Array(6);
      }
      this.pole = 1 - Math.exp(-2 * Math.PI * this.cornerHz / sr);
      this.linearBoundGain = this.presenceReference ? this.referenceGain * 64 :
        this.referenceGain * (2 - this.lowWeight) * (this.radiationStages === 2 ? 2 : 1);
      this.clear();
    }
    clear() { this.low2 = this.low = this.input = this.output = 0; this.presenceLow?.fill(0); }
    process(raw) {
      if (!Number.isFinite(raw)) throw new RangeError('Nicht endlicher Pre-Eingang.');
      this.input = raw;
      if (this.presenceReference) {
        for (let i = 0; i < this.presenceLow.length; i++) {
          this.presenceLow[i] += this.pole * (raw - this.presenceLow[i]);
          raw -= this.presenceLow[i];
        }
        this.output = this.referenceGain * raw;
        return this.output;
      }
      this.low += this.pole * (raw - this.low);
      let shaped = raw - (1 - this.lowWeight) * this.low;
      if (this.radiationStages === 2) { this.low2 += this.pole * (shaped - this.low2); shaped -= this.low2; }
      this.output = this.referenceGain * shaped;
      return this.output;
    }
    describe() {
      return {name: this.name, model: 'fixed-linear-source-reference', sourceReference: this.presenceReference ? 'additive-jet-force-presence' : 'legacy-flow', referenceGain: this.referenceGain,
        presenceCornerHz: this.cornerHz, radiationStages: this.radiationStages,
        dcWeight: this.radiationStages >= 2 ? 0 : this.lowWeight, lowWeight: this.presenceReference ? 0 : this.lowWeight, highWeight: 1,
        maximumLinearGainBound: this.linearBoundGain, adaptive: false, calibratedSPL: false};
    }
  }

  // One independently owned acoustic voice. This class is also serialized into
  // the Worklet and SDK module, so it has no outer-scope runtime dependencies.
  // Parameters supplied to process() are already smoothed by MotorAcoustics.
  class AcousticLayer {
    constructor(sr, options = {}) {
      if (!(Number.isFinite(sr) && sr >= 8000)) throw new RangeError('Ungültige Layer-Abtastrate.');
      const budget = options.budget === undefined ? .1 : options.budget;
      const outputNorm = options.outputKernelNorm === undefined ? 1 : options.outputKernelNorm;
      if (!(Number.isFinite(budget) && budget > 0 && Number.isFinite(outputNorm) && outputNorm >= 1))
        throw new RangeError('Ungültige Layer-Spitzenreserve.');
      this.sr = sr;
      this.name = typeof options.name === 'string' ? options.name : '';
      this.index = Number.isInteger(options.index) ? options.index : 0;
      this.budget = budget;
      this.outputKernelNorm = outputNorm;
      this.bound = budget / outputNorm;
      this.oversample = options.oversample === 4 ? 4 : 2;
      // Both rates retain the same four-device-sample FIR group delay. ADAA
      // averages one oversampled interval and contributes another half of it.
      this.latencySamples = 4 + .5 / this.oversample;
      this.kernelLength = 8 * this.oversample + 1;
      const middle = (this.kernelLength - 1) / 2;
      this.kernel = new Float64Array(this.kernelLength);
      this.dryHistory = new Float64Array(this.kernelLength);
      this.wetHistory = new Float64Array(this.kernelLength);
      let sum = 0;
      for (let i = 0; i < this.kernelLength; i++) {
        const x = i - middle;
        const window = .42 - .5 * Math.cos(2 * Math.PI * i / (this.kernelLength - 1)) +
          .08 * Math.cos(4 * Math.PI * i / (this.kernelLength - 1));
        const value = x === 0 ? 1 / this.oversample : x % this.oversample === 0 ? 0 :
          Math.sin(Math.PI * x / this.oversample) / (Math.PI * x) * window;
        this.kernel[i] = value;
        sum += value;
      }
      this.kernelNorm = 0;
      for (let i = 0; i < this.kernelLength; i++) {
        this.kernel[i] /= sum;
        this.kernelNorm += Math.abs(this.kernel[i]);
      }
      // Sparse symmetric convolution: two histories, one set of coefficients.
      // Exact sinc zeros are omitted rather than multiplied in the sample loop.
      let pairCount = 0;
      for (let i = 0; i < middle; i++) if (Math.abs(this.kernel[i]) > 1e-16) pairCount++;
      this.pairOffsets = new Int32Array(pairCount);
      this.pairWeights = new Float64Array(pairCount);
      for (let i = 0, p = 0; i < middle; i++) if (Math.abs(this.kernel[i]) > 1e-16) {
        this.pairOffsets[p] = i;
        this.pairWeights[p++] = this.kernel[i];
      }
      this.middle = middle;
      this.centerWeight = this.kernel[middle];
      // A convex dry/wet mix cannot exceed either branch's bound. The local
      // FIR absolute coefficient sum and the subsequent output norm are both
      // reserved here, independent of the number or state of other voices.
      this.clipLevel = this.bound / this.kernelNorm;
      this.dcPole = Math.exp(-2 * Math.PI * 12 / sr);
      // The nonlinear loop's effective slope falls during strong asymmetric
      // saturation. A nominal 12 Hz servo still acts on low-frequency bias,
      // but settles within the actual startup/analysis window in that case.
      this.biasPole = 1 - Math.exp(-2 * Math.PI * 12 / sr);
      this.clear();
    }
    clear() {
      this.dryHistory.fill(0);
      this.wetHistory.fill(0);
      this.historyIndex = 0;
      this.dcInput = this.dcOutput = this.bias = 0;
      this.previousInput = this.previousDry = this.previousWet = 0;
      this.preSample = this.drySample = this.distortedSample = this.output = 0;
      this.wetAmount = 0;
      // A clear voice has no input, DC, FIR or nonlinear history. This flag
      // only remains true until its first nonzero amplified input; it never
      // becomes a silence detector and cannot truncate an acoustic tail.
      this.initialZeroState = true;
    }
    clipAverage(a, b, level) {
      // Exact first-order antiderivative antialiasing of hard clip. Integrate
      // the piecewise-linear function directly, avoiding subtraction of two
      // large, almost equal primitives. The three common regions are cheap.
      if (a >= level && b >= level) return level;
      if (a <= -level && b <= -level) return -level;
      if (a <= level && a >= -level && b <= level && b >= -level) return .5 * (a + b);
      const lo = Math.min(a, b), hi = Math.max(a, b);
      let area = 0;
      if (lo < -level) area -= level * (Math.min(hi, -level) - lo);
      if (hi > level) area += level * (hi - Math.max(lo, level));
      const innerLo = Math.max(lo, -level), innerHi = Math.min(hi, level);
      if (innerHi > innerLo) area += .5 * (innerHi - innerLo) * (innerHi + innerLo);
      return area / (hi - lo);
    }
    process(input, preGain = 1, distortion = 0, bite = .6) {
      if (!(Number.isFinite(input) && Number.isFinite(preGain) && Number.isFinite(distortion) && Number.isFinite(bite)))
        throw new RangeError('Nicht endlicher Layer-Eingang.');
      const gain = Math.max(0, preGain);
      // This finite-domain guard only catches otherwise overflowing numeric
      // faults. Ordinary acoustic input is many orders of magnitude smaller.
      const amplified = Math.max(-1e100, Math.min(1e100, input * gain));
      const ac = amplified - this.dcInput + this.dcPole * this.dcOutput;
      this.dcInput = amplified;
      this.dcOutput = ac;
      this.preSample = ac;
      const amount = Math.max(0, Math.min(1, distortion));
      const edge = Math.max(0, Math.min(1, bite));
      const wet = amount * edge, dry = 1 - wet;
      const drive = 1 + 7 * edge;
      this.wetAmount = wet;
      const current = ac - this.bias, before = this.previousInput;
      this.previousInput = current;
      let previousDry = this.previousDry, previousWet = this.previousWet;
      let head = this.historyIndex, mean = 0;
      const count = this.kernelLength, rate = this.oversample, level = this.clipLevel;
      if (this.initialZeroState) {
        if (amplified === 0) {
          // Every omitted multiplication would operate on exact zero. Keep
          // the same FIR clock, validated controls and exposed diagnostics;
          // the first nonzero input executes the full original path below.
          head += rate;
          if (head >= count) head -= count;
          this.historyIndex = head;
          return this.output;
        }
        this.initialZeroState = false;
      }
      for (let step = 1; step <= rate; step++) {
        const x = before + (current - before) * (step / rate), driven = x * drive;
        const a = this.clipAverage(x, previousDry, level);
        const b = this.clipAverage(driven, previousWet, level);
        this.dryHistory[head] = a;
        this.wetHistory[head] = b;
        mean += dry * a + wet * b;
        previousDry = x;
        previousWet = driven;
        if (++head === count) head = 0;
      }
      this.previousDry = previousDry;
      this.previousWet = previousWet;
      this.historyIndex = head;
      // A genuinely slow, voice-local servo corrects saturation-generated DC.
      // It is not the former 500-Hz voicing filter and has no other-layer input.
      this.bias += this.biasPole * mean / rate;
      let newest = head - 1;
      if (newest < 0) newest += count;
      let center = newest - this.middle;
      if (center < 0) center += count;
      let dryOut = this.centerWeight * this.dryHistory[center];
      let wetOut = this.centerWeight * this.wetHistory[center];
      for (let i = 0; i < this.pairOffsets.length; i++) {
        const offset = this.pairOffsets[i];
        let a = newest - offset, b = newest - (count - 1 - offset);
        if (a < 0) a += count;
        if (b < 0) b += count;
        const weight = this.pairWeights[i];
        dryOut += weight * (this.dryHistory[a] + this.dryHistory[b]);
        wetOut += weight * (this.wetHistory[a] + this.wetHistory[b]);
      }
      // All three exposed samples are after the same local FIR. A dry bypass
      // therefore retains the same delay as the distortion branch. Master and
      // source faders are deliberately absent and must be applied downstream.
      this.drySample = dryOut;
      this.distortedSample = wetOut;
      this.output = dry * dryOut + wet * wetOut;
      return this.output;
    }
  }

  // A linear scene transfer. Every layer owns its propagation history and its
  // two ear responses. There is no signal-dependent shared gain or compressor.
  // This is a generic two-ear approximation, not a measured personal HRTF.
  class AcousticListener {
    // SIDEWAYS extension: explicit emitters share their layer's one history.
    // No engine state is touched here and no extra synth.sample call is made.
    static validateScene(value) {
      if(value===null)return null;
      const vector=(v,label)=>{if(!Array.isArray(v)||v.length!==3||v.some(n=>!Number.isFinite(n)||Math.abs(n)>1e6))throw new RangeError(label+' requires three finite coordinates.');return v.slice();};
      if(!value||typeof value!=='object'||!Array.isArray(value.emitters)||value.emitters.length>24||!value.emitters.length)throw new RangeError('Invalid emitter scene.');
      const position=vector(value.position,'Listener'),right=vector(value.right,'Ear axis');if(Math.hypot(...right)<.001)throw new RangeError('Ear axis must be nonzero.');
      const known=['exhaust','intake','combustion','valve','bearing','boost','manifold','mechanical','gearbox','chain'],ids=new Set(),totals={};
      const emitters=value.emitters.map(e=>{
        if(!e||typeof e.id!=='string'||!e.id.length||e.id.length>80||ids.has(e.id)||!known.includes(e.source))throw new RangeError('Invalid or duplicate emitter.');ids.add(e.id);
        const gain=e.gain??1;if(!Number.isFinite(gain)||gain<0||gain>1)throw new RangeError('Invalid emitter gain.');totals[e.source]=(totals[e.source]||0)+gain;if(totals[e.source]>1.000001)throw new RangeError('Emitters must share the source gain budget.');
        const reflections=e.reflections??[];if(!Array.isArray(reflections)||reflections.length>4)throw new RangeError('At most four early paths per emitter.');
        return {id:e.id,source:e.source,position:vector(e.position,'Emitter'),direction:vector(e.direction??[0,0,0],'Direction'),gain,reflections:reflections.map(r=>{if(!r||!Number.isFinite(r.gain)||r.gain<0||r.gain>.0375)throw new RangeError('Invalid reflection gain.');return{position:vector(r.position,'Image source'),gain:r.gain};})};
      });
      return {position,right,emitters};
    }
    constructor(sr, names, config) {
      const known=['exhaust','intake','combustion','valve','bearing','boost','manifold','mechanical','gearbox','chain'];
      if(!(Number.isFinite(sr)&&sr>=8000)||!Array.isArray(names)||names.length<1||names.length>10||
        new Set(names).size!==names.length||names.some(name=>!known.includes(name)))throw new RangeError('Ungültige Hörstufen-Konfiguration.');
      this.sr = sr; this.names = names.slice(); this.count = names.length;
      this.kindIndices=Int32Array.from(names,name=>known.indexOf(name));
      this.length = Math.ceil(sr * .65) + 4;
      this.history = new Float64Array(this.length * this.count);
      this.positions = new Float64Array(this.count * 3);
      // delay L/R, ground-delay L/R, gain L/R, air pole, shadow L/R, wet
      this.paths = new Float64Array(this.count * 10);
      this.targets = new Float64Array(this.count * 10);
      this.airL = new Float64Array(this.count); this.airR = new Float64Array(this.count);
      this.shadowL = new Float64Array(this.count); this.shadowR = new Float64Array(this.count);
      this.contributionsL = new Float64Array(this.count); this.contributionsR = new Float64Array(this.count);
      this.headPole = 1 - Math.exp(-2 * Math.PI * 2400 / sr);
      this.settings = {mode:'outside', distance:1.5, azimuth:90, reflections:.12};
      this.configure(config); this.clear();
    }
    configure(config) {
      const small = config.kind !== 'rotary' && config.cylinderCount === 1 &&
        Math.PI * config.bore * config.bore * config.stroke / 4 < .0003;
      this.sceneScale = small ? .48 : 1;
      this.soundSpeed = Math.sqrt(1.4 * 287 * Math.max(150, Math.min(350, config.ambientT || 293.15)));
      const xyz = [0,.42,-1.4, -.25,.9,.9, 0,.65,.8, 0,.95,.8, 0,.45,.8,
        .3,.85,.9, .3,.55,.5, 0,.6,.8, 0,.4,0, .25,.4,-.3];
      for (let i=0;i<this.count;i++)for(let j=0;j<3;j++)this.positions[i*3+j]=xyz[this.kindIndices[i]*3+j]*this.sceneScale;
      this.setSettings(this.settings, true);
    }
    clear() {
      this.history.fill(0); this.airL.fill(0); this.airR.fill(0);
      this.shadowL.fill(0); this.shadowR.fill(0);
      this.contributionsL.fill(0); this.contributionsR.fill(0);
      this.head = 0; this.outputL = this.outputR = 0;
      this.paths.set(this.targets); this.rampRemaining = 0;
      this.sceneBlend = this.sceneTarget;
      if(this.vehiclePaths)for(const p of this.vehiclePaths){p.airL=p.airR=p.shadowL=p.shadowR=0;p.current.set(p.target);}
    }
    setSettings(patch={}, immediate=false) {
      const old=this.settings, s={...old};
      if (['direct','outside','engine','cabin'].includes(patch.mode)) s.mode=patch.mode;
      for (const [key,lo,hi] of [['distance',.5,20],['azimuth',-180,180],['reflections',0,1]])
        if (Number.isFinite(patch[key])) s[key]=Math.max(lo,Math.min(hi,patch[key]));
      if(Object.prototype.hasOwnProperty.call(patch,'scene'))s.scene=AcousticListener.validateScene(patch.scene);
      this.settings=s;
      if(s.scene)this.setVehicleScene(s.scene,immediate);
      const angle=s.azimuth*Math.PI/180, si=Math.sin(angle), co=Math.cos(angle), scale=this.sceneScale;
      const anchor=s.mode==='engine' ? .8*scale : s.mode==='cabin' ? .15*scale : 0;
      const radius=s.distance+(s.mode==='outside'||s.mode==='direct'?1.4*scale:0);
      const lx=si*radius, ly=s.mode==='engine'?1.0:1.45, lz=anchor-co*radius;
      this.listenerPosition=[lx,ly,lz];
      // Facing the scene gives left/right ear positions perpendicular to the
      // viewing direction. Head radius is an explicit generic 8.75 cm.
      const ex=.0875*co, ez=.0875*si;
      const outside=[1,.80,.25,.35,.40,.90,.45,.30,.55,.80];
      const engine=[.55,.95,1,1,.80,1,.85,1,.65,.75];
      const cabin=[.35,.35,.45,.35,.45,.35,.30,.40,.55,.30];
      const transmission=s.mode==='engine'?engine:s.mode==='cabin'?cabin:outside;
      for(let i=0;i<this.count;i++) {
        const p=i*3,k=i*10,id=this.kindIndices[i],sx=this.positions[p],sy=this.positions[p+1],sz=this.positions[p+2];
        const dx=sx-lx,dz=sz-lz,dy=sy-ly;
        const dl=Math.hypot(dx+ex,dy,dz+ez),dr=Math.hypot(dx-ex,dy,dz-ez);
        const gl=Math.hypot(dx+ex,sy+ly,dz+ez),gr=Math.hypot(dx-ex,sy+ly,dz-ez);
        const distance=.5*(dl+dr),side=(dx*co+dz*si)/Math.max(.1,distance);
        this.targets[k]=dl/this.soundSpeed*this.sr; this.targets[k+1]=dr/this.soundSpeed*this.sr;
        this.targets[k+2]=gl/this.soundSpeed*this.sr; this.targets[k+3]=gr/this.soundSpeed*this.sr;
        // Digital level reference is two metres. It is not a Pascal/SPL
        // calibration; near-field gain never exceeds the layer's reservation.
        this.targets[k+4]=transmission[id]*Math.min(1,2/Math.max(.5,dl));
        this.targets[k+5]=transmission[id]*Math.min(1,2/Math.max(.5,dr));
        const airCut=s.mode==='cabin'?2800:18000/(1+.018*distance*distance);
        this.targets[k+6]=1-Math.exp(-2*Math.PI*Math.min(.44*this.sr,airCut)/this.sr);
        this.targets[k+7]=Math.max(0,side)*.48;
        this.targets[k+8]=Math.max(0,-side)*.48;
        this.targets[k+9]=.25*s.reflections;
      }
      this.sceneTarget=s.mode==='direct'?0:1;
      if(immediate){this.paths.set(this.targets);this.sceneBlend=this.sceneTarget;this.rampRemaining=0;}
      else this.rampRemaining=Math.max(1,Math.round(.025*this.sr));
    }
    setVehicleScene(scene,immediate=false){
      const previous=new Map((this.vehiclePaths||[]).map(p=>[p.id,p])),paths=[],ear=scene.right,norm=Math.hypot(...ear),right=ear.map(n=>n/norm),listener=scene.position;
      const transmission=this.settings.mode==='engine'?[.55,.95,1,1,.8,1,.85,1,.65,.75]:[1,.8,.25,.35,.4,.9,.45,.3,.55,.8];
      for(const emitter of scene.emitters){
        const source=this.names.indexOf(emitter.source);if(source<0)continue;
        const direction=emitter.direction,dn=Math.hypot(...direction),toEar=listener.map((n,i)=>n-emitter.position[i]),distance=Math.hypot(...toEar);
        const directivity=dn>.001?.62+.38*Math.max(0,direction.reduce((v,n,i)=>v+n*toEar[i],0)/(dn*Math.max(.01,distance))):1;
        const reflected=emitter.reflections.reduce((n,r)=>n+r.gain,0),directGain=(1-reflected)*emitter.gain*directivity;
        const routes=[{position:emitter.position,gain:directGain},...emitter.reflections.map(r=>({position:r.position,gain:r.gain*emitter.gain}))];
        routes.forEach((route,index)=>{
          const id=emitter.id+':'+index,p=previous.get(id)||{id,source,current:new Float64Array(7),target:new Float64Array(7),airL:0,airR:0,shadowL:0,shadowR:0};
          const delta=route.position.map((n,i)=>n-listener[i]),dl=Math.hypot(...delta.map((n,i)=>n+right[i]*.0875)),dr=Math.hypot(...delta.map((n,i)=>n-right[i]*.0875)),d=(dl+dr)*.5,side=delta.reduce((n,v,i)=>n+v*right[i],0)/Math.max(.1,d);
          const gain=route.gain*transmission[this.kindIndices[source]],cut=(index?8000:18000)/(1+.018*d*d);
          p.target.set([Math.min(this.length-2,dl/this.soundSpeed*this.sr),Math.min(this.length-2,dr/this.soundSpeed*this.sr),gain*Math.min(1,2/Math.max(.5,dl)),gain*Math.min(1,2/Math.max(.5,dr)),1-Math.exp(-2*Math.PI*Math.min(.44*this.sr,cut)/this.sr),Math.max(0,side)*.48,Math.max(0,-side)*.48]);
          if(immediate||!previous.has(id))p.current.set(p.target);paths.push(p);
        });
      }
      this.vehiclePaths=paths;this.vehicleRamp=immediate?0:Math.max(1,Math.round(.025*this.sr));this.listenerPosition=listener.slice();
    }
    processVehicleScene(values){
      for(let i=0;i<this.count;i++){this.history[i*this.length+this.head]=values[i];this.contributionsL[i]=this.contributionsR[i]=0;}
      const inv=this.vehicleRamp>0?1/this.vehicleRamp:0;let left=0,right=0;
      for(const p of this.vehiclePaths){
        const a=p.current;if(inv)for(let i=0;i<7;i++)a[i]+=(p.target[i]-a[i])*inv;
        const base=p.source*this.length,l=this.read(base,a[0]),r=this.read(base,a[1]);p.airL+=(l-p.airL)*a[4];p.airR+=(r-p.airR)*a[4];p.shadowL+=(p.airL-p.shadowL)*this.headPole;p.shadowR+=(p.airR-p.shadowR)*this.headPole;
        const outL=a[2]*(p.airL*(1-a[5])+p.shadowL*a[5]),outR=a[3]*(p.airR*(1-a[6])+p.shadowR*a[6]);left+=outL;right+=outR;this.contributionsL[p.source]+=outL;this.contributionsR[p.source]+=outR;
      }
      if(this.vehicleRamp>0)this.vehicleRamp--;this.outputL=left;this.outputR=right;if(++this.head===this.length)this.head=0;
    }
    read(base, delay) {
      const d=Math.max(0,Math.min(this.length-2,delay)),n=Math.floor(d),fraction=d-n;
      let at=this.head-n;if(at<0)at+=this.length;
      let previous=at-1;if(previous<0)previous+=this.length;
      return this.history[base+at]*(1-fraction)+this.history[base+previous]*fraction;
    }
    process(values) {
      if(this.settings.scene){this.processVehicleScene(values);return;}
      if(this.rampRemaining>0){
        const inv=1/this.rampRemaining;
        for(let i=0;i<this.paths.length;i++)this.paths[i]+=(this.targets[i]-this.paths[i])*inv;
        this.sceneBlend+=(this.sceneTarget-this.sceneBlend)*inv;this.rampRemaining--;
      }
      const blend=this.sceneBlend,paths=this.paths,head=this.head;
      let left=0,right=0;
      for(let i=0;i<this.count;i++){
        const value=values[i],base=i*this.length,k=i*10;
        this.history[base+head]=value;
        const wet=paths[k+9],dry=1-wet;
        const earL=dry*this.read(base,paths[k])+wet*this.read(base,paths[k+2]);
        const earR=dry*this.read(base,paths[k+1])+wet*this.read(base,paths[k+3]);
        const pole=paths[k+6];
        this.airL[i]+=pole*(earL-this.airL[i]);this.airR[i]+=pole*(earR-this.airR[i]);
        this.shadowL[i]+=this.headPole*(this.airL[i]-this.shadowL[i]);
        this.shadowR[i]+=this.headPole*(this.airR[i]-this.shadowR[i]);
        const sceneL=paths[k+4]*((1-paths[k+7])*this.airL[i]+paths[k+7]*this.shadowL[i]);
        const sceneR=paths[k+5]*((1-paths[k+8])*this.airR[i]+paths[k+8]*this.shadowR[i]);
        const spread=this.kindIndices[i]===0?-.045:this.kindIndices[i]===1?.045:0;
        const l=(1-blend)*value*(1+spread)+blend*sceneL;
        const r=(1-blend)*value*(1-spread)+blend*sceneR;
        this.contributionsL[i]=l;this.contributionsR[i]=r;left+=l;right+=r;
      }
      this.outputL=left;this.outputR=right;
      if(++this.head===this.length)this.head=0;
    }
    describe() {
      return {model:'generic-two-ear',settings:{...this.settings},soundSpeed:this.soundSpeed,
        listenerPosition:(this.settings.scene?.position||this.listenerPosition).slice(),headRadius:.0875,referenceDistance:2,
        emitterCount:this.settings.scene?.emitters.length||0,propagationPaths:this.settings.scene?this.vehiclePaths.length:0,
        sources:this.names.map((name,i)=>({name,position:Array.from(this.positions.slice(i*3,i*3+3)),
          leftDelaySeconds:this.targets[i*10]/this.sr,rightDelaySeconds:this.targets[i*10+1]/this.sr,
          leftGain:this.targets[i*10+4],rightGain:this.targets[i*10+5]})),
        calibratedHRTF:false,linear:true};
    }
  }

  // Pressure/volume-velocity and heat impulses remain the leading sources.
  // Noise supplies a small flow/contact texture. The only periodic aerodynamic
  // carrier follows the supplied physical compressor phase, never an audio RPM
  // oscillator. No audio decision changes a physical event or physical clock.
  class MotorAcoustics {
    static defaultAudio() {
      const names=['exhaust','intake','combustion','valve','bearing','boost','manifold','mechanical','gearbox','chain'];
      const amounts=[.55,.15,.20,.08,0,.08,.45,.18,.10,.12],layers={};
      for(let i=0;i<names.length;i++)layers[names[i]]={enabled:true,solo:false,preGain:1,distortion:amounts[i]};
      return {master:.6,exhaust:.64,intake:.38,combustion:.42,valve:.28,bearing:.12,boost:.65,
        manifold:.32,mechanical:.28,gearbox:.24,chain:.18,bite:.6,muted:false,layers,
        listener:{mode:'outside',distance:1.5,azimuth:90,reflections:.12}};
    }
    static mergeAudio(previous,patch={}) {
      const defaults=MotorAcoustics.defaultAudio(),copy=JSON.parse(JSON.stringify(previous||{})),out={...defaults,...copy};
      out.layers={};for(const key of Object.keys(defaults.layers))out.layers[key]={...defaults.layers[key],...(copy.layers?.[key]||{})};
      out.listener={...defaults.listener,...(copy.listener||{})};
      for(const key of ['master','exhaust','intake','combustion','valve','bearing','boost','manifold','mechanical','gearbox','chain','bite'])
        if(Number.isFinite(patch[key]))out[key]=Math.max(0,Math.min(1,patch[key]));
      if(typeof patch.muted==='boolean')out.muted=patch.muted;
      if(patch.layers&&typeof patch.layers==='object')for(const key of Object.keys(out.layers)){
        const layer=patch.layers[key];if(!layer||typeof layer!=='object')continue;
        for(const field of ['enabled','solo'])if(typeof layer[field]==='boolean')out.layers[key][field]=layer[field];
        if(Number.isFinite(layer.preGain))out.layers[key].preGain=Math.max(0,Math.min(4,layer.preGain));
        if(Number.isFinite(layer.distortion))out.layers[key].distortion=Math.max(0,Math.min(1,layer.distortion));
      }
      if(patch.listener&&typeof patch.listener==='object'){
        const l=patch.listener;
        if(['direct','outside','engine','cabin'].includes(l.mode))out.listener.mode=l.mode;
        for(const [key,lo,hi] of [['distance',.5,20],['azimuth',-180,180],['reflections',0,1]])
          if(Number.isFinite(l[key]))out.listener[key]=Math.max(lo,Math.min(hi,l[key]));
        if(Object.prototype.hasOwnProperty.call(l,'scene'))out.listener.scene=AcousticListener.validateScene(l.scene);
      }
      return out;
    }
    constructor(sr, config) {
      this.sr = sr;
      this.config = config;
      this.sourceNames = ['exhaust', 'intake', 'combustion', 'valve', 'bearing', 'boost', 'manifold', 'mechanical', 'gearbox', 'chain'];
      this.targets = MotorAcoustics.defaultAudio();
      this.gains = MotorAcoustics.defaultAudio(); this.gains.master=0;
      this.layerSettings=this.gains.layers; this.layerActive=new Float64Array(10);this.layerActive.fill(1);
      this.anySolo=false; this.layers=[]; this.bankLayers=[];
      this.muteRise = 1 / (sr * 0.020);
      this.muteFall = 1 / (sr * 0.015);
      this.dcPole = Math.exp(-2 * Math.PI * 12 / sr);
      this.pressurePole = 1 - Math.exp(-2 * Math.PI * 22 / sr);
      // A bounded differentiating radiation response removes the former
      // quasi-static flow rumble. These are declared acoustic approximations,
      // not extra combustion events or a change to physical gas pressure.
      this.exRadiationPole = 1 - Math.exp(-2 * Math.PI * 195 / sr);
      this.inRadiationPole = 1 - Math.exp(-2 * Math.PI * 150 / sr);
      this.torquePole = 1 - Math.exp(-2 * Math.PI * 190 / sr);
      this.heatDecay = Math.exp(-1 / (sr * 0.00018));
      this.valveDecay = Math.exp(-1 / (sr * 0.00012));
      this.colorSmooth = 1 - Math.exp(-128 / (sr * 0.040));
      this.delaySmooth = 1 - Math.exp(-1 / (sr * 0.025));
      // Equal white-noise spectral density, before the fixed-Hz filters, at
      // different device sample rates. This does not rescale physical forces.
      this.noiseScale = Math.sqrt(sr / 48000);
      this.delay = new Float64Array(Math.ceil(sr * 0.15) + 8);
      this.filters = [];
      for (let i = 0; i < 54; i++) this.filters.push({ b0: 0, b1: 0, b2: 0, a1: 0, a2: 0, z1: 0, z2: 0 });
      this.previous = new Float64Array(69);
      this.current = new Float64Array(69);
      this.interpolated = new Float64Array(69);
      // The physical solver runs at 24 kHz. Preserve its pressure/flow fronts
      // with a causal fractional-delay reconstruction rather than repeating
      // a linear interpolation loss at every stage of the acoustic network.
      // Scalar controls and the analytic supplied turbo phase stay separate.
      this.pulseChannels = new Int32Array([0, 1, 6, 7, 8, 24, 25, 26, 27, 34, 35, 36]);
      this.pulseTaps = 16;
      this.pulsePhases = 128;
      this.pulseHistory = new Float64Array(this.pulseChannels.length * this.pulseTaps);
      this.pulseKernel = new Float64Array((this.pulsePhases + 1) * this.pulseTaps);
      this.pulseWeights = new Float64Array(this.pulseTaps);
      this.pulseOffsets = new Int32Array(this.pulseTaps);
      this.preparePulseKernel();
      this.seeds = new Int32Array(19);
      // Diagnostic planes are preallocated. rawSourceSamples keeps the driven
      // acoustic response before Pre; sourceSamples preserves its old fader
      // observation. layerSamples is the actual processed post-fader signal.
      // mixSourceSamples is its master-scaled diagnostic, before the listener.
      this.rawSourceSamples = new Float64Array(this.sourceNames.length);
      this.mixSourceSamples = new Float64Array(this.sourceNames.length);
      this.sourceSamples = new Float64Array(this.sourceNames.length);
      this.layerSamples = new Float64Array(this.sourceNames.length);
      this.layerSquares = new Float64Array(this.sourceNames.length);
      this.layerPeaks = new Float64Array(this.sourceNames.length);
      this.carrierHistory = new Float64Array(32); this.carrierIndex=0;
      this.listener = new AcousticListener(sr,this.sourceNames,config);
      this.meterSquares = new Float64Array(this.sourceNames.length + 1);
      this.meterPeaks = new Float64Array(this.sourceNames.length + 1);
      // Every source owns a permanent peak allowance. A louder gearbox cannot
      // change the exhaust waveform or consume its allowance. This is not a
      // voice limit, auto-leveler, side chain or load-dependent normalizer.
      this.sourceBudgets = new Float64Array([.3025, .065, .205, .042, .018, .15, .055, .042, .041, .020]);
      // The boost source reserves .051 for the clean aerodynamic carrier and
      // .099 for gas/relief. Two physical shafts each own half of both amounts;
      // neither shaft nor gas/carrier component borrows the other's headroom.
      this.boostCarrierShare = .34;
      this.prepareOutputKernel();
      // The existing exhaust keeps its entire .230 allowance. The additive
      // force-presence voice owns .0725, never borrowed from another source.
      // A fixed .94 final calibration with new observers reserves both paths:
      // .94 * (.881275 + 1.045 * .0725) = .89961525 < .9.
      this.exhaustBaseBudget = .230; this.exhaustPresenceBudget = .0725;
      this.legacyGuaranteedPeak = this.sourceBudgets.reduce((a,b)=>a+b,0)-this.exhaustPresenceBudget+
        .045*(this.exhaustBaseBudget+this.sourceBudgets[1]);
      this.guaranteedPeak = this.legacyGuaranteedPeak; this.mixReserveGain = 1;
      // The shared 2 ms look-ahead remains a last-resort fault guard. The
      // independent source bounds below keep it at unity for valid signals.
      this.lookAhead = Math.max(1, Math.ceil(sr * 0.002));
      this.limitL = new Float64Array(this.lookAhead + 1);
      this.limitR = new Float64Array(this.lookAhead + 1);
      this.peakValues = new Float64Array(this.lookAhead + 2);
      this.peakTimes = new Float64Array(this.lookAhead + 2);
      this.limiterRelease = 1 - Math.exp(-1 / (0.090 * sr));
      this.setPlaybackRate(1);
      this.clear();
    }
    configure(config) { this.config = config; this.clear(); }
    clear() {
      this.delay.fill(0); this.delayIndex = 0;
      for (let i = 0; i < this.filters.length; i++) { this.filters[i].z1 = 0; this.filters[i].z2 = 0; }
      this.previous.fill(0); this.current.fill(0);
      this.pulseHistory.fill(0); this.pulseIndex = 0;
      this.previous[2] = this.current[2] = this.config.ambientP;
      this.previous[3] = this.current[3] = this.config.ambientP;
      this.previous[4] = this.current[4] = this.config.ambientT;
      this.previous[5] = this.current[5] = this.config.ambientT;
      this.seeds.set([0x71e4a539, 0x19c760e3, 0x42fb091d, 0x6ae529b7, 0x3501d48f, 0x57b36825, 0x27c95e13, 0x6f38a2c1]);
      this.seeds.set([0x163adc75, 0x5e179b43, 0x37b4a951, 0x49c651af, 0x723bd985, 0x24e713c9], 8);
      this.seeds[14] = 0x13574b9d; this.seeds.set([0x234ab67,0x147ac89,0x378ad23,0x598ad61],15);
      this.rawSourceSamples.fill(0); this.mixSourceSamples.fill(0); this.sourceSamples.fill(0); this.meterSquares.fill(0); this.meterPeaks.fill(0); this.meterFrames = 0;
      for(const layer of this.layers)layer.clear(); for(const layer of this.bankLayers)layer.clear();
      for(const pre of this.pres||[])pre.clear();for(const pre of this.bankPres||[])pre.clear();this.extraBoostPre?.clear();
      this.extraBoostLayer?.clear(); this.layerSamples.fill(0);this.layerSquares.fill(0);this.layerPeaks.fill(0);
      this.carrierHistory.fill(0);this.carrierIndex=0;this.listener.clear();
      this.outputHistoryL.fill(0); this.outputHistoryR.fill(0); this.outputIndex = 0;
      this.limitL.fill(0); this.limitR.fill(0); this.peakValues.fill(0); this.peakTimes.fill(0);
      this.limitIndex = this.peakHead = this.peakTail = this.audioFrame = 0;
      this.sourceExSlow = this.sourceInSlow = this.torqueSlow = this.heatSlow = 0;
      this.sourceExEdge = this.sourceInEdge = 0;
      this.manifoldSlow = this.mechanicalSlow = 0;
      this.boostFlowSlow = this.boostPressureSlow = this.surgeEnvelope = 0;
      this.turboUnits = []; this.twinBlade = 0;
      this.hasBranches = this.hasRotorPhase = false;
      this.hasExhaustMomentum = this.hasExhaustMomentumBranches = this.exhaustPresenceBranched = false;
      this.exhaustPresenceEnabledEver = false;
      this.exhaustBaseSample = this.exhaustPresenceSample = this.exhaustPresenceRawSample = 0;
      this.mixReserveGain = 1; this.guaranteedPeak = this.legacyGuaranteedPeak;
      this.heatEnvelope = this.valveEnvelope = 0;
      this.outputL = this.outputR = this.muteGain = 0;
      this.filterCounter = 0; this.limiterGain = 1;
      this.colorExT = this.colorInT = this.config.ambientT;
      this.colorExSpeed = this.colorInSpeed = 0;
      this.colorBoostSpeed = this.colorReliefSpeed = 0;
      this.delaySamples = this.delayTarget = 2;
      this.gains.master = 0;
      // Public reset also owns the branch, bank and Twin histories. Rebuild
      // their configuration-dependent state once, outside the sample loop.
      this.setup();
    }
    setAudio(values) {
      this.targets=MotorAcoustics.mergeAudio(this.targets,values);
      this.anySolo=this.sourceNames.some(key=>this.targets.layers[key].solo);
      if(values.listener)this.listener.setSettings(this.targets.listener);
    }
    setPlaybackRate(rate) {
      // Gain changes follow the user's real-time gesture even when acoustic
      // physics is playing slowly. All pipe/filter/noise dynamics remain on
      // simulated time and are resampled only at the final output boundary.
      const r = [1, .25, .1, .02].includes(rate) ? rate : 1;
      this.playbackRate = r;
      this.controlSmooth = 1 - Math.exp(-1 / (this.sr * .018 * r));
      this.controlMuteRise = this.muteRise / r;
      this.controlMuteFall = this.muteFall / r;
    }
    capture(signal) {
      this.observeExhaustMomentum(signal);
      const p = this.previous, c = this.current;
      p.set(c);
      c[0] = signal.exhaustFlow; c[1] = signal.intakeFlow;
      c[2] = signal.exhaustPressure; c[3] = signal.intakePressure;
      c[4] = signal.exhaustTemp; c[5] = signal.intakeTemp;
      c[6] = signal.combustion; c[7] = signal.structure; c[8] = signal.valve;
      c[9] = signal.bearing; c[10] = signal.rpm; c[11] = signal.load;
      c[12] = signal.throttle; c[13] = signal.boostRpm ?? signal.boosterRpm ?? 0;
      c[14] = signal.compressorFlow ?? 0; c[15] = signal.bypassFlow ?? 0;
      c[16] = signal.turbineFlow ?? 0; c[17] = signal.compressorPower ?? 0;
      c[18] = signal.boostAngle ?? 0;
      c[19] = signal.chargePressure ?? this.config.ambientP;
      // Core surge is a reversal impulse density (1/s). Recover its integrated
      // pressure-ratio magnitude before exciting a finite acoustic response.
      c[20] = (signal.surge ?? 0) * (Number.isFinite(signal.dt) && signal.dt > 0 ? signal.dt : 1 / 24000);
      c[21] = signal.bypassOpening ?? 0;
      c[22] = signal.compressorPressureRise ?? c[19] - this.config.ambientP;
      c[23] = signal.surgeFlow ?? 0;
      c[32] = signal.wastegateFlow ?? 0;
      c[33] = signal.turbinePower ?? 0;
      // New observers are additive. Legacy game integrations without these
      // fields keep working and do not acquire invented moving parts.
      const dt = Number.isFinite(signal.dt) && signal.dt > 0 ? signal.dt : 1 / 24000;
      const mechanics = signal.mechanics, drive = signal.drivetrain;
      c[56] = Number.isFinite(signal.manifoldPressure) ? 1 : 0;
      const manifoldDensity = c[56] ? Math.max(.03, signal.manifoldPressure / (287 * Math.max(150, signal.manifoldTemp ?? this.config.ambientT))) : 1;
      c[34] = c[56] ? .55 * (signal.manifoldPressure - this.config.ambientP) / this.config.ambientP +
        .10 * (signal.manifoldFlow ?? 0) / (manifoldDensity * this.exArea * 80) : 0;
      c[35] = mechanics ? (.6 * (mechanics.pistonSideForce ?? 0) + .18 * (mechanics.reciprocatingForce ?? 0)) / 10000 +
        (mechanics.pistonContactImpulse ?? 0) / (dt * 15000) : 0;
      c[36] = drive ? (drive.engageImpulse ?? 0) / (dt * 100) : 0;
      c[37] = drive?.inputAngle ?? 0; c[38] = drive?.inputOmega ?? 0;
      c[39] = drive?.meshLoad ?? 0; c[40] = drive?.gearLossPower ?? 0;
      c[41] = drive?.clutchSlipPower ?? 0; c[42] = drive?.synchPower ?? 0;
      c[43] = drive?.chainAngle ?? 0; c[44] = drive?.chainOmega ?? 0; c[45] = drive?.chainLoad ?? 0;
      c[46] = mechanics?.timingAngle ?? 0; c[47] = mechanics?.timingOmega ?? 0; c[48] = mechanics?.timingLoad ?? 0;
      c[49] = drive?.finalChain === true ? 1 : 0; c[50] = mechanics?.timingChain === true ? 1 : 0;
      c[51] = drive?.meshTeeth ?? 0; c[52] = drive?.chainTeeth ?? 0; c[53] = mechanics?.timingTeeth ?? 0;
      c[54] = drive ? 1 : 0; c[55] = mechanics ? 1 : 0;
      if (!p[54] && c[54]) { p[37] = c[37]; p[43] = c[43]; }
      if (!p[55] && c[55]) p[46] = c[46];
      if (Number.isFinite(signal.boostAngle)) {
        if (!this.hasRotorPhase) p[18] = c[18];
        this.hasRotorPhase = true;
      } else this.hasRotorPhase = false;
      const branches = signal.exhaustFlows;
      this.hasBranches = !!branches && branches.length === this.branchCount;
      this.captureExhaustPresenceMean(signal, dt);
      if (this.hasBranches) this.captureBranches(signal);
      else {for (let i = 24; i < 32; i++) c[i] = 0;for(let i=57;i<65;i++)c[i]=0;}
      for (let i = 0; i < c.length; i++) {
        if (!Number.isFinite(c[i])) throw new Error('Nicht endliches Akustiksignal, Kanal ' + i + '.');
      }
      this.pulseIndex = (this.pulseIndex + 1) % this.pulseTaps;
      for (let i = 0; i < this.pulseChannels.length; i++) this.pulseHistory[i * this.pulseTaps + this.pulseIndex] = c[this.pulseChannels[i]];
      if (this.hasTwinTurbo) this.captureTurboUnits(signal);
    }
    observeExhaustMomentum(signal) {
      const ports=signal.exhaustMomentumFluxes,total=signal.exhaustMomentumFlux;
      const hasPorts=ports!=null,hasTotal=total!=null;
      let sum=0;
      if(hasPorts){
        if(!(Array.isArray(ports)||ArrayBuffer.isView(ports))||ports.length!==this.branchCount)
          throw new Error('Auslass-Impulsströme passen nicht zur Kammerzahl.');
        for(let i=0;i<ports.length;i++){
          if(!Number.isFinite(ports[i])||Math.abs(ports[i])>1e100)
            throw new Error('Nicht endlicher oder zu großer Auslass-Impulsstrom.');
          sum+=ports[i];
        }
        if(!Number.isFinite(sum)||Math.abs(sum)>1e100)throw new Error('Ungültige Auslass-Impulsstromsumme.');
      }
      if(hasTotal&&(!Number.isFinite(total)||Math.abs(total)>1e100))throw new Error('Ungültiger Auslass-Impulsstrom.');
      if(hasPorts&&hasTotal&&Math.abs(sum-total)>1e-9*Math.max(1,Math.abs(sum),Math.abs(total)))
        throw new Error('Auslass-Impulsstromsumme stimmt nicht mit den Kammern überein.');
      const present=hasPorts||hasTotal;
      const branched=hasPorts&&!!signal.exhaustFlows&&signal.exhaustFlows.length===this.branchCount;
      const changed=present!==this.hasExhaustMomentum||branched!==this.exhaustPresenceBranched;
      if(changed)this.clearExhaustPresence();
      this.hasExhaustMomentum=present;this.hasExhaustMomentumBranches=hasPorts;
      this.exhaustPresenceBranched=branched;
      this.exhaustMomentumTotal=hasPorts?sum:hasTotal?total:0;
      // This coefficient depends only on which signal contract is supplied.
      // It never follows level, throttle, RPM, load or another source.
      // Keep the reservation until reset if a producer subsequently omits its
      // optional observer: the listener/FIR may still contain an earlier tail.
      if(present)this.exhaustPresenceEnabledEver=true;
      this.mixReserveGain=this.exhaustPresenceEnabledEver?.94:1;
      this.guaranteedPeak=this.exhaustPresenceEnabledEver?.94*(this.legacyGuaranteedPeak+1.045*this.exhaustPresenceBudget):this.legacyGuaranteedPeak;
      if(changed)this.tuneExhaustPresence();
    }
    clearExhaustPresence() {
      for(const key of ['exhaustPresenceBranch','exhaustPresenceBranchSlow','exhaustPresenceRawSamples','exhaustPresenceSamples',
        'exhaustPresenceFlowSums','exhaustPresenceMean1','exhaustPresenceMean2','exhaustPresenceMach','exhaustPresenceSlow',
        'exhaustPresenceEdge','exhaustPresenceHistory'])this[key]?.fill(0);
      for(const pre of this.exhaustPresencePres||[])pre.clear();
      for(const layer of this.exhaustPresenceLayers||[])layer.clear();
      for(let i=46;i<this.filters.length;i++){this.filters[i].z1=0;this.filters[i].z2=0;}
      for(let i=0;i<this.pulseChannels.length;i++)if(this.pulseChannels[i]>=65)
        this.pulseHistory.fill(0,i*this.pulseTaps,(i+1)*this.pulseTaps);
      for(let i=65;i<this.current.length;i++)this.previous[i]=this.current[i]=this.interpolated[i]=0;
      this.exhaustPresenceHistoryIndex=0;this.exhaustPresenceDt=0;
      this.exhaustPresenceRawSample=this.exhaustPresenceSample=0;
    }
    captureExhaustPresenceMean(signal,dt) {
      for(let i=65;i<this.current.length;i++)this.current[i]=0;
      if(!this.hasExhaustMomentum)return;
      // Diagnostic candidate: transmit only the added port-force component
      // through the actual turbine/wastegate route. This bounded pressure
      // transfer is an engineering approximation, not a measured turbine map.
      let transmission=1;
      if(this.config.boost==='turbo'&&Number.isFinite(signal.manifoldPressure)&&signal.manifoldPressure>0){
        const turbine=Math.max(0,signal.turbineFlow??0),wastegate=Math.max(0,signal.wastegateFlow??0);
        if(turbine>0){
          const pressureRatio=Math.max(0,Math.min(1,signal.exhaustPressure/signal.manifoldPressure));
          transmission=1-(1-Math.sqrt(pressureRatio))/(1+wastegate/turbine);
        }
      }
      this.exhaustPresenceTransmission=transmission;
      const sums=this.exhaustPresenceFlowSums,means=this.exhaustPresenceMean2;
      const count=this.exhaustPresenceBranched?this.exhaustBankCount:1;
      sums.fill(0);
      if(this.exhaustPresenceBranched){
        for(let i=0;i<this.branchCount;i++){
          const q=signal.exhaustFlows[i];
          if(!Number.isFinite(q)||Math.abs(q)>1e100)throw new Error('Ungültiger Auslass-Massenstrom.');
          sums[this.branchBanks[i]]+=q;
        }
      }else{
        if(!Number.isFinite(signal.exhaustFlow)||Math.abs(signal.exhaustFlow)>1e100)throw new Error('Ungültiger Auslass-Massenstrom.');
        sums[0]=signal.exhaustFlow;
      }
      for(let bank=0;bank<count;bank++)if(!Number.isFinite(sums[bank]))throw new Error('Ungültige Auslass-Massenstromsumme.');
      if(dt!==this.exhaustPresenceDt){this.exhaustPresenceDt=dt;this.exhaustPresenceMeanPole=1-Math.exp(-dt/.010);}
      const pole=this.exhaustPresenceMeanPole,c=this.current;
      const density=Math.max(.03,c[2]/(287*Math.max(150,c[4])));
      const area=this.exArea/count;
      for(let bank=0;bank<count;bank++){
        this.exhaustPresenceMean1[bank]+=pole*(sums[bank]-this.exhaustPresenceMean1[bank]);
        means[bank]+=pole*(this.exhaustPresenceMean1[bank]-means[bank]);
        // Average SIGNED transport before taking its outgoing component.
        // Balanced forward/reverse pumping must not become outgoing jet power.
        this.exhaustPresenceMach[bank]=Math.max(0,means[bank])*this.momentumMassScale/(density*area);
      }
      if(!this.exhaustPresenceBranched){
        const mach=this.exhaustPresenceMach[0];
        c[65]=this.bounded(this.exhaustMomentumTotal*this.momentumMassScale/(density*this.exArea*80),5)*mach/(1+mach);
      }
    }
    tuneExhaustPresence() {
      if(!this.exhaustPresencePres)return;
      const split=this.exhaustPresenceBranched&&this.exhaustBankCount>1;
      for(let bank=0;bank<this.exhaustBankCount;bank++){
        const low=this.filters[split?38+bank*2:1],band=this.filters[split?39+bank*2:0];
        const a=this.filters[46+bank*2],b=this.filters[47+bank*2];
        for(const key of ['b0','b1','b2','a1','a2']){a[key]=low[key];b[key]=band[key];}
      }
    }
    exhaustPresenceReflection(bank,delay) {
      const length=this.delay.length,base=bank*length;
      let at=this.exhaustPresenceHistoryIndex-delay;if(at<0)at+=length;
      const i=Math.floor(at),f=at-i;
      return this.exhaustPresenceHistory[base+i]*(1-f)+this.exhaustPresenceHistory[base+(i+1)%length]*f;
    }
    renderExhaustPresence(l,active) {
      if(!this.hasExhaustMomentum){
        this.exhaustPresenceRawSamples.fill(0);this.exhaustPresenceSamples.fill(0);this.exhaustPresenceRawSample=0;
        return 0;
      }
      const split=this.exhaustPresenceBranched&&this.exhaustBankCount>1;
      const count=this.exhaustPresenceBranched?this.exhaustBankCount:1;
      const setting=this.layerSettings.exhaust;let sum=0,rawSum=0;
      for(let bank=0;bank<count;bank++){
        let x=active?.86*l[65+bank]:0;
        this.exhaustPresenceSlow[bank]+=this.exRadiationPole*(x-this.exhaustPresenceSlow[bank]);x-=this.exhaustPresenceSlow[bank];
        this.exhaustPresenceEdge[bank]+=this.exEdgePole*(x-this.exhaustPresenceEdge[bank]);
        x=(split?.40:.48)*x+(split?.96:.82)*(x-this.exhaustPresenceEdge[bank]);
        const pipe=x-this.reflection*this.exhaustPresenceReflection(bank,this.delaySamples)+
          this.reflection2*this.exhaustPresenceReflection(bank,this.delaySamples*2.13);
        this.exhaustPresenceHistory[bank*this.delay.length+this.exhaustPresenceHistoryIndex]=x;
        const raw=this.filter(46+bank*2,pipe+.12*this.filter(47+bank*2,pipe));
        this.exhaustPresenceRawSamples[bank]=raw;rawSum+=raw;
        const conditioned=this.exhaustPresencePres[bank].process(raw);
        const contained=this.exhaustPresenceLayers[bank].process(conditioned,setting.preGain,setting.distortion,this.gains.bite);
        // A fixed radiation orientation belongs to this authored transfer.
        // It is not a unique force-to-microphone law. Post-bound Mach coupling
        // retains physical throughflow strength even during intentional local
        // saturation; it never modulates the original exhaust or another voice.
        const presence=-Math.min(1,this.exhaustPresenceMach[bank]/.3)*contained*this.exhaustPresenceTransmission;
        this.exhaustPresenceSamples[bank]=presence;sum+=presence;
      }
      if(++this.exhaustPresenceHistoryIndex===this.delay.length)this.exhaustPresenceHistoryIndex=0;
      this.exhaustPresenceRawSample=rawSum;
      return sum;
    }
    preparePulseKernel() {
      const taps = this.pulseTaps, phases = this.pulsePhases;
      // A windowed sinc reconstruction with eight physical samples of causal
      // latency. 0.42 cycles/input-sample leaves a transition before the
      // physical Nyquist limit. All coefficients are configuration-time data.
      for (let phase = 0; phase <= phases; phase++) {
        const delay = taps / 2 - phase / phases, base = phase * taps;
        let sum = 0;
        for (let k = 0; k < taps; k++) {
          const offset = k - delay, x = offset / (taps / 2);
          const window = Math.abs(x) < 1 ? .42 + .5 * Math.cos(Math.PI * x) + .08 * Math.cos(2 * Math.PI * x) : 0;
          const sinc = Math.abs(offset) < 1e-12 ? .84 : Math.sin(.84 * Math.PI * offset) / (Math.PI * offset);
          const value = sinc * window;
          this.pulseKernel[base + k] = value; sum += value;
        }
        for (let k = 0; k < taps; k++) this.pulseKernel[base + k] /= sum;
      }
    }
    initializeLayers() {
      this.pres=this.sourceNames.map((name,index)=>new AcousticPre(this.sr,{name,index,config:this.config}));
      this.extraBoostPre=new AcousticPre(this.sr,{name:'boost',index:5,config:this.config});
      this.bankPres=Array.from({length:this.exhaustBankCount},()=>new AcousticPre(this.sr,{name:'exhaust',index:0,config:this.config}));
      this.layers=this.sourceNames.map((name,index)=>new AcousticLayer(this.sr,{name,index,
        budget:(index===0?this.exhaustBaseBudget:this.sourceBudgets[index])*(index===5?(1-this.boostCarrierShare)*(this.hasTwinTurbo?.5:1):1),outputKernelNorm:this.outputKernelNorm}));
      this.extraBoostLayer=new AcousticLayer(this.sr,{name:'boost',index:5,budget:this.sourceBudgets[5]*(1-this.boostCarrierShare)*.5,outputKernelNorm:this.outputKernelNorm});
      this.bankLayers=Array.from({length:this.exhaustBankCount},()=>new AcousticLayer(this.sr,{name:'exhaust',index:0,
        budget:this.exhaustBaseBudget/this.exhaustBankCount,outputKernelNorm:this.outputKernelNorm}));
      this.exhaustPresencePres=Array.from({length:this.exhaustBankCount},()=>new AcousticPre(this.sr,
        {name:'exhaust',index:0,config:this.config,profile:'exhaust-presence'}));
      this.exhaustPresenceLayers=Array.from({length:this.exhaustBankCount},()=>new AcousticLayer(this.sr,
        {name:'exhaust-presence',index:0,budget:this.exhaustPresenceBudget/this.exhaustBankCount,outputKernelNorm:this.outputKernelNorm}));
      this.listener.configure(this.config);this.listener.setSettings(this.targets.listener,true);
    }
    containSource(index,input) {
      const i=index===10?5:index,settings=this.layerSettings[this.sourceNames[i]];
      const conditioned=(index===10?this.extraBoostPre:this.pres[i]).process(input);
      return (index===10?this.extraBoostLayer:this.layers[i]).process(conditioned,settings.preGain,settings.distortion,this.gains.bite);
    }
    alignCarrier(index,value) {
      const base=index*16,delay=this.layers[5].latencySamples||0;
      this.carrierHistory[base+this.carrierIndex]=value;
      const n=Math.floor(delay),f=delay-n,a=(this.carrierIndex-n+16)%16,b=(a+15)%16;
      return this.carrierHistory[base+a]*(1-f)+this.carrierHistory[base+b]*f;
    }
    containCarrier(amplitude, wave, inputGain, share = 1) {
      // Only the physical load-derived amplitude has a smooth finite ceiling.
      // The supplied blade phase remains linear: saturating its waveform would
      // create high harmonics that fold into another shaft's audible orders.
      // A fourth-root knee preserves small-signal level while approaching cap.
      const cap = this.sourceBudgets[5] * this.boostCarrierShare * share / this.outputKernelNorm;
      const a = Math.max(0, amplitude * inputGain), ratio = a / cap, square = ratio * ratio;
      return a / Math.sqrt(Math.sqrt(1 + square * square)) * wave;
    }
    prepareOutputKernel() {
      // A fixed 11 kHz reconstruction guard keeps pressure-front images and
      // newly generated high orders out of the hiss band. It is not a shared
      // dynamics processor. The finite kernel's exact absolute coefficient
      // sum bounds its worst-case overshoot and is reserved by every source.
      this.outputTaps = Math.max(33, Math.round(this.sr / 1000) | 1);
      this.outputKernel = new Float64Array(this.outputTaps);
      this.outputHistoryL = new Float64Array(this.outputTaps);
      this.outputHistoryR = new Float64Array(this.outputTaps);
      const middle = (this.outputTaps - 1) / 2, cutoff = Math.min(11000, .43 * this.sr) / this.sr;
      let sum = 0;
      for (let i = 0; i < this.outputTaps; i++) {
        const x = i - middle;
        const window = .42 - .5 * Math.cos(2 * Math.PI * i / (this.outputTaps - 1)) + .08 * Math.cos(4 * Math.PI * i / (this.outputTaps - 1));
        const value = (x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x)) * window;
        this.outputKernel[i] = value; sum += value;
      }
      this.outputKernelNorm = 0;
      for (let i = 0; i < this.outputTaps; i++) { this.outputKernel[i] /= sum; this.outputKernelNorm += Math.abs(this.outputKernel[i]); }
    }
    renderOutput(left, right) {
      const historyL = this.outputHistoryL, historyR = this.outputHistoryR, kernel = this.outputKernel, count = this.outputTaps;
      historyL[this.outputIndex] = left; historyR[this.outputIndex] = right;
      let head = this.outputIndex, tail = this.outputIndex + 1, l = 0, r = 0;
      if (tail === count) tail = 0;
      for (let i = 0; i < (count - 1) / 2; i++) {
        l += kernel[i] * (historyL[head] + historyL[tail]);
        r += kernel[i] * (historyR[head] + historyR[tail]);
        if (--head < 0) head = count - 1; if (++tail === count) tail = 0;
      }
      l += kernel[(count - 1) / 2] * historyL[head]; r += kernel[(count - 1) / 2] * historyR[head];
      this.filteredL = l; this.filteredR = r;
      if (++this.outputIndex === count) this.outputIndex = 0;
    }
    contactResponse(angle, omega, teeth, harmonics) {
      // Contact order is evaluated at the supplied physical shaft position.
      // The effective tooth count is an explicit acoustic geometry setting,
      // not an asserted OEM measurement or an RPM-only sound oscillator.
      if (!(teeth >= 1) || Math.abs(omega) < 1e-8) return 0;
      const frequency = Math.abs(teeth * omega / (2 * Math.PI));
      const end = Math.min(11000, .43 * this.sr), start = .82 * end;
      let response = 0;
      for (let order = 1; order <= harmonics; order++) {
        const hz = frequency * order;
        if (hz >= end) break;
        const t = Math.max(0, (hz - start) / (end - start));
        const guard = 1 - t * t * (3 - 2 * t);
        response += guard * Math.cos(teeth * angle * order) / (order * order);
      }
      return response;
    }
    reconstructPulses(fraction) {
      const phase = Math.max(0, Math.min(this.pulsePhases - 1, Math.floor(fraction * this.pulsePhases)));
      const blend = Math.max(0, Math.min(1, fraction * this.pulsePhases - phase));
      const taps = this.pulseTaps, base = phase * taps, next = base + taps;
      const weights = this.pulseWeights, offsets = this.pulseOffsets, kernel = this.pulseKernel, history = this.pulseHistory;
      let index = this.pulseIndex;
      for (let k = 0; k < taps; k++) {
        weights[k] = kernel[base + k] + blend * (kernel[next + k] - kernel[base + k]);
        offsets[k] = index;
        if (--index < 0) index = taps - 1;
      }
      // Actual engines use the four branch channels and shaft excitation.
      // The aggregate compatibility channels are reconstructed only for older
      // callers that supply no per-chamber signals. No unused FIR is evaluated.
      for (let i = 0; i < 5; i++) {
        const channel = this.hasBranches ? (i === 4 ? 3 : i + 5) : i;
        const offset = channel * taps; let value = 0;
        for (let k = 0; k < taps; k++) value += history[offset + offsets[k]] * weights[k];
        this.interpolated[this.pulseChannels[channel]] = value;
      }
      for (let channel = 9; channel < this.pulseChannels.length; channel++) {
        const offset = channel * taps; let value = 0;
        for (let k = 0; k < taps; k++) value += history[offset + offsets[k]] * weights[k];
        this.interpolated[this.pulseChannels[channel]] = value;
      }
    }
    captureTurboUnits(signal) {
      const supplied = signal.turboUnits;
      if (!supplied || supplied.length !== 2) throw new Error('Twin-Turbo-Akustik benötigt zwei physische Ladersignale.');
      const dt = Number.isFinite(signal.dt) && signal.dt > 0 ? signal.dt : 1 / 24000;
      for (let i = 0; i < 2; i++) {
        const input = supplied[i], unit = this.turboUnits[i], p = unit.previous, c = unit.current;
        if (!input || !Number.isFinite(input.rpm) || !Number.isFinite(input.angle)) throw new Error('Twin-Turbo-Welle ' + (i + 1) + ' ohne gültige Drehzahl oder Phase.');
        p.set(c);
        // A private copy is essential: the physical solver mutates its signal
        // objects in place. Neither unit may interpolate the other's shaft.
        c[0] = input.rpm; c[1] = input.angle;
        c[2] = input.compressorFlow ?? 0; c[3] = input.bypassFlow ?? 0;
        c[4] = input.turbineFlow ?? 0; c[5] = input.compressorPower ?? 0;
        c[6] = signal.chargePressure ?? this.config.ambientP;
        c[7] = (input.surge ?? 0) * dt; c[8] = input.bypassOpening ?? 0;
        c[9] = input.compressorPressureRise ?? c[6] - this.config.ambientP;
        c[10] = input.wastegateFlow ?? 0; c[11] = input.turbinePower ?? 0;
        if (!unit.hasPhase) { p[1] = c[1]; unit.hasPhase = true; }
        for (let k = 0; k < c.length; k++) {
          if (!Number.isFinite(c[k])) throw new Error('Nicht endliches Ladersignal, Welle ' + (i + 1) + ', Kanal ' + k + '.');
        }
      }
    }
    prepareBranches() {
      const c = this.config;
      this.branchCount = c.kind === 'rotary' ? 3 * c.rotorCount : Math.max(1, c.cylinderCount || 1);
      const n = this.branchCount;
      this.exhaustBankCount=c.kind!=='rotary'&&['v','boxer','w'].includes(c.layout)?(c.layout==='w'?4:2):1;
      this.branchBanks=new Int32Array(n);this.bankTotals=new Float64Array(4);this.bankPowers=new Float64Array(4);
      this.bankRawSamples=new Float64Array(4);this.bankSlow=new Float64Array(4);this.bankEdge=new Float64Array(4);
      this.bankHistory=new Float64Array(4*this.delay.length);this.bankDelayIndex=0;
      this.pulseChannels=new Int32Array([0,1,6,7,8,24,25,26,27,34,35,36,
        ...Array.from({length:this.exhaustBankCount},(_,i)=>57+i),
        ...Array.from({length:this.exhaustBankCount},(_,i)=>65+i)]);
      this.pulseHistory=new Float64Array(this.pulseChannels.length*this.pulseTaps);this.pulseIndex=0;
      this.branchLength = Math.ceil(24000 * .075) + 8;
      this.branchIndex = 0;
      this.branchEx = new Float64Array(n * this.branchLength);
      this.branchIn = new Float64Array(n * this.branchLength);
      this.branchState = new Float64Array(n * 7);
      this.exhaustPresenceBranch = new Float64Array(n * this.branchLength);
      this.exhaustPresenceBranchSlow = new Float64Array(n);
      this.exhaustPresenceRawSamples = new Float64Array(this.exhaustBankCount);
      this.exhaustPresenceSamples = new Float64Array(this.exhaustBankCount);
      this.exhaustPresenceFlowSums = new Float64Array(this.exhaustBankCount);
      this.exhaustPresenceMean1 = new Float64Array(this.exhaustBankCount);
      this.exhaustPresenceMean2 = new Float64Array(this.exhaustBankCount);
      this.exhaustPresenceMach = new Float64Array(this.exhaustBankCount);
      this.exhaustPresenceSlow = new Float64Array(this.exhaustBankCount);
      this.exhaustPresenceEdge = new Float64Array(this.exhaustBankCount);
      this.exhaustPresenceHistory = new Float64Array(this.exhaustBankCount * this.delay.length);
      this.exhaustPresenceHistoryIndex = 0; this.exhaustPresenceDt = 0; this.exhaustPresenceTransmission = 1;
      this.exhaustPresenceTransported = 0;
      this.branchExPath = new Float64Array(n);
      this.branchInPath = new Float64Array(n);
      this.branchExDelay = new Float64Array(n);
      this.branchInDelay = new Float64Array(n);
      this.branchExDelayTarget = new Float64Array(n);
      this.branchInDelayTarget = new Float64Array(n);
      this.branchDt = 0;
      this.branchHeatScale = 1 / Math.sqrt(n);
      const piston = c.kind !== 'rotary', spacing = piston ? c.cylinderSpacing : c.rotorSpacing;
      const radial=piston&&c.layout==='radial';
      const units = piston ? (radial?1:Math.ceil(n/this.exhaustBankCount)) : c.rotorCount;
      // Only fixed head positions are required, never a second crank solver.
      // Derive the same flat-equivalent dimensions as the core so this module
      // also works alone, without an outer EngineCore binding.
      const area=piston?Math.PI*c.bore*c.bore/4:0;
      const headHeight=piston?c.stroke/2+c.rod+c.pistonPinOffset+(area*c.stroke/(c.compression-1))/area:0;
      const heads=piston?Array.from({length:n},(_,i)=>{
        const bank=i%this.exhaustBankCount;
        const angle=radial?i*2*Math.PI/n:c.layout==='boxer'?(bank?Math.PI/2:-Math.PI/2):
          this.exhaustBankCount>1?(-c.bankAngle/2+bank*c.bankAngle/(this.exhaustBankCount-1))*Math.PI/180:0;
        return {x:Math.sin(angle)*headHeight,y:-Math.cos(angle)*headHeight};
      }):null;
      let headRadius = 0;
      if (heads) for (const head of heads) headRadius = Math.max(headRadius, Math.hypot(head.x, head.y));
      this.meanRunnerEx = this.meanRunnerIn = 0;
      // Collector path is an explicitly approximate acoustic network: supplied
      // pipe length plus actual axial distance to a central collector. It is not
      // a claim that the lumped gas solver contains travelling acoustic waves.
      for (let i = 0; i < n; i++) {
        this.branchBanks[i]=i%this.exhaustBankCount;
        const station = piston ? (radial?0:Math.floor(i/this.exhaustBankCount)) : Math.floor(i / 3);
        const distance = Math.abs(station - (units - 1) / 2) * (spacing || .09);
        const head = heads?.[i];
        const bankDistance = head ? Math.hypot(head.x, head.y + headRadius + c.exhaustDiameter) - c.exhaustDiameter : 0;
        this.branchExPath[i] = .28 * c.exhaustLength + .55 * distance + .30 * bankDistance;
        this.branchInPath[i] = .35 * c.intakeLength + .45 * distance + .24 * bankDistance;
        this.meanRunnerEx += this.branchExPath[i] / n;
        this.meanRunnerIn += this.branchInPath[i] / n;
        this.branchExDelay[i] = Math.min(this.branchLength - 6, 24000 * this.branchExPath[i] / 343);
        this.branchInDelay[i] = Math.min(this.branchLength - 6, 24000 * this.branchInPath[i] / 343);
        this.branchExDelayTarget[i] = this.branchExDelay[i];
        this.branchInDelayTarget[i] = this.branchInDelay[i];
      }
    }
    branchRead(buffer, branch, delay) {
      // Third-order Lagrange interpolation preserves upper firing orders
      // better than a linear read. Two fixed input samples keep all four taps
      // causal, including very short hot runners. This latency is acoustic.
      let position = this.branchIndex - delay - 2;
      if (position < 0) position += this.branchLength;
      const a = Math.floor(position), f = position - a, base = branch * this.branchLength, length = this.branchLength;
      const x0 = buffer[base + (a + length - 1) % length], x1 = buffer[base + a];
      const x2 = buffer[base + (a + 1) % length], x3 = buffer[base + (a + 2) % length];
      return x0 * (-f * (f - 1) * (f - 2) / 6) + x1 * ((f + 1) * (f - 1) * (f - 2) / 2) +
        x2 * (-(f + 1) * f * (f - 2) / 2) + x3 * ((f + 1) * f * (f - 1) / 6);
    }
    branchReadExhaustPair(branch, delay) {
      // The established exhaust and additive presence use the same runner
      // delay. Reuse only their addressing and Lagrange coefficients, keeping
      // each buffer's original four products and left-to-right sum unchanged.
      let position = this.branchIndex - delay - 2;
      if (position < 0) position += this.branchLength;
      const a = Math.floor(position), f = position - a, base = branch * this.branchLength, length = this.branchLength;
      const i0 = base + (a + length - 1) % length, i1 = base + a;
      const i2 = base + (a + 1) % length, i3 = base + (a + 2) % length;
      const w0 = -f * (f - 1) * (f - 2) / 6;
      const w1 = (f + 1) * (f - 1) * (f - 2) / 2;
      const w2 = -(f + 1) * f * (f - 2) / 2;
      const w3 = (f + 1) * f * (f - 1) / 6;
      const exhaust = this.branchEx, presence = this.exhaustPresenceBranch;
      const transported = exhaust[i0] * w0 + exhaust[i1] * w1 + exhaust[i2] * w2 + exhaust[i3] * w3;
      this.exhaustPresenceTransported = presence[i0] * w0 + presence[i1] * w1 + presence[i2] * w2 + presence[i3] * w3;
      return transported;
    }
    captureBranches(signal) {
      const c = this.current, n = this.branchCount, states = this.branchState;
      const dt = Number.isFinite(signal.dt) && signal.dt > 0 ? signal.dt : 1 / 24000;
      // dt is normally fixed at 1/24000. Cache its transfer coefficients;
      // user-supplied physical traces with another step still update correctly.
      if (dt !== this.branchDt) {
        this.branchDt = dt;
        this.branchDc = 1 - Math.exp(-2 * Math.PI * 20 * dt);
        this.branchEnvelope = 1 - Math.exp(-dt / .035);
      }
      const dc = this.branchDc, envelope = this.branchEnvelope;
      const densityEx = Math.max(.03, c[2] / (287 * Math.max(150, c[4])));
      const densityIn = Math.max(.03, c[3] / (287 * Math.max(150, c[5])));
      const exVelocityScale = 1 / (densityEx * this.exArea * 80), inVelocityScale = 1 / (densityIn * this.inArea * 65);
      this.bankTotals.fill(0);this.bankPowers.fill(0);
      let ex = 0, ins = 0, heat = 0, valve = 0, exPower = 0, inPower = 0, heatPower = 0, valvePower = 0;
      for (let i = 0; i < n; i++) {
        const k = i * 7;
        const exFlow = signal.exhaustFlows[i], inFlow = signal.intakeFlows?.[i] ?? 0;
        const thermal = (signal.heatPressureRates?.[i] ?? 0) / 1e9;
        const contact = signal.valveImpulses?.[i] ?? 0;
        if (!Number.isFinite(exFlow + inFlow + thermal + contact)) throw new Error('Nicht endlicher Kammer-Akustikkanal.');
        const exJet = exFlow * exVelocityScale, inJet = inFlow * inVelocityScale;
        states[k] += dc * (exJet - states[k]);
        states[k + 1] += dc * (inJet - states[k + 1]);
        states[k + 2] += dc * (thermal - states[k + 2]);
        // Slow level management cannot flatten each high-speed firing pulse as
        // the old instantaneous sum compression did. It is not RMS equalizing.
        states[k + 3] += envelope * (Math.abs(exJet) + Math.abs(inJet) - states[k + 3]);
        states[k + 4] += envelope * (Math.abs(thermal) - states[k + 4]);
        const flowGain = 1 / Math.sqrt(1 + states[k + 3] / 10), heatGain = 1 / Math.sqrt(1 + states[k + 4] / 5);
        // The shared band-limited reconstruction now owns anti-imaging.
        // An extra first-order branch lowpass would erase the same front twice.
        states[k + 5] = (exJet - states[k]) * flowGain;
        states[k + 6] = (inJet - states[k + 1]) * flowGain;
        this.branchEx[i * this.branchLength + this.branchIndex] = states[k + 5];
        if (this.exhaustPresenceBranched) {
          const bank = this.branchBanks[i], mach = this.exhaustPresenceMach[bank];
          const force = signal.exhaustMomentumFluxes[i] * this.momentumMassScale * exVelocityScale * mach / (1 + mach);
          this.exhaustPresenceBranchSlow[i] += dc * (force - this.exhaustPresenceBranchSlow[i]);
          this.exhaustPresenceBranch[i * this.branchLength + this.branchIndex] =
            (force - this.exhaustPresenceBranchSlow[i]) * flowGain;
        }
        this.branchIn[i * this.branchLength + this.branchIndex] = states[k + 6];
        this.branchExDelay[i] += .0017 * (this.branchExDelayTarget[i] - this.branchExDelay[i]);
        this.branchInDelay[i] += .0017 * (this.branchInDelayTarget[i] - this.branchInDelay[i]);
        const transported=this.exhaustPresenceBranched ? this.branchReadExhaustPair(i, this.branchExDelay[i]) :
          this.branchRead(this.branchEx, i, this.branchExDelay[i]);
        ex+=transported;this.bankTotals[this.branchBanks[i]]+=transported;
        if (this.exhaustPresenceBranched) c[65+this.branchBanks[i]] +=
          this.exhaustPresenceTransported;
        this.bankPowers[this.branchBanks[i]]+=exJet*exJet*flowGain*flowGain;
        ins += this.branchRead(this.branchIn, i, this.branchInDelay[i]);
        heat += (thermal - states[k + 2]) * heatGain * this.branchHeatScale;
        valve += contact * this.branchHeatScale;
        // Independent local fluctuations add as velocity/force energy; neither
        // n fully correlated noise copies nor noise from a smoothed total flow.
        exPower += exJet * exJet * flowGain * flowGain;
        inPower += inJet * inJet * flowGain * flowGain;
        heatPower += thermal * thermal * heatGain * heatGain / n;
        valvePower += contact * contact / n;
      }
      for(let bank=0;bank<4;bank++){c[57+bank]=this.bankTotals[bank];c[61+bank]=this.bankPowers[bank];}
      c[24] = ex; c[25] = ins; c[26] = heat; c[27] = valve;
      c[28] = exPower; c[29] = inPower; c[30] = heatPower; c[31] = valvePower;
      this.branchIndex = (this.branchIndex + 1) % this.branchLength;
    }
    band(index, frequency, q) {
      const w = 2 * Math.PI * Math.max(20, Math.min(this.sr * 0.32, frequency)) / this.sr;
      const a = Math.sin(w) / (2 * q), f = this.filters[index], inv = 1 / (1 + a);
      f.b0 = a * inv; f.b1 = 0; f.b2 = -f.b0;
      f.a1 = -2 * Math.cos(w) * inv; f.a2 = (1 - a) * inv;
    }
    low(index, frequency, q) {
      const w = 2 * Math.PI * Math.max(20, Math.min(this.sr * 0.32, frequency)) / this.sr;
      const a = Math.sin(w) / (2 * q), c = Math.cos(w), inv = 1 / (1 + a), f = this.filters[index];
      f.b0 = (1 - c) * 0.5 * inv; f.b1 = (1 - c) * inv; f.b2 = f.b0;
      f.a1 = -2 * c * inv; f.a2 = (1 - a) * inv;
    }
    filter(index, input) {
      const f = this.filters[index];
      const y = f.b0 * input + f.z1;
      f.z1 = f.b1 * input - f.a1 * y + f.z2;
      f.z2 = f.b2 * input - f.a2 * y;
      return y;
    }
    setup() {
      const cfg = this.config, damping = Math.max(0, Math.min(1, cfg.exhaustDamping));
      this.hasBoost = !!cfg.boost && cfg.boost !== 'none';
      this.hasTwinTurbo = cfg.boost === 'turbo' && cfg.turboCount === 2;
      if (this.hasTwinTurbo) for (let i = 0; i < 2; i++) {
        const base = 24 + i * 6;
        const unit = { previous: new Float64Array(12), current: new Float64Array(12), interpolated: new Float64Array(12),
          filterBase: base, noiseBase: 8 + i * 3, hasPhase: false,
          flowSlow: 0, pressureSlow: 0, surgeEnvelope: 0, colorBoostSpeed: 0, colorReliefSpeed: 0, output: 0, blade: 0 };
        unit.previous[6] = unit.current[6] = cfg.ambientP;
        this.turboUnits.push(unit);
        this.band(base, 3500, .55); this.low(base + 1, 6600, .62);
        this.band(base + 2, 280, .75); this.low(base + 3, 2100, .7071);
        this.band(base + 4, 2400, .55); this.low(base + 5, Math.min(11000, this.sr * .38), .7071);
      }
      this.prepareBranches();
      this.exArea = Math.PI * cfg.exhaustDiameter * cfg.exhaustDiameter / 4;
      this.inArea = Math.PI * cfg.intakeDiameter * cfg.intakeDiameter / 4;
      this.momentumMassScale = 1 / Math.sqrt((1005 / 718) * 287 * cfg.ambientT);
      this.reflection = 0.30 * (1 - 0.72 * damping);
      this.reflection2 = 0.095 * (1 - 0.82 * damping);
      // A muffler changes transfer response, not the incoming firing cadence.
      // The former two heavily damped lowpasses erased too many upper orders.
      // One muffler transfer stage retains sharp real pressure fronts. The
      // redundant second lowpass previously softened every engine twice.
      this.low(1, 7900 * (1 - 0.20 * damping), 0.7071);
      this.low(3, 6400, 0.7071);
      // Mechanical response remains a driven, finite-decay response. No clock
      // schedules contacts or heat pulses on behalf of the physical engine.
      const structuralSize = cfg.kind === 'rotary' ? 2 * cfg.rotorRadius : cfg.bore;
      this.band(4, Math.max(650, Math.min(2400, 82 / structuralSize)), 1.05);
      this.low(5, cfg.combustion === 'diesel' ? 7600 : 6800, 0.68);
      this.band(6, Math.max(1800, Math.min(4200, 195 / structuralSize)), 0.90);
      this.low(7, 7800, 0.68);
      this.band(8, 380 + 450 * cfg.bearingWear, 0.55);
      this.low(9, 3200, 0.62);
      this.band(10, cfg.boost === 'turbo' ? 3500 : 1150, 0.55);
      this.low(11, cfg.boost === 'turbo' ? 6600 : 4400, 0.62);
      this.band(18, 280, .75);
      this.low(19, 2100, .7071);
      this.band(20, 900, .65);
      this.band(21, 1300, .65);
      this.band(22, 2400, .55);
      // Preserve the legacy driven carrier response in the raw diagnostic
      // plane. The audible carrier uses the same physical phase with an
      // amplitude-only ceiling, followed by the finite final stereo FIR.
      this.low(23, Math.min(11000, this.sr * .38), .7071);
      this.band(12, Math.max(950, Math.min(3300, 130 / cfg.exhaustDiameter)), .75);
      this.low(13, 8100, .7071);
      this.band(14, Math.max(1100, Math.min(4300, 190 / structuralSize)), .85);
      this.low(15, 8000, .7071);
      this.band(16, Math.max(850, Math.min(2800, 135 / structuralSize)), .75);
      this.low(17, 8500, .7071);
      this.band(36, 3300, .75); this.low(37, 8800, .7071);
      // These local response filters precede source containment. The final
      // fixed linear 11 kHz FIR has an explicit L1 headroom reservation; it
      // replaces the former softer shared 6.5 kHz response.
      for(let bank=0;bank<this.exhaustBankCount;bank++){
        this.low(38+bank*2,9200*(1-.15*damping),.7071);
        this.band(39+bank*2,800,.75);
      }
      this.initializeLayers();
      this.tune(); this.delaySamples = this.delayTarget;
    }
    tune() {
      const cfg = this.config;
      this.colorExT += this.colorSmooth * (Math.max(150, Math.min(2500, this.current[4])) - this.colorExT);
      this.colorInT += this.colorSmooth * (Math.max(150, Math.min(1500, this.current[5])) - this.colorInT);
      const cEx = Math.sqrt(1.4 * 287 * this.colorExT), cIn = Math.sqrt(1.4 * 287 * this.colorInT);
      // Temperatures change on this coefficient clock, not independently in
      // every branch. Cache the same targets for all following physical steps.
      for (let i = 0; i < this.branchCount; i++) {
        this.branchExDelayTarget[i] = Math.min(this.branchLength - 6, 24000 * this.branchExPath[i] / cEx);
        this.branchInDelayTarget[i] = Math.min(this.branchLength - 6, 24000 * this.branchInPath[i] / cIn);
      }
      const exLength = .72 * cfg.exhaustLength + this.meanRunnerEx + .6 * cfg.exhaustDiameter;
      const inLength = .65 * cfg.intakeLength + this.meanRunnerIn + .6 * cfg.intakeDiameter;
      this.delayTarget = Math.max(2, Math.min((this.delay.length - 3) / 2.13, 2 * exLength / cEx * this.sr));
      this.band(0, cEx / (4 * exLength), 0.88);
      for(let bank=0;bank<this.exhaustBankCount;bank++)this.band(39+bank*2,cEx/(4*exLength),.75);
      this.band(2, cIn / (4 * inLength), 0.90);
      const exDensity = Math.max(.03, this.current[2] / (287 * this.colorExT));
      const inDensity = Math.max(.03, this.current[3] / (287 * this.colorInT));
      const exSpeed = Math.abs(this.current[0]) / (exDensity * this.exArea);
      const inSpeed = Math.abs(this.current[1]) / (inDensity * this.inArea);
      this.colorExSpeed += this.colorSmooth * (exSpeed - this.colorExSpeed);
      this.colorInSpeed += this.colorSmooth * (inSpeed - this.colorInSpeed);
      // Broad jet colour uses a nominal Strouhal factor, flow speed and actual
      // pipe diameter. It is a statistical jet model, not a repeating texture.
      this.band(20, Math.max(280, Math.min(4400, .20 * this.colorExSpeed / cfg.exhaustDiameter)), .65);
      this.band(21, Math.max(350, Math.min(4700, .18 * this.colorInSpeed / cfg.intakeDiameter)), .65);
      // A small opening radiates rapid volume-flow changes more strongly than
      // slow throughput. This finite, bounded radiation shelf derives its
      // turnover from sound speed and aperture, not from engine RPM. It is an
      // acoustic approximation, not a measured exhaust directivity model.
      this.exEdgePole = 1 - Math.exp(-2 * Math.PI * Math.max(650, Math.min(2600, cEx / (2 * Math.PI * cfg.exhaustDiameter))) / this.sr);
      this.inEdgePole = 1 - Math.exp(-2 * Math.PI * Math.max(700, Math.min(2800, cIn / (2 * Math.PI * cfg.intakeDiameter))) / this.sr);
      this.tuneExhaustPresence();
      if (this.hasTwinTurbo) this.tuneTurboUnits();
      else if (this.hasBoost) {
        const ambientDensity = cfg.ambientP / (287 * cfg.ambientT);
        const compressorArea = Math.max(1e-7, cfg.compressorArea);
        const diameter = Math.sqrt(4 * compressorArea / Math.PI);
        const tipSpeed = cfg.boost === 'turbo' ? Math.abs(this.current[13]) * Math.PI / 30 * cfg.turboRadius : 0;
        const transportSpeed = Math.abs(this.current[14]) / (ambientDensity * compressorArea);
        this.colorBoostSpeed += this.colorSmooth * (transportSpeed + .55 * tipSpeed - this.colorBoostSpeed);
        this.boostColorHz = Math.max(800, Math.min(5100, .22 * this.colorBoostSpeed / diameter));
        this.band(10, this.boostColorHz, .62);
        const reliefArea = Math.max(1e-7, cfg.bypassArea * Math.max(.015, this.current[21]));
        const reliefDensity = Math.max(.03, this.current[19] / (287 * this.colorInT));
        const reliefSpeed = Math.abs(this.current[15]) / (reliefDensity * reliefArea);
        this.colorReliefSpeed += this.colorSmooth * (reliefSpeed - this.colorReliefSpeed);
        this.reliefColorHz = Math.max(700, Math.min(5800, .24 * this.colorReliefSpeed / Math.sqrt(4 * reliefArea / Math.PI)));
        this.band(22, this.reliefColorHz, .55);
      }
    }
    tuneTurboUnits() {
      const cfg = this.config, density = cfg.ambientP / (287 * cfg.ambientT);
      // Configuration describes one of the two identical physical machines.
      // Areas are therefore per unit, while the charge room is shared.
      const area = Math.max(1e-7, cfg.compressorArea), diameter = Math.sqrt(4 * area / Math.PI);
      for (const unit of this.turboUnits) {
        const c = unit.current, base = unit.filterBase;
        const tipSpeed = Math.abs(c[0]) * Math.PI / 30 * cfg.turboRadius;
        const transportSpeed = Math.abs(c[2]) / (density * area);
        unit.colorBoostSpeed += this.colorSmooth * (transportSpeed + .55 * tipSpeed - unit.colorBoostSpeed);
        unit.boostColorHz = Math.max(800, Math.min(5100, .22 * unit.colorBoostSpeed / diameter));
        this.band(base, unit.boostColorHz, .62);
        const reliefArea = Math.max(1e-7, cfg.bypassArea * Math.max(.015, c[8]));
        const reliefDensity = Math.max(.03, c[6] / (287 * this.colorInT));
        const reliefSpeed = Math.abs(c[3]) / (reliefDensity * reliefArea);
        unit.colorReliefSpeed += this.colorSmooth * (reliefSpeed - unit.colorReliefSpeed);
        unit.reliefColorHz = Math.max(700, Math.min(5800, .24 * unit.colorReliefSpeed / Math.sqrt(4 * reliefArea / Math.PI)));
        this.band(base + 4, unit.reliefColorHz, .55);
      }
    }
    sampleTurboUnits(fraction, active) {
      let output = 0; this.twinBlade = 0;
      for (const unit of this.turboUnits) {
        const p = unit.previous, c = unit.current, l = unit.interpolated, base = unit.filterBase, noise = unit.noiseBase;
        for (let i = 0; i < c.length; i++) l[i] = p[i] + (c[i] - p[i]) * fraction;
        let gas = 0, surge = 0, blade = 0;
        unit.carrierAmplitude = 0; unit.carrierWave = 0;
        if (active) {
          const compressor = this.bounded(Math.abs(l[2]) / .04, 5), bypass = this.bounded(Math.abs(l[3]) / .04, 5);
          const turbine = this.bounded(Math.abs(l[4]) / .06, 5), work = this.bounded(Math.max(0, l[5]) / 3000, 3);
          const reverse = this.bounded(Math.max(0, -l[2]) / .04, 5), pressure = this.bounded(l[9] / this.config.ambientP, 4);
          const signed = this.bounded(l[2] / .04, 7);
          unit.flowSlow += this.pressurePole * (signed - unit.flowSlow);
          unit.pressureSlow += this.pressurePole * (pressure - unit.pressureSlow);
          unit.surgeEnvelope = Math.max(Math.sqrt(Math.max(0, l[7])), unit.surgeEnvelope * this.valveDecay);
          surge = .42 * (signed - unit.flowSlow) + .30 * (pressure - unit.pressureSlow) + .18 * unit.surgeEnvelope;
          const transport = .25 * Math.sqrt(compressor * (.18 + work) + .06 * turbine) * this.noise(noise);
          const relief = (.70 * Math.sqrt(bypass) + .44 * Math.sqrt(reverse)) * this.noise(noise + 1);
          const wastegate = this.bounded(Math.abs(l[10]) / .06, 5), turbineWork = this.bounded(Math.max(0, l[11]) / 5000, 3);
          const gateJet = .11 * Math.sqrt(wastegate * (.08 + turbineWork)) * this.noise(noise + 2);
          gas = .12 * transport + 1.02 * this.filter(base, transport) + .24 * relief + 1.12 * this.filter(base + 4, relief) + gateJet;
          if (unit.hasPhase && compressor > 0 && work > 0) {
            const aerodynamicLoad = Math.sqrt(compressor * work) * Math.min(1, Math.abs(pressure) + .12);
            unit.carrierAmplitude = .20 * aerodynamicLoad;
            unit.carrierWave = this.bladeResponse(l[1], 6, l[0] / 60, 9400);
            blade = unit.carrierAmplitude * this.bladeResponse(l[1], 6, l[0] / 60);
          }
        }
        // Each actual shaft excites its own finite response, including on pause.
        // No detuning, invented second phase, envelope clock or stereo doubling.
        unit.blade = this.filter(base + 5, blade);
        unit.output = this.filter(base + 1, gas) + this.filter(base + 3, surge + .3 * this.filter(base + 2, surge)) + unit.blade;
        output += unit.output; this.twinBlade += unit.blade;
      }
      return output;
    }
    noise(index) {
      let x = this.seeds[index]; x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      this.seeds[index] = x;
      return ((x >>> 0) / 2147483648 - 1) * this.noiseScale;
    }
    // This helper bounds physical CONTROL magnitudes before driven filters.
    // Waveform drive/containment is separately antialiased per source above;
    // the mixed output never passes through a shared nonlinear transfer.
    bounded(value, scale) { return value / (1 + Math.abs(value) / scale); }
    bladeResponse(phase, bladeCount, revolutionsPerSecond, passbandStart = 9200) {
      const frequency = Math.abs(bladeCount * revolutionsPerSecond);
      // Same reproducible passband on all devices. Above it the real blade
      // order is removed, never folded or transposed to an invented low tone.
      // Keep genuine high turbo orders below physical and device Nyquist.
      // Its load amplitude is bounded separately; the sinusoidal physical
      // carrier itself never passes through a waveform saturator.
      // Keep the legacy diagnostic response by default. The clean audible
      // carrier starts its taper at 9.4 kHz because its alignment delay and
      // final FIR already attenuate the upper band. The 11-kHz end stays fixed.
      const start = Math.min(passbandStart, .28 * this.sr), end = Math.min(11000, .43 * this.sr);
      if (frequency >= end || frequency < 10) return 0;
      const t = Math.max(0, (frequency - start) / (end - start));
      const gain = 1 - t * t * (3 - 2 * t);
      return gain * Math.sin(bladeCount * phase);
    }
    reflectionAt(samples) {
      let read = this.delayIndex - samples;
      if (read < 0) read += this.delay.length;
      const a = Math.floor(read), f = read - a;
      return this.delay[a] * (1 - f) + this.delay[(a + 1) % this.delay.length] * f;
    }
    limit(left, right) {
      const length = this.limitL.length, qLength = this.peakValues.length;
      const peak = Math.max(Math.abs(left), Math.abs(right)), frame = this.audioFrame++;
      this.limitL[this.limitIndex] = left; this.limitR[this.limitIndex] = right;
      this.limitIndex = (this.limitIndex + 1) % length;
      // Monotone deque: the largest upcoming sample, including the delayed
      // output sample, in O(1) amortized work without per-sample allocation.
      while (this.peakHead !== this.peakTail && this.peakTimes[this.peakHead] < frame - this.lookAhead) this.peakHead = (this.peakHead + 1) % qLength;
      while (this.peakHead !== this.peakTail) {
        const prior = (this.peakTail + qLength - 1) % qLength;
        if (this.peakValues[prior] > peak) break;
        this.peakTail = prior;
      }
      this.peakValues[this.peakTail] = peak; this.peakTimes[this.peakTail] = frame;
      this.peakTail = (this.peakTail + 1) % qLength;
      const maximum = this.peakValues[this.peakHead];
      const target = maximum > 0.9 ? 0.9 / maximum : 1;
      if (target < this.limiterGain) this.limiterGain = Math.max(target, this.limiterGain - 1 / this.lookAhead);
      else this.limiterGain += this.limiterRelease * (target - this.limiterGain);
      // Each peak is known a full ramp duration before playback, so this bounds
      // samples without changing their shape into flat-topped clipped waves.
      this.outputL = Math.fround(this.limitL[this.limitIndex] * this.limiterGain);
      this.outputR = Math.fround(this.limitR[this.limitIndex] * this.limiterGain);
    }
    bankReflection(bank,delay) {
      const length=this.delay.length,base=bank*length;
      let at=this.bankDelayIndex-delay;if(at<0)at+=length;
      const a=Math.floor(at),f=at-a;
      return this.bankHistory[base+a]*(1-f)+this.bankHistory[base+(a+1)%length]*f;
    }
    renderBanks(l,active) {
      let sum=0;
      for(let bank=0;bank<this.exhaustBankCount;bank++){
        const turbulent=active?(.0125/16)*Math.sqrt(Math.max(0,l[61+bank]))*this.noise(15+bank):0;
        let x=(active?.86*l[57+bank]:0)+turbulent;
        this.bankSlow[bank]+=this.exRadiationPole*(x-this.bankSlow[bank]);x-=this.bankSlow[bank];
        this.bankEdge[bank]+=this.exEdgePole*(x-this.bankEdge[bank]);x=.40*x+.96*(x-this.bankEdge[bank]);
        const pipe=x-this.reflection*this.bankReflection(bank,this.delaySamples)+this.reflection2*this.bankReflection(bank,this.delaySamples*2.13);
        this.bankHistory[bank*this.delay.length+this.bankDelayIndex]=x;
        const raw=this.filter(38+bank*2,pipe+.12*this.filter(39+bank*2,pipe));
        this.bankRawSamples[bank]=raw;sum+=raw;
      }
      if(++this.bankDelayIndex===this.delay.length)this.bankDelayIndex=0;
      return sum;
    }
    meter() {
      const n = this.meterFrames, sources = {},layers={};
      const reading = index => {
        const rms = n ? Math.sqrt(this.meterSquares[index] / n) : 0, peak = this.meterPeaks[index];
        return { rms, peak, dbRms: rms > 1e-6 ? 20 * Math.log10(rms) : -120, dbPeak: peak > 1e-6 ? 20 * Math.log10(peak) : -120 };
      };
      for (let i = 0; i < this.sourceNames.length; i++) sources[this.sourceNames[i]] = reading(i + 1);
      for(let i=0;i<this.sourceNames.length;i++){
        const rms=n?Math.sqrt(this.layerSquares[i]/n):0,peak=this.layerPeaks[i];
        layers[this.sourceNames[i]]={rms,peak,dbRms:rms>1e-6?20*Math.log10(rms):-120,dbPeak:peak>1e-6?20*Math.log10(peak):-120};
      }
      const result = { available: true, windowSeconds: n / this.sr, master: reading(0), sources,layers,
        layerPlane:'post-layer-post-fader-pre-listener-pre-master',listener:{...this.listener.settings},
        mix: { guaranteedPeak: this.guaranteedPeak, ceiling: .9, limiterGain: this.limiterGain,
          reserveGain: this.mixReserveGain, exhaustBaseBudget: this.exhaustBaseBudget, exhaustPresenceBudget: this.exhaustPresenceBudget,
          headroomDb: this.meterPeaks[0] > 1e-6 ? -20 * Math.log10(this.meterPeaks[0]) : 120 } };
      this.meterSquares.fill(0); this.meterPeaks.fill(0);this.layerSquares.fill(0);this.layerPeaks.fill(0); this.meterFrames = 0;
      return result;
    }
    // One-step causal interpolation suppresses staircase images. Physical
    // timing is never randomized: noise changes the texture within each actual
    // flow/heat/valve event, not its crank angle, duration or energy in the core.
    sample(fraction, active, transitionGain) {
      if ((this.filterCounter++ & 127) === 0) this.tune();
      const p = this.previous, c = this.current, l = this.interpolated;
      for (let i = 0; i < c.length; i++) l[i] = p[i] + (c[i] - p[i]) * fraction;
      this.reconstructPulses(fraction);
      let ex = 0, ins = 0, heat = 0, torque = 0, valve = 0, bearing = 0, boost = 0;
      let manifold = 0, mechanical = 0, gearbox = 0, chain = 0;
      let heatTexture = 0, valveTexture = 0, surge = 0, blade = 0;
      let carrierAmplitude = 0, carrierWave = 0;
      if (active) {
        let exJet = 0, inJet = 0;
        if (!this.hasBranches) {
          const rhoEx = Math.max(0.03, l[2] / (287 * Math.max(150, l[4])));
          const rhoIn = Math.max(0.03, l[3] / (287 * Math.max(150, l[5])));
          exJet = this.bounded(l[0] / (rhoEx * this.exArea * 80), 5);
          inJet = this.bounded(l[1] / (rhoIn * this.inArea * 65), 5);
        }
        const exPressure = this.bounded((l[2] - this.config.ambientP) / this.config.ambientP, 3);
        const inPressure = this.bounded((this.config.ambientP - l[3]) / this.config.ambientP, 2);
        // Leading terms are transported gas pulses, not a noise envelope driven
        // by the summed DC throughput of an ever larger number of cylinders.
        const exMotion = this.hasBranches ? l[24] : exJet;
        const inMotion = this.hasBranches ? l[25] : inJet;
        const exTurbulence = Math.sqrt(this.bounded(this.hasBranches ? l[28] : exJet * exJet, 64) * (.08 + Math.abs(exPressure)));
        const exNoise = this.noise(0);
        ex = .86 * exMotion + .18 * exPressure + (.05/16) * exTurbulence * (.35 * exNoise + .65 * this.filter(20, exNoise));
        const throttleEdge = 0.45 + 0.55 * (1 - Math.max(0, Math.min(1, l[12])));
        const inTurbulence = Math.sqrt(this.bounded(this.hasBranches ? l[29] : inJet * inJet, 64) * (.08 + Math.abs(inPressure) * throttleEdge));
        const inNoise = this.noise(1);
        ins = .52 * inMotion - .14 * inPressure + 0.045 * inTurbulence * (.35 * inNoise + .65 * this.filter(21, inNoise));
        heat = this.hasBranches ? l[26] : this.bounded(Math.max(0, l[6]), 12);
        torque = this.bounded(l[7], 6);
        valve = this.hasBranches ? l[27] : this.bounded(Math.max(0, l[8]), 5);
        heatTexture = this.hasBranches ? Math.max(0, l[30]) : heat * heat;
        valveTexture = this.hasBranches ? Math.max(0, l[31]) : valve * valve;
        bearing = Math.sqrt(this.bounded(Math.max(0, l[9]), 5)) * 0.006 * (.6 + 1.5 * this.config.bearingWear) * this.noise(4);
        manifold = l[34]; mechanical = l[35];
        if (c[54]) {
          const motion = Math.min(1, Math.abs(l[38]) / 80);
          const mesh = .085 * this.bounded(l[39] / 30, 4) * motion * this.contactResponse(l[37], l[38], c[51], 3);
          const slip = .004 * Math.sqrt(this.bounded(Math.max(0, l[41] + l[42]) / 200, 5)) * this.noise(14);
          // A successful synchronizer constraint supplies the actual angular
          // impulse. A key press alone cannot create a shift click.
          gearbox = mesh + .08 * l[36] + slip;
          if (c[49]) chain += .035 * Math.sqrt(this.bounded(Math.abs(l[45]) / 10, 5)) *
            Math.min(1, Math.abs(l[44]) / 50) * this.contactResponse(l[43], l[44], c[52], 4);
        }
        if (c[55] && c[50]) chain += .025 * Math.sqrt(this.bounded(Math.abs(l[48]) / 3, 5)) *
          Math.min(1, Math.abs(l[47]) / 80) * this.contactResponse(l[46], l[47], c[53], 4);
        if (this.hasBoost && !this.hasTwinTurbo) {
          const compressor = this.bounded(Math.abs(l[14]) / 0.04, 5);
          const bypass = this.bounded(Math.abs(l[15]) / 0.04, 5);
          const turbine = this.bounded(Math.abs(l[16]) / 0.06, 5);
          const work = this.bounded(Math.max(0, l[17]) / 3000, 3);
          const reverse = this.bounded(Math.max(0, -l[14]) / .04, 5);
          const pressure = this.bounded(l[22] / this.config.ambientP, 4);
          const signed = this.bounded(l[14] / .04, 7);
          this.boostFlowSlow += this.pressurePole * (signed - this.boostFlowSlow);
          this.boostPressureSlow += this.pressurePole * (pressure - this.boostPressureSlow);
          this.surgeEnvelope = Math.max(Math.sqrt(Math.max(0, l[20])), this.surgeEnvelope * this.valveDecay);
          // Reversal pulse and reverse-flow bursts originate in compressor
          // inertia/plenum dynamics. There is no stored flutter rhythm or timer.
          surge = .42 * (signed - this.boostFlowSlow) + .30 * (pressure - this.boostPressureSlow) + .18 * this.surgeEnvelope;
          // The audible broadband compressor/relief component must not vanish
          // merely because the physical blade order has become ultrasonic.
          // Strength still goes to zero with real gas transport, not with a
          // UI throttle trigger or an invented low-frequency rotor tone.
          const transport = .25 * Math.sqrt(compressor * (.18 + work) + .06 * turbine) * this.noise(5);
          const relief = ((this.config.boost === 'turbo' ? .70 : .65) * Math.sqrt(bypass) + .44 * Math.sqrt(reverse)) * this.noise(6);
          // A wastegate is an already integrated hot gas bypass. Its local
          // jet texture follows actual flow and turbine pressure work, with
          // no hiss scheduled merely because the gate control is enabled.
          const wastegate = this.bounded(Math.abs(l[32]) / .06, 5);
          const turbineWork = this.bounded(Math.max(0, l[33]) / 5000, 3);
          const gateJet = .11 * Math.sqrt(wastegate * (.08 + turbineWork)) * this.noise(7);
          // Different moving flow spectra for compressor transport and actual
          // relief/reversal. Short stochastic pressure fluctuations remain
          // causal; no whoosh envelope is scheduled by throttle/key release.
          boost = .12 * transport + 1.02 * this.filter(10, transport) + .24 * relief + 1.12 * this.filter(22, relief) + gateJet;
          if (this.hasRotorPhase && compressor > 0 && work > 0) {
            const blades = this.config.boost === 'turbo' ? 6 : 3;
            const aerodynamicLoad = Math.sqrt(compressor * work) * Math.min(1, Math.abs(pressure) + .12);
            carrierAmplitude = .20 * aerodynamicLoad;
            carrierWave = this.bladeResponse(l[18], blades, l[13] / 60, 9400);
            blade = carrierAmplitude * this.bladeResponse(l[18], blades, l[13] / 60);
          }
        }
      }
      const twinBoost = this.hasTwinTurbo ? this.sampleTurboUnits(fraction, active) : 0;
      blade = this.hasTwinTurbo ? this.twinBlade : this.hasBoost ? this.filter(23, blade) : 0;
      this.sourceExSlow += this.exRadiationPole * (ex - this.sourceExSlow);
      this.sourceInSlow += this.inRadiationPole * (ins - this.sourceInSlow);
      ex -= this.sourceExSlow; ins -= this.sourceInSlow;
      this.sourceExEdge += this.exEdgePole * (ex - this.sourceExEdge);
      this.sourceInEdge += this.inEdgePole * (ins - this.sourceInEdge);
      ex = .48 * ex + .82 * (ex - this.sourceExEdge);
      ins = .52 * ins + .75 * (ins - this.sourceInEdge);
      this.torqueSlow += this.torquePole * (torque - this.torqueSlow);
      this.heatSlow += this.torquePole * (heat - this.heatSlow);
      // Additional structural microtexture is excited by the same radiating
      // pressure change as the body sound. Raw heat throughput can be nearly
      // constant with many overlapping cylinders and must not sustain hiss.
      this.heatEnvelope = Math.max(Math.min(Math.sqrt(heatTexture), Math.abs(heat - this.heatSlow)), this.heatEnvelope * this.heatDecay);
      this.valveEnvelope = Math.max(Math.sqrt(valveTexture), this.valveEnvelope * this.valveDecay);
      // Thermal pressure already contains the actual combustion transient.
      // Keep the extra statistical roughness small, particularly where many
      // chambers would otherwise leave a near-continuous noise envelope.
      const structure = .38 * (heat - this.heatSlow) + .055 * (torque - this.torqueSlow) + 0.01 * this.heatEnvelope * this.noise(2);
      const valveImpact = .48 * valve + 0.025 * this.valveEnvelope * this.noise(3);
      // Finite feed-forward reflections, never a recirculating tuned comb.
      // Only the audio is delayed; there is no gas-dynamics feedback.
      this.delaySamples += this.delaySmooth * (this.delayTarget - this.delaySamples);
      const pipe = ex - this.reflection * this.reflectionAt(this.delaySamples) + this.reflection2 * this.reflectionAt(this.delaySamples * 2.13);
      this.delay[this.delayIndex] = ex;
      if (++this.delayIndex === this.delay.length) this.delayIndex = 0;
      this.manifoldSlow += this.exRadiationPole * (manifold - this.manifoldSlow);
      this.mechanicalSlow += this.torquePole * (mechanical - this.mechanicalSlow);
      manifold -= this.manifoldSlow; mechanical -= this.mechanicalSlow;
      const raw = this.rawSourceSamples, values = this.sourceSamples, mixed = this.mixSourceSamples;
      raw[0] = this.hasBranches&&this.exhaustBankCount>1?this.renderBanks(l,active):this.filter(1, pipe + .12 * this.filter(0, pipe));
      raw[1] = this.filter(3, ins + .18 * this.filter(2, ins));
      raw[2] = this.filter(5, .36 * this.filter(4, structure) + .64 * structure);
      raw[3] = this.filter(7, .72 * this.filter(6, valveImpact) + .28 * valveImpact);
      raw[4] = this.filter(9, 0.60 * bearing + 0.50 * this.filter(8, bearing));
      raw[5] = this.hasTwinTurbo ? twinBoost : this.hasBoost ? this.filter(11, boost) + this.filter(19, surge + .3 * this.filter(18, surge)) + blade : 0;
      raw[6] = this.filter(13, .56 * manifold + .44 * this.filter(12, manifold));
      raw[7] = this.filter(15, .30 * mechanical + .70 * this.filter(14, mechanical));
      raw[8] = this.filter(17, .65 * gearbox + .35 * this.filter(16, gearbox));
      raw[9] = this.filter(37, .55 * chain + .45 * this.filter(36, chain));
      const g = this.gains, t = this.targets;
      g.master += this.controlSmooth * (t.master - g.master);
      g.bite += this.controlSmooth * (t.bite - g.bite);
      this.muteGain = active && !t.muted ? Math.min(1, this.muteGain + this.controlMuteRise) : Math.max(0, this.muteGain - this.controlMuteFall);
      for (let i = 0; i < this.sourceNames.length; i++) {
        const key=this.sourceNames[i],setting=this.layerSettings[key],target=t.layers[key];
        setting.preGain+=this.controlSmooth*(target.preGain-setting.preGain);
        setting.distortion+=this.controlSmooth*(target.distortion-setting.distortion);
        const enabled=target.enabled&&(!this.anySolo||target.solo)?1:0;
        this.layerActive[i]+=this.controlSmooth*(enabled-this.layerActive[i]);
        g[key]+=this.controlSmooth*(t[key]-g[key]);
        values[i]=raw[i]*g[key]*transitionGain;
        let output=0;
        if(i===0&&this.hasBranches&&this.exhaustBankCount>1){
          for(let bank=0;bank<this.exhaustBankCount;bank++)output+=this.bankLayers[bank].process(this.bankPres[bank].process(this.bankRawSamples[bank]),setting.preGain,setting.distortion,g.bite);
        }else if(i===5&&this.hasTwinTurbo){
          const first=this.turboUnits[0],second=this.turboUnits[1];
          output=this.containSource(5,first.output-first.blade)+this.containSource(10,second.output-second.blade)+
            this.alignCarrier(0,this.containCarrier(first.carrierAmplitude,first.carrierWave,setting.preGain,.5))+
            this.alignCarrier(1,this.containCarrier(second.carrierAmplitude,second.carrierWave,setting.preGain,.5));
        }else if(i===5){
          output=this.containSource(5,raw[i]-blade)+this.alignCarrier(0,this.containCarrier(carrierAmplitude,carrierWave,setting.preGain));
        }else output=this.containSource(i,raw[i]);
        if(i===0){
          this.exhaustBaseSample=output*g[key]*transitionGain*this.layerActive[i];
          const presence=this.renderExhaustPresence(l,active);
          this.exhaustPresenceSample=presence*g[key]*transitionGain*this.layerActive[i];
          output+=presence;
        }
        const post=output*g[key]*transitionGain*this.layerActive[i];
        this.layerSamples[i]=post;mixed[i]=post*g.master*this.mixReserveGain;
        this.meterSquares[i+1]+=values[i]*values[i];this.meterPeaks[i+1]=Math.max(this.meterPeaks[i+1],Math.abs(values[i]));
        this.layerSquares[i]+=post*post;this.layerPeaks[i]=Math.max(this.layerPeaks[i],Math.abs(post));
      }
      this.carrierIndex=(this.carrierIndex+1)%16;
      this.listener.process(this.layerSamples);
      this.renderOutput(this.listener.outputL,this.listener.outputR);
      const master=this.muteGain*g.master*this.mixReserveGain;
      this.limit(this.filteredL*master,this.filteredR*master);
      // A configuration commits at transitionGain === 0. Also fade the stored
      // look-ahead output, so clearing its last 2 ms cannot cut off a live tail.
      this.outputL = Math.fround(this.outputL * transitionGain);
      this.outputR = Math.fround(this.outputR * transitionGain);
      if (!Number.isFinite(this.outputL) || !Number.isFinite(this.outputR)) throw new Error('Ungültiger Audio-Ausgang.');
      // The exact Float32 samples assigned to the Worklet output are measured.
      this.meterSquares[0] += 0.5 * (this.outputL * this.outputL + this.outputR * this.outputR);
      this.meterPeaks[0] = Math.max(this.meterPeaks[0], Math.abs(this.outputL), Math.abs(this.outputR));
      this.meterFrames++;
    }
  }

  function workletBoot(backend = 'worklet') {
    class MotorProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this.runtime = new MotorRuntime((m, transfers) => this.port.postMessage(m, transfers || []));
        this.synth = null;
        this.outputSquares = this.outputPeak = this.outputFrames = 0;
        this.runtime.audioMeter = () => {
          if (!this.synth) return MotorRuntime.silentMeter(false);
          const meter = this.synth.meter(), rms = this.outputFrames ? Math.sqrt(this.outputSquares / this.outputFrames) : 0;
          meter.sourceWindowSeconds = meter.windowSeconds;
          meter.windowSeconds = this.outputFrames / sampleRate;
          meter.master = { rms, peak: this.outputPeak,
            dbRms: rms > 1e-6 ? 20 * Math.log10(rms) : -120,
            dbPeak: this.outputPeak > 1e-6 ? 20 * Math.log10(this.outputPeak) : -120 };
          meter.mix.headroomDb = this.outputPeak > 1e-6 ? -20 * Math.log10(this.outputPeak) : 120;
          this.outputSquares = this.outputPeak = this.outputFrames = 0;
          return meter;
        };
        this.accumulator = 0;
        this.audioDebt = 0;
        this.resampleL = new Float64Array(4);
        this.resampleR = new Float64Array(4);
        this.generatedAudioFrames = 0;
        this.snapshotSamples = 0;
        this.transitionGain = 0;
        this.volumeGate = 0;
        this.pending = null;
        this.audio = MotorAcoustics.defaultAudio();
        this.port.onmessage = event => {
          const m = event.data;
          if (m.type === 'configure') {
            if (this.pending) this.port.postMessage({ type: 'reply', id: this.pending.id, ok: true, superseded: true });
            this.pending = m;
            if (!this.runtime.engine || this.runtime.paused || this.runtime.failed) this.commit();
          } else if (m.type === 'audio') {
            this.audio=MotorAcoustics.mergeAudio(this.audio,m.audio);
            if (this.synth) this.synth.setAudio(this.audio);
          } else {
            this.runtime.command(m, backend);
            // Retain fractional physical time across rate/pause changes. Only
            // installing a different physical state starts a new accumulator.
          }
        };
      }
      commit() {
        const message = this.pending;
        if (!message) return;
        this.pending = null;
        this.transitionGain = 0;
        this.accumulator = 0;
        this.audioDebt = 0;
        this.resampleL.fill(0); this.resampleR.fill(0);
        this.generatedAudioFrames = 0;
        this.outputSquares = this.outputPeak = this.outputFrames = 0;
        try {
          this.runtime.configure(message);
          const normalized = this.runtime.engine.config;
          if (this.synth) this.synth.configure(normalized);
          else this.synth = new MotorAcoustics(sampleRate, normalized);
          this.synth.setAudio(this.audio);
          this.synth.setPlaybackRate(this.runtime.rate);
          this.synth.capture(this.runtime.engine.signal);
          this.runtime.push(backend);
          this.port.postMessage({ type: 'reply', id: message.id, ok: true, sampleRate });
        } catch (error) {
          this.runtime.fail(error);
          this.port.postMessage({ type: 'reply', id: message.id, error: error.message || String(error) });
        }
      }
      process(inputs, outputs) {
        const channels = outputs[0];
        if (!channels || !channels.length) return true;
        const frames = channels[0].length;
        this.runtime.audioBlockFrames = frames;
        this.runtime.audioSampleRate = sampleRate;
        try {
          for (let i = 0; i < frames; i++) {
            if (this.pending) {
              this.transitionGain = Math.max(0, this.transitionGain - 1 / (sampleRate * 0.015));
              if (this.transitionGain === 0) this.commit();
            } else if (this.runtime.engine && !this.runtime.paused && !this.runtime.failed) this.transitionGain = Math.min(1, this.transitionGain + 1 / (sampleRate * 0.02));
            else this.transitionGain = Math.max(0, this.transitionGain - 1 / (sampleRate * 0.015));
            const r = this.runtime;
            const running = !!r.engine && !r.paused && !r.failed;
            if (this.synth) {
              const clockRate = running ? r.rate : 1;
              if (this.synth.playbackRate !== clockRate) this.synth.setPlaybackRate(clockRate);
              this.audioDebt += clockRate;
              // Motor and the whole acoustic network advance on one simulated
              // sample clock. Slow motion includes pipe delays, rotor phase,
              // contact decay and the stochastic texture, not just firing rate.
              while (this.audioDebt >= 1 - 1e-12) {
                this.audioDebt = Math.max(0, this.audioDebt - 1);
                if (running) {
                  this.accumulator += 1 / sampleRate;
                  while (this.accumulator >= r.dt - 1e-14) {
                    r.step(); this.accumulator -= r.dt;
                    this.synth.capture(r.engine.signal);
                    if (r.failed) break;
                  }
                  this.generatedAudioFrames++;
                }
                this.synth.sample(Math.max(0, Math.min(1, this.accumulator / r.dt)), running && !r.failed, this.transitionGain);
                const a = this.resampleL, b = this.resampleR;
                for (let k = 0; k < 3; k++) { a[k] = a[k + 1]; b[k] = b[k + 1]; }
                a[3] = this.synth.outputL; b[3] = this.synth.outputR;
              }
              // At unity rate retain the already band-limited acoustic samples
              // without applying another smoothing filter. The same two-sample
              // delay keeps this path aligned with slow-motion reconstruction.
              // A remainder retained across rate changes uses bounded linear
              // interpolation. Slow motion retains the positive cubic kernel.
              const a = this.resampleL, b = this.resampleR;
              const f = this.audioDebt;
              let reconstructedL, reconstructedR;
              if (clockRate === 1) {
                reconstructedL = a[1] + (a[2] - a[1]) * f;
                reconstructedR = b[1] + (b[2] - b[1]) * f;
              } else if (f === 0) {
                reconstructedL = a[0] / 6 + (2 / 3) * a[1] + a[2] / 6;
                reconstructedR = b[0] / 6 + (2 / 3) * b[1] + b[2] / 6;
              } else {
                const f2 = f * f, f3 = f2 * f, g = 1 - f;
                const w0 = g * g * g / 6, w1 = (3 * f3 - 6 * f2 + 4) / 6;
                const w2 = (-3 * f3 + 3 * f2 + 3 * f + 1) / 6, w3 = f3 / 6;
                reconstructedL = w0 * a[0] + w1 * a[1] + w2 * a[2] + w3 * a[3];
                reconstructedR = w0 * b[0] + w1 * b[1] + w2 * b[2] + w3 * b[3];
              }
              // Master zero must become exact silence in real time, including
              // a long stretched look-ahead tail at 1/50 playback speed.
              const audible = running && !this.synth.targets.muted && this.synth.targets.master > 0;
              this.volumeGate = audible ? Math.min(1, this.volumeGate + 1 / (sampleRate * .020)) : Math.max(0, this.volumeGate - 1 / (sampleRate * .015));
              const gain = this.transitionGain * this.volumeGate;
              const left = Math.fround(reconstructedL * gain);
              const right = Math.fround(reconstructedR * gain);
              channels[0][i] = left;
              for (let ch = 1; ch < channels.length; ch++) channels[ch][i] = right;
              this.outputSquares += .5 * (left * left + right * right);
              this.outputPeak = Math.max(this.outputPeak, Math.abs(left), Math.abs(right));
              this.outputFrames++;
            } else for (let ch = 0; ch < channels.length; ch++) channels[ch][i] = 0;
            if (++this.snapshotSamples >= sampleRate / 30) {
              this.snapshotSamples = 0;
              r.push(backend);
            }
          }
        } catch (error) {
          this.runtime.fail(error);
          for (let ch = 0; ch < channels.length; ch++) channels[ch].fill(0);
        }
        return true;
      }
    }
    registerProcessor('motor-labor-v1', MotorProcessor);
  }

  function workerBoot() {
    const runtime = new MotorRuntime((m, transfers) => self.postMessage(m, transfers || []));
    let last = performance.now(), lastSnapshot = last, debt = 0;
    let ratioWall = last, ratioSim = 0;
    self.onmessage = event => {
      const message = event.data;
      if (message.type === 'configure') {
        try {
          runtime.configure(message);
          debt = 0; last = performance.now(); ratioWall = last; ratioSim = runtime.engine.time;
          runtime.push('worker');
          self.postMessage({ type: 'reply', id: message.id, ok: true });
        } catch (error) {
          runtime.fail(error);
          self.postMessage({ type: 'reply', id: message.id, error: error.message || String(error) });
        }
      } else {
        runtime.command(message, 'worker');
        if (message.type === 'freeze' || message.type === 'paused' || message.type === 'rate' || message.type === 'handoff' || message.type === 'resumeHandoff') {
          debt = 0; last = performance.now(); ratioWall = last;
          ratioSim = runtime.engine ? runtime.engine.time : 0;
        }
      }
    };
    setInterval(() => {
      const now = performance.now();
      const elapsed = Math.max(0, (now - last) / 1000);
      last = now;
      if (runtime.engine && !runtime.paused && !runtime.failed) {
        debt += elapsed * runtime.rate;
        let steps = Math.min(1200, Math.floor((debt + 1e-12) / runtime.dt));
        while (steps-- > 0 && !runtime.failed) { runtime.step(); debt -= runtime.dt; }
        if (now - ratioWall >= 500) {
          runtime.ratio = (runtime.engine.time - ratioSim) / ((now - ratioWall) / 1000 * runtime.rate);
          ratioWall = now; ratioSim = runtime.engine.time;
        }
      } else debt = 0;
      if (!runtime.paused && now - lastSnapshot >= 1000 / 30) { runtime.push('worker'); lastSnapshot = now; }
    }, 8);
  }

  function sourceFor(coreSource, isWorklet) {
    return "'use strict';\n(function(Math, Number) {\n" + coreSource + '\n' + MotorRuntime.toString() + '\n' +
      (isWorklet ? AcousticPre.toString() + '\n' + AcousticLayer.toString() + '\n' + AcousticListener.toString() + '\n' + MotorAcoustics.toString() + '\n(' + workletBoot.toString() + ')();' : '(' + workerBoot.toString() + ')();') +
      '\n})(globalThis.Math, globalThis.Number);';
  }

  function compatibilitySourceFor(coreSource) {
    // Compile the exact supplied motor source as a local ES module. The small
    // port shim changes transport only; process() is the SAME implementation.
    // No eval, second worker clock, scheduled sample buffers or motor loops.
    return 'const Math = globalThis.Math, Number = globalThis.Number;\n' + coreSource + '\n' +
      MotorRuntime.toString() + '\n' + AcousticPre.toString() + '\n' + AcousticLayer.toString() + '\n' + AcousticListener.toString() + '\n' + MotorAcoustics.toString() +
      '\nexport function createProcessor(sampleRate, post) {\n' +
      'let Processor;\nclass AudioWorkletProcessor { constructor() { this.port = { onmessage: null, postMessage: post }; } }\n' +
      'const registerProcessor = (name, type) => { Processor = type; };\n(' + workletBoot.toString() +
      ")('scriptprocessor');\nreturn new Processor();\n}";
  }

  return class SimulationDriver {
    constructor({ coreSource, onSnapshot, onStatus, onError, audioTimeoutMs = 3000, moduleTimeoutMs = 4000, renderSizeHint = 'default' }) {
      if (!['default', 128, 512, 1024, 2048].includes(renderSizeHint)) throw new Error('Ungültige Audiopuffergröße.');
      this.coreSource = coreSource;
      this.renderSizeHint = renderSizeHint;
      this.onSnapshot = onSnapshot || (() => {});
      this.onStatus = onStatus || (() => {});
      this.onError = onError || (() => {});
      this.channel = null;
      this.context = null;
      this.config = null;
      this.controls = {};
      this.audio = MotorAcoustics.defaultAudio();
      this.paused = true; this.rate = 1;
      this.backend = null; this.destroyed = false;
      this.nextId = 1;
      this.clockCheck = null;
      this.measuredRatio = 1;
      this.reconfiguring = 0;
      this.broken = false;
      this.enablingAudio = null;
      this.handoffQueue = null;
      this.audioRevision = 0;
      this.generation = 0;
      this.preparing = false;
      this.pendingContexts = new Set();
      this.pendingChannels = new Set();
      this.waiters = new Set();
      this.audioTimeoutMs = audioTimeoutMs;
      this.moduleTimeoutMs = moduleTimeoutMs;
      this.audioIssue = null;
      this.recoveryState = null;
      this.commandSequence = 0;
      this.commandJournal = [];
      this.configurationId = 0;
      this.lastStatusMessage = '';
    }
    static workletSource(coreSource) { return sourceFor(coreSource, true); }
    static workerSource(coreSource) { return sourceFor(coreSource, false); }
    static compatibilitySource(coreSource) { return compatibilitySourceFor(coreSource); }
    static acousticsClass() { return MotorAcoustics; }
    static audioModules() { return {Pre:AcousticPre,Layer:AcousticLayer,Listener:AcousticListener,Acoustics:MotorAcoustics}; }
    get dt() { return PHYSICS_DT; }
    get audioAvailable() {
      return !this.destroyed && !this.broken && !!this.channel && !this.channel.closing &&
        this.channel.initialized !== false && ['worklet', 'scriptprocessor'].includes(this.channel.backend) &&
        !!this.context && this.context === this.channel.context && this.context.state !== 'closed';
    }
    get audioState() {
      if (this.destroyed || this.context?.state === 'closed') return 'closed';
      if (this.preparing && !this.audioAvailable) return 'initializing';
      if (!this.channel) return this.audioIssue ? 'unavailable' : 'idle';
      if (!this.audioAvailable) return 'unavailable';
      if (this.context.state !== 'running') return 'suspended';
      if (this.paused) return 'paused';
      return this.audio.muted || this.audio.master <= 0 ? 'muted' : 'running';
    }
    getAudioBufferInfo() {
      const channel = this.channel, context = this.context;
      const observed = channel?.observedBufferFrames;
      const declared = channel?.backend === 'scriptprocessor' ? channel.node?.bufferSize : context?.renderQuantumSize;
      const bufferFrames = Number.isInteger(observed) && observed > 0 ? observed :
        Number.isInteger(declared) && declared > 0 ? declared : null;
      const requested = this.renderSizeHint;
      const rate = context?.sampleRate;
      let fallback = channel?.bufferFallbackReason || null;
      let supported = null;
      if (bufferFrames !== null && channel?.backend === 'worklet') {
        supported = requested === 'default' ? bufferFrames === 128 : bufferFrames === requested;
        if (!supported && !fallback) fallback = {code:'render-size-not-honored',
          message:'Der Browser verwendet ' + bufferFrames + ' statt ' + (requested === 'default' ? 128 : requested) + ' Frames. Die tatsächlich gemessene Blockgröße gilt.'};
      } else if (bufferFrames !== null && channel?.backend === 'scriptprocessor') {
        const expected = requested === 'default' ? 2048 : requested;
        supported = bufferFrames === expected;
        if (requested === 128 && !fallback) fallback = {code:'compatibility-buffer-minimum',
          message:'Der kompatible Audioausgang benötigt mindestens 256 Frames pro Block.'};
      }
      return {requestedRenderSizeHint:requested, bufferFrames,
        bufferSeconds:bufferFrames !== null && Number.isFinite(rate) && rate > 0 ? bufferFrames / rate : null,
        renderSizeSupported:supported, bufferFallbackReason:fallback};
    }
    status(message) {
      if (this.destroyed) return;
      if (typeof message === 'string') this.lastStatusMessage = message;
      const running = !!this.context && this.context.state === 'running';
      this.onStatus({ backend: this.backend, message:this.lastStatusMessage, audioAvailable: this.audioAvailable,
        audioState: this.audioState, audioIssue: this.audioIssue,
        audioRunning: this.audioAvailable && running && !this.audio.muted && this.audio.master > 0 && !this.paused,
        contextState: this.context ? this.context.state : null,
        clockRunning: !this.broken && (this.backend === 'worker' || running),
        sampleRate: this.context ? this.context.sampleRate : null,
        capabilities: { audioWorklet: this.backend === 'worklet',
          compatibilityAudio: this.backend === 'scriptprocessor',
          fallbackReason: this.channel?.fallbackReason || null,
          ...this.getAudioBufferInfo() } });
    }
    issue(error, fallbackCode = 'audio-unavailable') {
      return { code: error?.code || fallbackCode, message: error?.message || String(error) };
    }
    audioError(code, message, cause) {
      const error = new Error(message + (cause?.message ? ' ' + cause.message : ''));
      error.code = code;
      return error;
    }
    assertCurrent(generation) {
      if (this.destroyed || generation !== this.generation) {
        const error = this.audioError('operation-cancelled', 'Audioinitialisierung wurde abgebrochen.');
        error.name = 'AbortError'; throw error;
      }
    }
    boundedWait(promise, milliseconds, code, message, generation = this.generation) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error, value) => {
          if (settled) return;
          settled = true; clearTimeout(timer); this.waiters.delete(cancel);
          if (error) reject(error); else resolve(value);
        };
        const cancel = () => finish(this.audioError('operation-cancelled', 'Audioinitialisierung wurde abgebrochen.'));
        const timer = setTimeout(() => finish(this.audioError(code, message)), milliseconds);
        this.waiters.add(cancel);
        Promise.resolve(promise).then(value => {
          try { this.assertCurrent(generation); finish(null, value); } catch (error) { finish(error); }
        }, error => finish(error));
      });
    }
    async resumeContext(context, generation = this.generation) {
      this.assertCurrent(generation);
      if (context.state === 'closed') throw this.audioError('audio-context-closed', 'Der Browser hat den Audiokontext geschlossen.');
      try {
        // This call happens before the first await and retains the user gesture.
        await this.boundedWait(context.resume(), this.audioTimeoutMs, 'audio-resume-timeout',
          'Der Browser hat die Audiofreigabe nicht innerhalb von ' + this.audioTimeoutMs + ' ms bestätigt.', generation);
      } catch (error) {
        if (error.code) throw error;
        throw this.audioError('audio-resume-failed', 'Der Browser konnte den Audiotakt nicht fortsetzen.', error);
      }
      this.assertCurrent(generation);
      if (context.state !== 'running') throw this.audioError('audio-not-running', 'Der Audiokontext ist weiterhin im Zustand ' + context.state + '.');
    }
    closeContext(context) {
      if (!context) return;
      context.onstatechange = null;
      try { Promise.resolve(context.close()).catch(() => {}); } catch (_) {}
    }
    receive(message, channel) {
      if (message.type === 'reply') {
        const request = channel.requests.get(message.id);
        if (request) {
          channel.requests.delete(message.id); clearTimeout(request.timer);
          if (message.error) request.reject(new Error(message.error)); else request.resolve(message);
        }
        return;
      }
      if (this.channel !== channel || this.destroyed) return;
      if (message.type === 'error') { this.paused = true; this.onError(message.message); this.status('Simulation angehalten.'); return; }
      if (message.type !== 'snapshot') return;
      // During the short outgoing sound fade, the old motor may still publish.
      // Do not let an old configuration pollute a newly cleared chart or view.
      if (message.recovery) {
        if (message.recovery.configurationId !== this.configurationId) return;
        this.recoveryState = message.recovery;
        channel.recovery = message.recovery;
        const acknowledged = message.recovery.commandSequence;
        this.commandJournal = this.commandJournal.filter(command => command.commandSequence > acknowledged);
      } else if (this.reconfiguring) return;
      const s = message.snapshot;
      const frames = s.timing?.audioBlockFrames;
      if (Number.isInteger(frames) && frames > 0 && channel.observedBufferFrames !== frames) {
        channel.observedBufferFrames = frames;
        this.status();
      }
      const packed = message.packed;
      s.history = [];
      if (packed && message.count) {
        const cylinders = (message.stride - 12) / 3;
        for (let i = 0; i < message.count; i++) {
          let k = i * message.stride;
          const point = { time: packed[k++], angle: packed[k++], rpm: packed[k++], torque: packed[k++], v: packed[k++], gear: packed[k++], clutchTorque: packed[k++], clutchSlip: packed[k++], boost: packed[k++], meanTorque: packed[k++], power: packed[k++], brake: packed[k++], cyl: [] };
          for (let j = 0; j < cylinders; j++) point.cyl.push({ p: packed[k++], volume: packed[k++], phase: packed[k++] });
          s.history.push(point);
        }
      }
      const now = performance.now();
      if (s.timing.paused || this.rate !== s.timing.rate || !this.clockCheck || s.time < this.clockCheck.time) {
        this.clockCheck = { wall: now, time: s.time };
        this.measuredRatio = 1;
      } else if (now - this.clockCheck.wall >= 750) {
        this.measuredRatio = (s.time - this.clockCheck.time) / ((now - this.clockCheck.wall) / 1000 * s.timing.rate);
        this.clockCheck = { wall: now, time: s.time };
      }
      if (this.backend === 'worklet' || this.backend === 'scriptprocessor') s.timing.realtimeRatio = this.measuredRatio;
      this.onSnapshot(s);
    }
    attach(endpoint, backend, resources) {
      const channel = { endpoint, backend, requests: new Map(), ...resources };
      endpoint.onmessage = event => this.receive(event.data, channel);
      if (backend === 'worker') endpoint.onerror = event => {
        if (channel === this.channel) { this.broken = true; this.paused = true;
          this.onError('Der Physik-Worker wurde angehalten: ' + (event.message || 'Browserfehler.')); }
      };
      return channel;
    }
    ask(channel, type, values) {
      return new Promise((resolve, reject) => {
        if (!channel || channel.closing || this.destroyed) { reject(this.audioError('operation-cancelled', 'Simulationskontext geschlossen.')); return; }
        const id = this.nextId++;
        const timer = setTimeout(() => { channel.requests.delete(id); reject(new Error('Der Simulationskern antwortet nicht.')); }, 12000);
        channel.requests.set(id, { resolve, reject, timer });
        try { channel.endpoint.postMessage({ type, id, ...values }); }
        catch (error) { channel.requests.delete(id); clearTimeout(timer); reject(error); }
      });
    }
    send(type, values) {
      if (this.destroyed) return;
      const message = { type, ...values };
      const physical = ['controls', 'paused', 'rate', 'step'].includes(type);
      if (physical) {
        if (message.controls) {
          message.controls = { ...message.controls };
          if (message.controls.cylinders) message.controls.cylinders = message.controls.cylinders.slice();
        }
        message.commandSequence = ++this.commandSequence;
        this.commandJournal.push(message);
      }
      if (this.handoffQueue && physical) {
        this.handoffQueue.push(message);
      } else if (this.channel && !this.channel.closing) this.channel.endpoint.postMessage(message);
    }
    resumeHandoff(channel, state) {
      const commands = this.handoffQueue || [];
      this.handoffQueue = null;
      if (state.controls) this.controls = { ...state.controls, ...(state.controls.cylinders ? {cylinders: state.controls.cylinders.slice()} : {}) };
      this.paused = state.paused; this.rate = state.rate;
      for (const message of commands) {
        if (message.type === 'controls') Object.assign(this.controls, message.controls);
        else if (message.type === 'paused') this.paused = message.paused;
        else if (message.type === 'rate') this.rate = message.rate;
      }
      delete this.controls.starterSeconds; delete this.controls.gearRequest;
      channel.endpoint.postMessage({ type: 'resumeHandoff', paused: state.paused, rate: state.rate, commands });
    }
    async prepareWorklet() {
      // Keep the old method name for integrations that override preparation.
      // It now chooses the best available real audio transport.
      const generation = this.generation;
      this.assertCurrent(generation);
      const host = typeof window === 'undefined' ? globalThis : window;
      const Context = host.AudioContext || host.webkitAudioContext;
      if (!Context) throw this.audioError('web-audio-missing', 'Dieser Browser stellt keine Web-Audio-API bereit.');
      let context, bufferFallbackReason = null;
      const requested = this.renderSizeHint;
      const options = {latencyHint:'interactive'};
      if (requested !== 'default') options.renderSizeHint = requested;
      try { context = new Context(options); }
      catch (error) {
        // Older implementations may reject the new hint instead of ignoring it.
        // Retry only that unsupported-option case, never an access denial.
        if (requested === 'default' || !['NotSupportedError', 'TypeError'].includes(error.name))
          throw this.audioError('audio-context-create-failed', 'Der Browser konnte keinen Audiokontext anlegen.', error);
        try { context = new Context({latencyHint:'interactive'}); }
        catch (retryError) { throw this.audioError('audio-context-create-failed', 'Der Browser konnte keinen Audiokontext anlegen.', retryError); }
        bufferFallbackReason = {code:'render-size-rejected',
          message:'Der Browser hat die gewünschte Audioblockgröße abgelehnt. Der Audioausgang verwendet den Browserstandard.'};
      }
      this.pendingContexts.add(context);
      const resume = this.resumeContext(context, generation);
      resume.catch(() => {});
      let node, channel, fallbackReason;
      try {
        const WorkletNode = host.AudioWorkletNode || (typeof AudioWorkletNode === 'undefined' ? null : AudioWorkletNode);
        if (context.audioWorklet && WorkletNode) {
          try {
            const url = URL.createObjectURL(new Blob([sourceFor(this.coreSource, true)], { type: 'application/javascript' }));
            try {
              await this.boundedWait(context.audioWorklet.addModule(url), this.moduleTimeoutMs,
                'worklet-module-timeout', 'Das AudioWorklet-Modul wurde nicht innerhalb von ' + this.moduleTimeoutMs + ' ms geladen.', generation);
            } finally { URL.revokeObjectURL(url); }
            this.assertCurrent(generation);
            node = new WorkletNode(context, 'motor-labor-v1', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
            channel = this.attach(node.port, 'worklet', { node, context, initialized: false, bufferFallbackReason });
            node.connect(context.destination);
          } catch (error) {
            this.assertCurrent(generation);
            if (node) { try { node.disconnect(); node.port?.close(); } catch (_) {} }
            node = channel = null;
            fallbackReason = this.issue(error, 'worklet-module-failed');
          }
        } else fallbackReason = {code: 'worklet-missing', message: 'AudioWorklet ist in diesem Browserkontext nicht verfügbar.'};
        if (!channel) {
          if (typeof context.createScriptProcessor !== 'function') throw this.audioError('audio-backends-unavailable',
            fallbackReason.message + ' Auch der kompatible ScriptProcessor-Ausgang ist nicht verfügbar.');
          const url = URL.createObjectURL(new Blob([compatibilitySourceFor(this.coreSource)], { type: 'application/javascript' }));
          let module;
          try {
            module = await this.boundedWait(this.loadCompatibilityModule(url), this.moduleTimeoutMs,
              'compatibility-module-timeout', 'Das kompatible Audiomodul wurde nicht innerhalb von ' + this.moduleTimeoutMs + ' ms geladen.', generation);
          } catch (error) {
            if (error.code) throw error;
            throw this.audioError('compatibility-module-failed', 'Das kompatible Audiomodul konnte nicht geladen werden.', error);
          } finally { URL.revokeObjectURL(url); }
          this.assertCurrent(generation);
          let processor, closed = false;
          const endpoint = { onmessage: null,
            postMessage: message => { if (!closed) processor.port.onmessage({data: message}); },
            close: () => { closed = true; endpoint.onmessage = null; } };
          processor = module.createProcessor(context.sampleRate, message => {
            if (!closed) endpoint.onmessage?.({data: message});
          });
          // Deprecated but functional compatibility only. A single callback
          // computes every sample AND its physical steps. No timer also drives
          // this engine. The larger block tolerates more main-thread jitter.
          const bufferSize = requested === 'default' ? 2048 : Math.max(256, requested);
          node = context.createScriptProcessor(bufferSize, 0, 2);
          channel = this.attach(endpoint, 'scriptprocessor', {node, context, processor, initialized: false, fallbackReason});
          node.onaudioprocess = event => {
            const buffer = event.outputBuffer, channels = [];
            for (let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
            if (closed || channel.closing || this.destroyed) { for (const data of channels) data.fill(0); return; }
            processor.process([], [channels]);
          };
          node.connect(context.destination);
        }
        await resume;
        this.assertCurrent(generation);
        this.bindAudioChannel(channel);
        this.pendingChannels.add(channel);
        return channel;
      } catch (error) {
        if (channel) this.closeChannel(channel);
        else { if (node) { try { node.disconnect(); node.port?.close(); } catch (_) {} } this.closeContext(context); }
        throw error;
      } finally { this.pendingContexts.delete(context); }
    }
    loadCompatibilityModule(url) { return import(url); }
    bindAudioChannel(channel) {
      const context = channel.context;
      channel.node.onprocessorerror = () => {
        if (this.channel !== channel || this.destroyed || channel.closing) return;
        this.broken = true; this.paused = true;
        this.audioIssue = {code: 'audio-processor-failed', message: 'Der Browser hat den Audio- und Physikkern angehalten.'};
        this.onError(this.audioIssue.message); this.status(this.audioIssue.message);
      };
      context.onstatechange = () => {
        if (this.channel !== channel || this.destroyed || channel.closing) return;
        this.clockCheck = null;
        if (context.state === 'running') {
          this.audioIssue = null;
          this.status('Audiotakt aktiv. Physik und Klang teilen dieselbe Zeitbasis.');
        } else if (context.state === 'closed') {
          this.broken = true;
          this.audioIssue = {code: 'audio-context-closed', message: 'Der Browser hat den Audiokontext geschlossen. Beim nächsten Start wird der zuletzt angezeigte Motorzustand wiederhergestellt.'};
          this.status(this.audioIssue.message);
        } else this.status('Der Browser hat den Audiotakt unterbrochen. Auch die Physik steht. Über „Fortsetzen“ oder „Motor starten“ erneut freigeben.');
      };
    }
    makeWorker() {
      if (typeof Worker === 'undefined') throw this.audioError('simulation-backends-unavailable', 'Auch ein Physik-Worker ist in diesem Browser nicht verfügbar.');
      const url = URL.createObjectURL(new Blob([sourceFor(this.coreSource, false)], { type: 'application/javascript' }));
      let worker;
      try { worker = new Worker(url); } finally { URL.revokeObjectURL(url); }
      return this.attach(worker, 'worker', { worker });
    }
    closeChannel(channel) {
      if (!channel || channel.closing) return;
      this.pendingChannels.delete(channel);
      channel.closing = true;
      for (const request of channel.requests.values()) { clearTimeout(request.timer); request.reject(new Error('Simulationskontext geschlossen.')); }
      channel.requests.clear();
      if (channel.node) {
        channel.node.onaudioprocess = null; channel.node.onprocessorerror = null;
        try { channel.node.disconnect(); } catch (_) {}
        try { channel.node.port?.close(); } catch (_) {}
      }
      if (channel.endpoint !== channel.node?.port) { try { channel.endpoint.close?.(); } catch (_) {} }
      channel.endpoint.onmessage = null;
      this.closeContext(channel.context);
      if (channel.worker) channel.worker.terminate();
    }
    async init(config, controls, options = {}) {
      this.paused = options.paused !== false;
      if (this.channel) return this.configure(config, controls, options);
      this.config = config; this.controls = { ...controls }; delete this.controls.starterSeconds; delete this.controls.gearRequest; this.destroyed = false;
      const generation = ++this.generation;
      this.configurationId++;
      this.recoveryState = null; this.commandJournal = [];
      const commandSequence = this.commandSequence;
      const initial = {paused:this.paused,rate:this.rate};
      // Preserve key-up and one-shot commands received while the browser is
      // preparing its execution context. Restore first, replay fresh input once.
      this.handoffQueue = [];
      this.preparing = true; this.audioIssue = null;
      this.status('Ton und Simulationskern werden vorbereitet.');
      let channel;
      try {
        try { channel = await this.prepareWorklet(); }
        catch (error) {
          this.assertCurrent(generation);
          this.audioIssue = this.issue(error);
          channel = this.makeWorker();
        }
        try { this.assertCurrent(generation); } catch (error) { this.closeChannel(channel); throw error; }
        this.pendingChannels.delete(channel);
        this.channel = channel; this.backend = channel.backend; this.context = channel.context || null;
        this.broken = false;
        await this.ask(channel, 'configure', { config, controls, serialized: options.serialized,
          paused: true, rate: initial.rate, commandSequence, configurationId: this.configurationId });
        this.assertCurrent(generation);
        channel.initialized = true;
        this.resumeHandoff(channel, initial);
        this.send('audio', { audio: this.audio });
        this.preparing = false;
        this.status(this.backend === 'worklet' ? 'Physik und Audio verwenden dieselbe Abtastuhr.' :
          this.backend === 'scriptprocessor' ? 'Kompatibler Audioausgang aktiv. Physik und Klang teilen denselben Takt.' :
          'Physik läuft stumm im Worker. ' + this.audioIssue.message);
      } catch (error) {
        this.closeChannel(channel);
        if (!this.destroyed && generation === this.generation) {
          this.handoffQueue = null; this.channel = null; this.context = null; this.backend = null;
          this.audioIssue = this.issue(error); this.preparing = false;
          this.onError(error.message); this.status(error.message);
        }
        throw error;
      } finally { if (generation === this.generation) this.preparing = false; }
      return this;
    }
    async configure(config, controls, options = {}) {
      if (this.enablingAudio) await this.enablingAudio;
      const generation = this.generation;
      this.assertCurrent(generation);
      this.config = config; this.controls = { ...controls }; delete this.controls.starterSeconds; delete this.controls.gearRequest; this.paused = options.paused !== false; this.clockCheck = null;
      if (this.broken || (this.context && this.context.state === 'closed')) {
        const old = this.channel;
        this.channel = null; this.context = null; this.backend = null; this.broken = false;
        this.closeChannel(old);
      }
      if (!this.channel) return this.init(config, controls, options);
      const initial = {paused:this.paused,rate:this.rate};
      // A live reconfiguration fades the outgoing sound before replacing the
      // engine. Inputs made during that interval belong to the replacement,
      // including key releases and one-shot gear/starter commands.
      this.handoffQueue = [];
      this.configurationId++;
      this.recoveryState = null; this.commandJournal = [];
      const sequence = this.commandSequence;
      this.reconfiguring++;
      try {
        if (this.context && this.context.state !== 'running') await this.resumeContext(this.context, generation);
        this.assertCurrent(generation);
        const result = await this.ask(this.channel, 'configure', { config, controls, serialized: options.serialized,
          paused: true, rate: initial.rate, commandSequence: sequence, configurationId: this.configurationId });
        this.assertCurrent(generation);
        this.channel.initialized = true;
        this.resumeHandoff(this.channel, initial);
        this.send('audio', { audio: this.audio });
        return result;
      } catch (error) {
        if (!this.destroyed && generation === this.generation && this.channel && !this.channel.closing) {
          this.resumeHandoff(this.channel, {paused:true,rate:this.rate});
        }
        throw error;
      } finally { this.reconfiguring--; }
    }
    setControls(patch) {
      Object.assign(this.controls, patch);
      // This is a one-shot command on the physical clock, not a persistent setting.
      // Reapplying cached controls during audio migration must not rearm the starter.
      delete this.controls.starterSeconds; delete this.controls.gearRequest;
      this.send('controls', { controls: patch });
    }
    setPaused(paused) {
      this.paused = !!paused; this.clockCheck = null;
      if (!this.paused && this.context && this.context.state !== 'running' && this.context.state !== 'closed') {
        const context = this.context, generation = this.generation;
        this.resumeContext(context, generation).catch(error => {
          if (this.destroyed || generation !== this.generation || context !== this.context) return;
          this.audioIssue = this.issue(error); this.status(error.message);
        });
      }
      this.send('paused', { paused: this.paused });
      this.status(this.paused ? 'Physik und Klang pausieren.' :
        this.context && this.context.state !== 'running' ? 'Audiotakt wird erneut freigegeben.' : 'Simulation läuft.');
    }
    setRate(rate) {
      if (![1, 0.25, 0.1, 0.02].includes(rate)) return;
      this.rate = rate; this.clockCheck = null; this.send('rate', { rate });
      this.status(rate === 1 ? 'Echtzeit mit Klang.' : 'Zeitlupe mit entsprechend verlangsamtem Klang.');
    }
    stepOnce() {
      if (!this.paused) return;
      // A tab switch suspends its AudioContext after the fade. A deliberate
      // single step needs the message loop again, but leaves the model paused.
      if (this.context && this.context.state !== 'running' && this.context.state !== 'closed') {
        const context = this.context, generation = this.generation;
        this.resumeContext(context, generation).catch(error => {
          if (this.destroyed || generation !== this.generation || context !== this.context) return;
          this.audioIssue = this.issue(error); this.status('Einzelschritt nicht verfügbar: ' + error.message);
        });
      }
      this.send('step', {});
    }
    setAudio(patch) {
      if (Object.hasOwn(patch,'muted')) this.audioRevision++;
      this.audio=MotorAcoustics.mergeAudio(this.audio,patch); this.send('audio', { audio: this.audio });
      this.status(this.audio.muted ? 'Ton stumm, Physik unverändert.' : 'Prozeduraler Klang.');
    }
    async setRenderSizeHint(value) {
      if (!['default', 128, 512, 1024, 2048].includes(value)) throw new Error('Ungültige Audiopuffergröße.');
      if (this.destroyed) throw new Error('Der Simulationskontext wurde geschlossen.');
      if (this.preparing || this.enablingAudio || this.reconfiguring)
        throw new Error('Der Audioausgang wird gerade vorbereitet. Bitte den laufenden Wechsel abwarten.');
      if (value === this.renderSizeHint) return true;
      const previous = this.renderSizeHint;
      this.renderSizeHint = value;
      if (!this.channel) { this.status(); return true; }
      // Render quantum is immutable for one AudioContext. Replace the transport
      // with an exact live handoff; never restart the engine or rewind to the
      // last periodic recovery snapshot merely to change the audio buffer.
      const changed = await this.enableAudio({recreate:true});
      if (!changed && !this.destroyed) { this.renderSizeHint = previous; this.status(); }
      return changed;
    }
    enableAudio(options = {}) {
      if (this.enablingAudio) return this.enablingAudio;
      const operation = this.activateAudio(options).finally(() => { if (this.enablingAudio === operation) this.enablingAudio = null; });
      this.enablingAudio = operation;
      return operation;
    }
    async activateAudio({recreate = false} = {}) {
      if (!this.channel || this.destroyed) return false;
      const generation = this.generation;
      const revision = this.audioRevision;
      const liveTransfer = recreate && this.audioAvailable;
      if (this.audioAvailable && !recreate) {
        try {
          await this.resumeContext(this.context, generation);
          this.assertCurrent(generation);
          this.audioIssue = null;
          if (this.audioRevision === revision) this.setAudio({ muted: false });
          else this.status('Audiotakt aktiv.');
          return !this.audio.muted;
        } catch (error) {
          if (!this.destroyed && generation === this.generation) { this.audioIssue = this.issue(error); this.status(error.message); }
          return false;
        }
      }
      // Silent fallback may migrate after a later user gesture. The old kernel is
      // frozen before serialisation and destroyed as soon as restore succeeds.
      const old = this.channel;
      const recovering = old.backend !== 'worker' && !liveTransfer;
      let replacement, handoff, frozenState, swapped = false;
      this.preparing = true;
      this.status(liveTransfer ? 'Audiopuffer wird mit aktuellem Motorzustand gewechselt.' :
        recovering ? 'Audioausgang und letzter angezeigter Motorzustand werden wiederhergestellt.' : 'Audioausgang wird vorbereitet.');
      try {
        replacement = await this.prepareWorklet();
        try { this.assertCurrent(generation); } catch (error) { this.closeChannel(replacement); throw error; }
        this.pendingChannels.add(replacement);
        if (recovering) {
          handoff = old.recovery || this.recoveryState;
          if (!handoff?.serialized) throw this.audioError('audio-recovery-state-missing', 'Es liegt kein bestätigter Motorzustand zur Wiederherstellung vor. Bitte die Konfiguration neu starten.');
          // Commands after the published checkpoint were not acknowledged by
          // that checkpoint. Replay them once, including starter/gear pulses.
          this.handoffQueue = this.commandJournal.filter(command => command.commandSequence > handoff.commandSequence);
        } else {
          if (old.context && old.context.state !== 'running') await this.resumeContext(old.context, generation);
          // Only a begun handoff requires rollback. A failed resume has not
          // frozen the model and must not overwrite newer pause/rate commands
          // with values captured before that asynchronous wait.
          frozenState = { paused: this.paused, rate: this.rate };
          this.handoffQueue = [];
          handoff = await this.ask(old, 'handoff', {});
          this.assertCurrent(generation);
        }
        await this.ask(replacement, 'configure', { config: handoff.config,
          serialized: handoff.serialized, paused: true, rate: handoff.rate,
          commandSequence: handoff.commandSequence, configurationId: this.configurationId });
        this.assertCurrent(generation);
        replacement.initialized = true;
        this.pendingChannels.delete(replacement);
        this.channel = replacement; this.backend = replacement.backend; this.context = replacement.context;
        this.broken = false; this.audioIssue = null; this.preparing = false; swapped = true;
        this.closeChannel(old);
        this.resumeHandoff(replacement, handoff);
        this.clockCheck = null;
        if (!recreate && this.audioRevision === revision) this.setAudio({ muted: false });
        else this.send('audio', {audio:this.audio});
        this.status(liveTransfer ? 'Audiopuffer gewechselt. Der Motor läuft mit seinem aktuellen Zustand weiter.' :
          recovering ? 'Audioausgang aktiv. Der zuletzt angezeigte Motorzustand wurde wiederhergestellt.' :
          this.backend === 'scriptprocessor' ? 'Kompatibler Audioausgang aktiv. Ein gemeinsamer Takt für Physik und Klang.' : 'Audioausgang aktiv.');
        return recreate || !this.audio.muted;
      } catch (error) {
        if (!swapped) this.closeChannel(replacement);
        if (this.destroyed || generation !== this.generation) return false;
        if (!swapped) {
          this.channel = old; this.backend = old.backend; this.context = old.context || null;
          if (!recovering && frozenState) this.resumeHandoff(old, handoff || frozenState);
          else this.handoffQueue = null;
        }
        this.preparing = false; this.audioIssue = this.issue(error);
        this.status((liveTransfer ? 'Audiopuffer konnte nicht gewechselt werden. Der bisherige Ausgang bleibt aktiv. ' :
          old.backend === 'worker' ? 'Physik läuft weiter stumm. ' : 'Audioausgang konnte nicht wiederhergestellt werden. ') + error.message);
        return false;
      } finally { if (generation === this.generation) this.preparing = false; }
    }
    async freeze(released = {throttle:0,clutch:0,brake:0,starter:false,reverseUnlock:false}) {
      // Stop the current authority immediately, including while a replacement
      // audio context is still being prepared. A queued handoff replays this
      // pause and release atomically before allowing the new authority to run.
      this.paused = true; this.clockCheck = null;
      Object.assign(this.controls, released);
      this.send('paused', {paused:true});
      this.send('controls', {controls:released});
      if (this.enablingAudio) await this.enablingAudio;
      if (this.destroyed) return;
      const generation = this.generation;
      this.paused = true; this.clockCheck = null;
      if (!this.channel) return;
      if (this.context && this.context.state !== 'running') { this.channel.endpoint.postMessage({ type: 'freeze', controls: released }); return; }
      await this.ask(this.channel, 'freeze', { controls: released });
      const context = this.context;
      if (context && context.state === 'running') {
        await new Promise(resolve => setTimeout(resolve, 75));
        if (this.destroyed || generation !== this.generation) return;
        if (this.paused && context === this.context && context.state === 'running') {
          await this.boundedWait(context.suspend(), this.audioTimeoutMs, 'audio-suspend-timeout', 'Der Browser hat die Audiopause nicht bestätigt.', generation);
        }
      }
      this.status('Simulation pausiert');
    }
    destroy() {
      this.destroyed = true; this.generation++;
      for (const cancel of [...this.waiters]) cancel();
      for (const context of this.pendingContexts) this.closeContext(context);
      this.pendingContexts.clear();
      for (const channel of [...this.pendingChannels]) this.closeChannel(channel);
      this.pendingChannels.clear();
      this.closeChannel(this.channel); this.channel = null; this.context = null; this.backend = null;
      this.handoffQueue = null; this.commandJournal = []; this.recoveryState = null; this.preparing = false;
    }
  };
})();
