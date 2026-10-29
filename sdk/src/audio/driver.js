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
