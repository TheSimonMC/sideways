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

