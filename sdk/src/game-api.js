/* Additive game integration. Loading this wrapper leaves previously loaded
   EngineCore, VehicleCore and SimulationDriver instances and prototypes alone. */
const MotorLab = (() => {
  'use strict';
  const DT = EngineCore.constants.DT;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const copy = value => JSON.parse(JSON.stringify(value));
  const rates = [1, .25, .1, .02];
  const audioKeys = ['master', 'exhaust', 'intake', 'combustion', 'valve', 'bearing', 'boost', 'manifold', 'mechanical', 'gearbox', 'chain', 'bite'];
  const audioSources = ['exhaust', 'intake', 'combustion', 'valve', 'bearing', 'boost', 'manifold', 'mechanical', 'gearbox', 'chain'];
  const layerDistortion = {exhaust: .55, intake: .15, combustion: .20, valve: .08, bearing: 0, boost: .08, manifold: .45, mechanical: .18, gearbox: .10, chain: .12};
  const defaultAudio = () => ({master: .6, exhaust: .64, intake: .38, combustion: .42, valve: .28, bearing: .12, boost: .65,
    manifold: .32, mechanical: .28, gearbox: .24, chain: .18, bite: .6, muted: false,
    layers: Object.fromEntries(audioSources.map(key => [key, {enabled: true, solo: false, preGain: 1, distortion: layerDistortion[key]}])),
    listener: {mode: 'outside', distance: 1.5, azimuth: 90, reflections: .12}});
  const basePresets = ['two', 'single4', 'twin', 'i4', 'diesel', 'turbo', 'supercharger', 'turbodiesel'];
  const modelPresets = ['hellcat', 'bestia50', 'f1v12', 'renesis', 'v8-12l', 'r3-turbo-660', 'boxer6-38', 'rotary4-race',
    'bmw-m3-e46-2002-us', 'bmw-m5-e39-2003-us', 'bmw-330i-e46-2001-us',
    'ford-mustang-boss302-1969', 'chevrolet-camaro-z28-1969'];
  const familyPresets = ['inline3', 'inline5', 'inline6', 'inline8', 'inline12', 'inline16',
    'v2', 'v4', 'v6', 'v8', 'v10', 'v12', 'v16', 'boxer2', 'boxer4', 'boxer6', 'boxer8', 'boxer12', 'boxer16',
    'w4', 'w8', 'w12', 'w16', 'radial5', 'radial7', 'radial9', 'two2', 'two3', 'two4', 'two8', 'two16',
    'rotary1', 'rotary2', 'rotary3', 'rotary4', 'kerosene', 'v8diesel',
    'fuel-ethanol', 'fuel-methanol', 'fuel-lpg', 'fuel-cng', 'fuel-hydrogen'];

  function finite(value, label, lo = -Infinity, hi = Infinity) {
    if (!Number.isFinite(value) || value < lo || value > hi) throw new Error(label + ': ungültiger Wert.');
    return value;
  }
  function json(value, label = 'Daten', depth = 0) {
    if (depth > 100) throw new Error(label + ': zu tief verschachtelt.');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return finite(value, label);
    if (!value || typeof value !== 'object' || !['[object Object]', '[object Array]'].includes(Object.prototype.toString.call(value)))
      throw new Error(label + ': reine JSON-Daten erforderlich.');
    const result = Array.isArray(value) ? [] : {};
    for (const key of Object.keys(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error(label + ': ungültiger Schlüssel.');
      const desc = Object.getOwnPropertyDescriptor(value, key);
      if (!desc || !own(desc, 'value')) throw new Error(label + ': Getter sind nicht erlaubt.');
      result[key] = json(desc.value, label, depth + 1);
    }
    return result;
  }
  function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label + ': Objekt erforderlich.');
    return value;
  }
  function presetConfig(id) {
    if (typeof id !== 'string') throw new Error('preset: Name erforderlich.');
    if (basePresets.includes(id) || modelPresets.includes(id)) return EngineCore.defaults(id);
    if (id === 'rotary' || id === 'wankel') return EngineCore.defaults(id);
    if (id === 'kerosene') return EngineCore.familyDefaults({fuelType: 'kerosene', boost: 'turbo'});
    if (id === 'v8diesel') return EngineCore.familyDefaults({layout: 'v', cylinderCount: 8, combustion: 'diesel', fuelType: 'diesel', boost: 'turbo'});
    const fuel = /^fuel-(ethanol|methanol|lpg|cng|hydrogen)$/.exec(id);
    if (fuel) return EngineCore.familyDefaults({fuelType: fuel[1]});
    const rotary = /^(rotary|wankel)([1-4])$/.exec(id);
    if (rotary) return EngineCore.familyDefaults({kind: 'rotary', rotorCount: Number(rotary[2])});
    const family = /^(inline|v|boxer|w|radial|two)(\d+)$/.exec(id);
    if (family) {
      const layout = family[1] === 'two' ? 'inline' : family[1];
      const kind = family[1] === 'two' ? 'two' : 'four', cylinderCount = Number(family[2]);
      if (EngineCore.layoutCounts(kind, layout).includes(cylinderCount))
        return EngineCore.familyDefaults({kind, layout, cylinderCount});
    }
    throw new Error('Unbekanntes Motor-Preset: ' + id + '. MotorLab.presets() zeigt die Namen.');
  }
  function optionsFor(value) {
    if (value === undefined) return {preset: 'i4'};
    if (typeof value === 'string') return {preset: value};
    return object(json(value, 'Optionen'), 'Optionen');
  }
  function makeModel(kind, options) {
    let config;
    if (options.configuration !== undefined) config = options.configuration;
    else if (options.coreState !== undefined)
      config = kind === 'vehicle' ? options.coreState.configuration : options.coreState.config;
    else {
      let engine = options.family ? EngineCore.familyDefaults(options.family) : presetConfig(options.preset ?? 'i4');
      if (options.displacementCc !== undefined) engine = EngineCore.sizeForDisplacement(engine,
        finite(options.displacementCc, 'displacementCc', Number.MIN_VALUE) / 1e6);
      if (options.overrides !== undefined) engine = {...engine, ...object(options.overrides, 'overrides')};
      config = kind === 'vehicle' ? {engine, drivetrain: VehicleCore.defaults(engine)} : engine;
    }
    object(config, 'Konfiguration');
    const model = kind === 'vehicle' ? new VehicleCore.Simulation(config, {dt: DT}) : new EngineCore.Engine(config, {dt: DT});
    if (options.coreState !== undefined) restoreLegacy(model, kind, options.coreState);
    return model;
  }
  function restoreLegacy(model, kind, state) {
    object(state, 'coreState');
    const engine = kind === 'vehicle' ? model.engine : model;
    const engineState = kind === 'vehicle' ? state.engine : state;
    object(engineState, 'Motorzustand');
    const engineKeys = new Set([...Object.keys(engine.serialize()), '_compressorWork', '_turbineWork',
      '_compressorInertance', '_compressorMap', '_compressorNextFlow', '_compressorOldFlow',
      '_compressorRho', '_compressorRotorWork', '_compressorTransportFlow']);
    for (const key of Object.keys(engineState)) if (!engineKeys.has(key)) throw new Error('Unbekanntes Motorzustandsfeld: ' + key + '.');
    if (kind === 'vehicle') {
      const vehicleKeys = new Set(Object.keys(model.serialize()));
      for (const key of Object.keys(state)) if (!vehicleKeys.has(key)) throw new Error('Unbekanntes Fahrzeugzustandsfeld: ' + key + '.');
    }
    for (const s of kind === 'vehicle' ? [state, engineState] : [state])
      if (s.dt !== undefined && s.dt !== DT) throw new Error('Dieser Spieladapter benötigt den Standardschritt 1/24000 s. Andere Schritte bleiben über MotorLab.legacy verfügbar.');
    model.restore(state);
  }
  function validateAudio(patch, previous) {
    object(patch, 'Audio');
    const next = copy(previous);
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'muted') { if (typeof value !== 'boolean') throw new Error('muted: Wahrheitswert erforderlich.'); next.muted = value; }
      else if (audioKeys.includes(key)) next[key] = finite(value, key, 0, 1);
      else if (key === 'layers') {
        for (const [source, settings] of Object.entries(object(value, 'Klang-Layer'))) {
          if (!audioSources.includes(source)) throw new Error('Unbekannter Klang-Layer: ' + source + '.');
          for (const [field, entry] of Object.entries(object(settings, 'Klang-Layer ' + source))) {
            if (field === 'enabled' || field === 'solo') {
              if (typeof entry !== 'boolean') throw new Error(field + ': Wahrheitswert erforderlich.');
            } else if (field === 'preGain' || field === 'distortion') finite(entry, field, 0, field === 'preGain' ? 4 : 1);
            else throw new Error('Unbekannter Layer-Regler: ' + field + '.');
            next.layers[source][field] = entry;
          }
        }
      } else if (key === 'listener') {
        for (const [field, entry] of Object.entries(object(value, 'Hörperspektive'))) {
          if (field === 'mode') {
            if (!['direct', 'outside', 'engine', 'cabin'].includes(entry)) throw new Error('Ungültige Hörperspektive.');
          } else if (field === 'distance') finite(entry, field, .5, 20);
          else if (field === 'azimuth') finite(entry, field, -180, 180);
          else if (field === 'reflections') finite(entry, field, 0, 1);
          else if (field === 'scene') {next.listener.scene=SimulationDriver.audioModules().Listener.validateScene(entry);continue;}
          else throw new Error('Unbekannter Hörregler: ' + field + '.');
          next.listener[field] = entry;
        }
      } else throw new Error('Unbekannter Audioregler: ' + key + '.');
    }
    return next;
  }

  class Session {
    constructor(kind, value) {
      const options = optionsFor(value);
      this.kind = kind;
      this._model = makeModel(kind, options);
      this._maxSteps = options.maxStepsPerUpdate ?? 2400;
      this._checkMaxSteps(this._maxSteps);
      this._paused = false;
      this._rate = 1;
      this._pending = this._accepted = this._discarded = this._steps = 0;
      this._externalTorque = 0;
      this._last = {acceptedSeconds: 0, simulatedSeconds: 0, steps: 0};
      this._clock = 'manual';
      this._disposed = false;
      this._epoch = 0;
      this._connecting = this._connectPromise = this._connection = null;
      this._synth = null;
      this._audioDebt = this._sampleRate = this._fade = this._gate = 0;
      this._resampleL = [0, 0, 0, 0]; this._resampleR = [0, 0, 0, 0];
      this._audio = defaultAudio();
      this._meter = {rms: 0, peak: 0, frames: 0};
      this._acousticMeter = null;
      this._audioError = null;
    }
    _alive() { if (this._disposed) throw new Error('Diese Sitzung wurde mit dispose() geschlossen.'); }
    _manual() {
      this._alive();
      if (this._clock !== 'manual' || this._connecting) throw new Error('Audio besitzt den Simulationstakt. Nur setInputs()/getState() verwenden oder zuerst disconnectAudio() aufrufen.');
    }
    _checkMaxSteps(n) { if (!Number.isInteger(n) || n < 1 || n > 240000) throw new Error('maxStepsPerUpdate: ganze Zahl von 1 bis 240000 erforderlich.'); }
    _engine() { return this.kind === 'vehicle' ? this._model.engine : this._model; }
    _step() {
      this._model.step(DT);
      if (this._externalTorque) this._engine().applyShaftImpulse(this._externalTorque * DT);
      this._steps++;
      if (this._synth) this._synth.capture(this._engine().signal);
    }
    _drain(maxSteps) {
      let steps = 0;
      while (steps < maxSteps && this._pending >= DT - 1e-14) {
        this._step();
        this._pending = Math.max(0, this._pending - DT);
        steps++;
      }
      return steps;
    }
    start({starterSeconds = 1.5} = {}) {
      this._alive();
      this._model.setControls({fuel: true, ignition: true, starter: true, starterSeconds});
      this._paused = false;
      return this;
    }
    stop() { this._alive(); this._model.setControls({fuel: false, ignition: false, starter: false}); return this; }
    pause(paused = true) {
      this._alive();
      if (typeof paused !== 'boolean') throw new Error('pause: Wahrheitswert erforderlich.');
      this._paused = paused; return this;
    }
    setInputs(values) {
      this._alive();
      const patch = object(json(values, 'Bedienwerte'), 'Bedienwerte');
      for (const [alias, original] of [['loadNm', 'load'], ['gear', 'gearRequest']]) if (own(patch, alias)) {
        if (own(patch, original)) throw new Error(alias + ' und ' + original + ' dürfen nicht gemeinsam gesetzt werden.');
        patch[original] = patch[alias]; delete patch[alias];
      }
      const external = own(patch, 'externalTorqueNm') ? finite(patch.externalTorqueNm, 'externalTorqueNm', -100000, 100000) : this._externalTorque;
      if (own(patch, 'externalTorqueNm') && this.kind !== 'engine') throw new Error('externalTorqueNm gehört zum Motor mit eigener Spielphysik; createVehicle() besitzt bereits den Antriebsstrang.');
      delete patch.externalTorqueNm;
      this._model.setControls(patch);
      this._externalTorque = external;
      return this;
    }
    applyShaftImpulse(impulseNmSeconds) {
      this._alive();
      if (this.kind !== 'engine') throw new Error('Ein externer Wellenimpuls ist nur mit createEngine() möglich.');
      finite(impulseNmSeconds, 'impulseNmSeconds');
      const result = this._engine().applyShaftImpulse(impulseNmSeconds);
      if (this._synth) this._synth.capture(this._engine().signal);
      return result;
    }
    setRate(rate) { this._alive(); if (!rates.includes(rate)) throw new Error('rate: 1, 0.25, 0.1 oder 0.02 erforderlich.'); this._rate = rate; return this; }
    setVolume(volume) { return this.setAudio({master: volume}); }
    setAudio(patch) { this._alive(); this._audio = validateAudio(json(patch, 'Audio'), this._audio); this._synth?.setAudio(this._audio); return this; }
    update(deltaSeconds, {maxSteps = this._maxSteps} = {}) {
      this._manual(); finite(deltaSeconds, 'deltaSeconds', 0); this._checkMaxSteps(maxSteps);
      const accepted = this._paused ? 0 : deltaSeconds * this._rate;
      const pending = this._pending + accepted;
      if (!Number.isFinite(pending) || pending / DT > Number.MAX_SAFE_INTEGER) throw new Error('Zeitüberschuss ist nicht mehr präzise darstellbar.');
      this._pending = pending; this._accepted += accepted;
      const steps = this._paused ? 0 : this._drain(maxSteps);
      this._last = {acceptedSeconds: accepted, simulatedSeconds: steps * DT, steps};
      return this.getState();
    }
    getTiming() {
      return {clock: this._disposed ? 'disposed' : this._connecting ? 'connecting-audio' : this._clock,
        paused: this._paused, rate: this._rate, stepSeconds: DT, maxStepsPerUpdate: this._maxSteps,
        pendingSeconds: this._pending + (this._sampleRate ? this._audioDebt / this._sampleRate : 0),
        simulatedSeconds: this._steps * DT, acceptedSeconds: this._accepted, discardedSeconds: this._discarded,
        totalSteps: this._steps, lastUpdate: {...this._last}};
    }
    getState() {
      this._alive();
      const state = copy(this._model.snapshot());
      return {...state, kind: this.kind, shaftAngularVelocityRadPerSec: state.omega,
        speedMps: this.kind === 'vehicle' ? state.drive.v : null,
        speedKph: this.kind === 'vehicle' ? state.drive.v * 3.6 : null,
        timing: this.getTiming(), audio: this.getAudioStatus()};
    }
    getAudioStatus() {
      const c = this._connection;
      return {connected: !!c, backend: c ? 'script-processor' : this._clock === 'pcm' ? 'pcm' : 'none',
        contextState: c ? c.context.state : this._connecting ? this._connecting.context.state : null,
        sampleRate: this._sampleRate || null, bufferSize: c?.bufferSize ?? null,
        volume: this._audio.master, muted: this._audio.muted, meter: {...this._meter},
        ...(this._acousticMeter ? copy(this._acousticMeter) : {}), error: this._audioError};
    }
    discardPendingTime() {
      this._manual();
      const discarded = this._pending;
      this._discarded += discarded; this._pending = 0;
      return discarded;
    }
    save() {
      this._alive();
      return {format: 'MotorLab.Session', version: 1, kind: this.kind, coreState: this._model.serialize(),
        timing: {...this.getTiming(), clock: 'manual'}, externalTorqueNm: this._externalTorque,
        audio: copy(this._audio)};
    }
    load(document) {
      this._manual();
      const state = object(json(document, 'Spielstand'), 'Spielstand');
      if (state.format !== 'MotorLab.Session' || state.version !== 1 || state.kind !== this.kind) throw new Error('Spielstandformat oder Sitzungsart passt nicht.');
      const timing = object(state.timing, 'Spielstandzeit');
      this._checkMaxSteps(timing.maxStepsPerUpdate);
      if (timing.stepSeconds !== DT || !rates.includes(timing.rate) || typeof timing.paused !== 'boolean') throw new Error('Ungültiger Simulationstakt im Spielstand.');
      for (const key of ['pendingSeconds', 'acceptedSeconds', 'discardedSeconds']) finite(timing[key], key, 0);
      if (!Number.isSafeInteger(timing.totalSteps) || timing.totalSteps < 0) throw new Error('Ungültige Schrittzahl.');
      if (timing.pendingSeconds / DT > Number.MAX_SAFE_INTEGER) throw new Error('Gesicherter Zeitüberschuss ist nicht präzise darstellbar.');
      const last = object(timing.lastUpdate, 'Letzter Zeitschritt');
      finite(last.acceptedSeconds, 'lastUpdate.acceptedSeconds', 0);
      finite(last.simulatedSeconds, 'lastUpdate.simulatedSeconds', 0);
      if (!Number.isSafeInteger(last.steps) || last.steps < 0) throw new Error('Ungültige letzte Schrittzahl.');
      const external = finite(state.externalTorqueNm, 'externalTorqueNm', -100000, 100000);
      if (this.kind === 'vehicle' && external !== 0) throw new Error('Fahrzeugspielstand enthält ein externes Motormoment.');
      // Missing optional source gains in older saves receive the same defaults
      // on a fresh session and on an already configured session.
      const audio = validateAudio(state.audio, defaultAudio());
      const candidate = makeModel(this.kind, {coreState: state.coreState});
      this._model = candidate; this._maxSteps = timing.maxStepsPerUpdate;
      this._paused = timing.paused; this._rate = timing.rate;
      this._pending = timing.pendingSeconds; this._accepted = timing.acceptedSeconds;
      this._discarded = timing.discardedSeconds; this._steps = timing.totalSteps;
      this._externalTorque = external; this._audio = audio;
      this._last = {acceptedSeconds: last.acceptedSeconds, simulatedSeconds: last.simulatedSeconds, steps: last.steps};
      this._clearAcoustics();
      return this;
    }
    loadCoreState(coreState) {
      this._manual();
      const candidate = makeModel(this.kind, {coreState: json(coreState, 'coreState')});
      this._model = candidate; this._pending = this._accepted = this._discarded = this._steps = 0;
      this._externalTorque = 0;
      this._last = {acceptedSeconds: 0, simulatedSeconds: 0, steps: 0};
      this._clearAcoustics();
      return this;
    }
    reset() {
      this._manual();
      this._model = makeModel(this.kind, {configuration: copy(this._model.config)});
      this._pending = this._accepted = this._discarded = this._steps = 0; this._externalTorque = 0;
      this._last = {acceptedSeconds: 0, simulatedSeconds: 0, steps: 0};
      this._paused = false; this._clearAcoustics(); return this;
    }
    _clearAcoustics() {
      this._synth = null; this._sampleRate = this._audioDebt = this._fade = this._gate = 0;
      this._resampleL.fill(0); this._resampleR.fill(0); this._meter = {rms: 0, peak: 0, frames: 0}; this._acousticMeter = null; this._audioError = null;
    }
    _claimAudio(sampleRate, clock) {
      finite(sampleRate, 'sampleRate', 32000, 192000);
      if (this._clock === 'manual') {
        if (this._pending >= DT - 1e-14) throw new Error('Vor Audio noch ausstehende Zeit mit update(0) abarbeiten oder bewusst discardPendingTime() verwenden.');
        this._clock = clock;
      } else if (this._clock !== clock) throw new Error('Der Simulationstakt hat bereits einen anderen Besitzer.');
      if (this._synth && this._sampleRate !== sampleRate) throw new Error('Samplerate erst nach disconnectAudio() ändern.');
      if (!this._synth) {
        const Acoustic = SimulationDriver.acousticsClass();
        this._synth = new Acoustic(sampleRate, this._engine().config);
        this._sampleRate = sampleRate;
        this._synth.setAudio(this._audio); this._synth.capture(this._engine().signal);
      }
    }
    renderAudio(left, right, {sampleRate = 48000} = {}) {
      this._alive();
      if (this._connecting || this._connection) throw new Error('connectAudio() rendert bereits. Keine zweite PCM-Uhr starten.');
      return this._renderAudio(left, right, sampleRate, 'pcm');
    }
    _renderAudio(left, right, sampleRate, clock) {
      if (Object.prototype.toString.call(left) !== '[object Float32Array]' || Object.prototype.toString.call(right) !== '[object Float32Array]' || left.length !== right.length || left === right)
        throw new Error('Zwei getrennte Float32Array-Kanäle derselben Länge erforderlich.');
      this._claimAudio(sampleRate, clock);
      let squares = 0, peak = 0; const before = this._steps;
      const accepted = this._paused ? 0 : left.length * this._rate / sampleRate;
      this._accepted += accepted;
      for (let i = 0; i < left.length; i++) {
        const running = !this._paused, rate = running ? this._rate : 1;
        if (this._synth.playbackRate !== rate) this._synth.setPlaybackRate(rate);
        this._fade = running ? Math.min(1, this._fade + 1 / (sampleRate * .02)) : Math.max(0, this._fade - 1 / (sampleRate * .015));
        this._audioDebt += rate;
        while (this._audioDebt >= 1 - 1e-12) {
          this._audioDebt = Math.max(0, this._audioDebt - 1);
          if (running) { this._pending += 1 / sampleRate; this._drain(32); }
          this._synth.sample(Math.max(0, Math.min(1, this._pending / DT)), running, this._fade);
          for (let j = 0; j < 3; j++) { this._resampleL[j] = this._resampleL[j + 1]; this._resampleR[j] = this._resampleR[j + 1]; }
          this._resampleL[3] = this._synth.outputL; this._resampleR[3] = this._synth.outputR;
        }
        const f = this._audioDebt;
        const audible = running && !this._audio.muted && this._audio.master > 0;
        this._gate = audible ? Math.min(1, this._gate + 1 / (sampleRate * .02)) : Math.max(0, this._gate - 1 / (sampleRate * .015));
        const a = this._resampleL, b = this._resampleR;
        let l, r;
        // Match the sandbox transport: unity rate needs a delay, not a second
        // smoothing pass over the already reconstructed physical pressure.
        if (rate === 1) {
          l = a[1] + (a[2] - a[1]) * f;
          r = b[1] + (b[2] - b[1]) * f;
        } else if (f === 0) {
          l = a[0] / 6 + (2 / 3) * a[1] + a[2] / 6;
          r = b[0] / 6 + (2 / 3) * b[1] + b[2] / 6;
        } else {
          const f2 = f * f, f3 = f2 * f, g = 1 - f;
          const w0 = g * g * g / 6, w1 = (3 * f3 - 6 * f2 + 4) / 6;
          const w2 = (-3 * f3 + 3 * f2 + 3 * f + 1) / 6, w3 = f3 / 6;
          l = w0 * a[0] + w1 * a[1] + w2 * a[2] + w3 * a[3];
          r = w0 * b[0] + w1 * b[1] + w2 * b[2] + w3 * b[3];
        }
        left[i] = Math.fround(l * this._fade * this._gate); right[i] = Math.fround(r * this._fade * this._gate);
        squares += (left[i] * left[i] + right[i] * right[i]) / 2;
        peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
      }
      this._meter = {rms: left.length ? Math.sqrt(squares / left.length) : 0, peak, frames: left.length};
      // Take the resetting source-window reading exactly once per rendered
      // block. Public status reads only detached snapshots of that reading.
      // Output headroom still comes from the actual resampled Float32 block.
      if (left.length && typeof this._synth.meter === 'function') {
        const measured = this._synth.meter();
        this._acousticMeter = {sourceWindowSeconds: measured.windowSeconds, sources: measured.sources};
        if (measured.layers) this._acousticMeter.layers = measured.layers;
        if (measured.mix) this._acousticMeter.mix = {...measured.mix};
      }
      if (this._acousticMeter?.mix) this._acousticMeter.mix.headroomDb = peak > 1e-6 ? -20 * Math.log10(peak) : 120;
      this._last = {acceptedSeconds: accepted, simulatedSeconds: (this._steps - before) * DT, steps: this._steps - before};
      return this.getAudioStatus();
    }
    connectAudio(options = {}) {
      this._alive();
      if (this._connectPromise) return this._connectPromise;
      if (this._connection) {
        const current = this._connection, timeoutMs = options.timeoutMs ?? 3000;
        if (current.context.state === 'running') return Promise.resolve(this.getAudioStatus());
        if (current.context.state === 'closed') return Promise.reject(new Error('Der Audiokontext wurde geschlossen. Zuerst disconnectAudio(), danach connectAudio() aus einem Klick aufrufen.'));
        finite(timeoutMs, 'timeoutMs', 1, 30000);
        let resumed;
        try { resumed = current.context.resume(); } catch (error) { resumed = Promise.reject(error); }
        const work = (async () => {
          let timer;
          try {
            await Promise.race([Promise.resolve(resumed), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Audiofreigabe dauert zu lange.')), timeoutMs); })]);
            if (this._disposed || current.epoch !== this._epoch || this._connection !== current) throw new Error('Audioverbindung wurde abgebrochen.');
            if (current.context.state !== 'running') throw new Error('Audio bleibt gesperrt. Freigabe aus einem Klick erneut versuchen.');
            this._audioError = null;
            return this.getAudioStatus();
          } finally { clearTimeout(timer); if (current.epoch === this._epoch) this._connectPromise = null; }
        })();
        this._connectPromise = work;
        return work;
      }
      if (this._clock !== 'manual') return Promise.reject(new Error('Vor connectAudio() zuerst den PCM-Takt mit disconnectAudio() freigeben.'));
      if (this._pending >= DT - 1e-14) return Promise.reject(new Error('Vor Audio noch ausstehende Zeit mit update(0) abarbeiten.'));
      const bufferSize = options.bufferSize ?? 1024, timeoutMs = options.timeoutMs ?? 3000;
      if (![256, 512, 1024, 2048, 4096, 8192, 16384].includes(bufferSize)) return Promise.reject(new Error('Ungültige Audiopuffergröße.'));
      finite(timeoutMs, 'timeoutMs', 1, 30000);
      const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
      let context;
      try { context = options.context || (Ctor && new Ctor({latencyHint: 'interactive'})); }
      catch (error) { return Promise.reject(error); }
      if (!context) return Promise.reject(new Error('Dieser Browser bietet keinen Web-Audio-Kontext. Die Simulation bleibt über update() nutzbar.'));
      const pending = {context, owned: !options.context, node: null, bufferSize, epoch: ++this._epoch};
      this._connecting = pending;
      let resumed;
      try { resumed = context.resume(); } catch (error) { resumed = Promise.reject(error); }
      // resume() is deliberately called before the first await, in the user's gesture.
      const work = (async () => {
        let timer;
        try {
          await Promise.race([Promise.resolve(resumed), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Audiofreigabe dauert zu lange. Erneut aus einem Klick starten.')), timeoutMs); })]);
          if (this._disposed || this._epoch !== pending.epoch) throw new Error('Audioverbindung wurde abgebrochen.');
          if (context.state !== 'running') throw new Error('Audio ist noch gesperrt. connectAudio() direkt aus einem Klick aufrufen.');
          if (typeof context.createScriptProcessor !== 'function') throw new Error('Dieser Browser stellt den einfachen Audiotransport nicht bereit. renderAudio() kann in einen eigenen Transport eingebunden werden.');
          const node = context.createScriptProcessor(bufferSize, 0, 2);
          pending.node = node;
          this._claimAudio(context.sampleRate, 'browser');
          node.onaudioprocess = event => {
            const left = event.outputBuffer.getChannelData(0), right = event.outputBuffer.getChannelData(1);
            if (this._disposed || this._epoch !== pending.epoch || this._audioError) { left.fill(0); right.fill(0); return; }
            try { this._renderAudio(left, right, context.sampleRate, 'browser'); }
            catch (error) { left.fill(0); right.fill(0); this._audioError = String(error.message || error); this._paused = true; }
          };
          node.connect(options.destination || context.destination);
          this._audioError = null;
          this._connection = pending; this._connecting = null;
          return this.getAudioStatus();
        } catch (error) {
          this._closeTransport(pending);
          if (this._epoch === pending.epoch) {
            this._connecting = null; this._connection = null;
            this._releaseAudioClock(); this._audioError = String(error.message || error);
          }
          throw error;
        } finally {
          clearTimeout(timer);
          if (this._epoch === pending.epoch) this._connectPromise = null;
        }
      })();
      this._connectPromise = work;
      return work;
    }
    enableAudio(options) { return this.connectAudio(options); }
    _closeTransport(transport) {
      if (!transport || transport.closed) return Promise.resolve();
      transport.closed = true;
      if (transport.node) { transport.node.onaudioprocess = null; try { transport.node.disconnect(); } catch (_) {} }
      if (transport.owned && typeof transport.context.close === 'function') {
        try { return Promise.resolve(transport.context.close()).catch(() => {}); } catch (_) {}
      }
      return Promise.resolve();
    }
    _releaseAudioClock() {
      if (this._sampleRate) this._pending += this._audioDebt / this._sampleRate;
      this._clock = 'manual'; this._clearAcoustics();
    }
    disconnectAudio() {
      ++this._epoch;
      const connection = this._connection, pending = this._connecting;
      this._connection = this._connecting = this._connectPromise = null;
      this._releaseAudioClock();
      return Promise.all([this._closeTransport(connection), this._closeTransport(pending)]).then(() => this.getAudioStatus());
    }
    dispose() { if (this._disposed) return Promise.resolve(); this._disposed = true; return this.disconnectAudio().then(() => undefined); }
  }
  function fromState(document) {
    const state = object(json(document, 'Spielstand'), 'Spielstand');
    if (!['engine', 'vehicle'].includes(state.kind)) throw new Error('Unbekannte Sitzungsart.');
    const session = new Session(state.kind, {coreState: state.coreState});
    return session.load(state);
  }
  return Object.freeze({version: '1.6.3', physicsRelease: 14, audioRelease: 14, stepSeconds: DT,
    audioModules: () => SimulationDriver.audioModules(),
    createEngine: options => new Session('engine', options), createVehicle: options => new Session('vehicle', options),
    fromState, presets: () => [...basePresets, ...modelPresets, ...familyPresets],
    legacy: Object.freeze({EngineCore, VehicleCore, SimulationDriver})});
})();
