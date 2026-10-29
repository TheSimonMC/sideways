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

