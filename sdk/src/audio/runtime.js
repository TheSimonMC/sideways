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

