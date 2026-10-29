/* Fahrzeuglabor: straight-line vehicle, dry clutch and synchronized manual gearbox.
   All state advances in simulated time. SI units; clutch pedal 1 means open.
   The engine receives only balanced shaft impulses, never a prescribed RPM. */
const VehicleCore = (() => {
  'use strict';
  const Math=globalThis.Math,Number=globalThis.Number;
  const DT = 1 / 24000, G = 9.80665, DEG = Math.PI / 180;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const copy = x => JSON.parse(JSON.stringify(x));
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const DRIVER_KEYS = new Set(['clutch', 'brake', 'parking', 'reverseUnlock', 'gearRequest']);
  const controlDefaults = () => ({clutch: 1, brake: 0, parking: true, reverseUnlock: false});

  // These are complete vehicle selections, keyed by the deliberately retained
  // engine modelId. Family/custom engines below remain declared examples. A
  // displacement edit clears modelId in EngineCore and therefore cannot keep a
  // manufacturer's driveline accidentally. Mass includes a 75 kg driver/rider.
  const VEHICLE_PROFILES = {
    'bestia50': {
      // OEM mass, rear tire and 62-tooth rear sprocket; primary ratio, gear
      // pairs and 11-tooth front sprocket are an explicit reference setup.
      mass:112+75,wheelRadius:.3069,primaryDrive:3.55,
      gears:[3,33/16,29/19,27/22,25/24,24/25],finalDrive:62/11,
      reverseRatio:3,reverseEnabled:false,clutchCapacity:42,
      gearboxInertia:.00055,gearboxDrag:.00012,synchronizerTorque:1.6,
      efficiency:.94,dragArea:.48,rollingResistance:.015,
      brakeForce:1800,parkingForce:1400,shiftTime:.08,clutchShiftEngageTime:.12
    },
    'hellcat': {
      mass:2018+75,wheelRadius:1000/(448*2*Math.PI),primaryDrive:1,
      gears:[2.26,1.58,1.19,1,.77,.63],finalDrive:3.70,
      reverseRatio:2.90,reverseEnabled:true,clutchCapacity:1150,
      gearboxInertia:.060,gearboxDrag:.002,synchronizerTorque:55,
      efficiency:.93,dragArea:.912,rollingResistance:.013,
      brakeForce:19500,parkingForce:14500,shiftTime:.14,clutchShiftEngageTime:.16
    },
    'bmw-m3-e46-2002-us': {
      mass: 3415*.45359237 + 75, wheelRadius: .3306, primaryDrive: 1,
      gears: [4.23, 2.53, 1.67, 1.23, 1, .83], finalDrive: 3.62,
      reverseRatio: 3.75, reverseEnabled: true, clutchCapacity: 520,
      speedLimit:155*.44704,
      gearboxInertia: .026, gearboxDrag: .0012, synchronizerTorque: 32,
      efficiency: .94, dragArea: .66, rollingResistance: .012,
      brakeForce: 15500, parkingForce: 11500,shiftTime:.12,clutchShiftEngageTime:.14
    },
    'bmw-330i-e46-2001-us': {
      mass:3318*.45359237+75,wheelRadius:.3184,primaryDrive:1,
      gears:[4.21,2.49,1.66,1.24,1],finalDrive:2.93,
      reverseRatio:3.85,reverseEnabled:true,clutchCapacity:420,
      speedLimit:128*.44704,
      gearboxInertia:.023,gearboxDrag:.0012,synchronizerTorque:28,
      efficiency:.94,dragArea:.62,rollingResistance:.012,
      brakeForce:14500,parkingForce:11000,shiftTime:.14,clutchShiftEngageTime:.16
    },
    'bmw-m5-e39-2003-us': {
      mass:4024*.45359237+75,wheelRadius:.32485,primaryDrive:1,
      gears:[4.23,2.53,1.67,1.23,1,.83],finalDrive:3.15,
      reverseRatio:3.75,reverseEnabled:true,clutchCapacity:650,
      speedLimit:155*.44704,
      gearboxInertia:.038,gearboxDrag:.0015,synchronizerTorque:38,
      efficiency:.94,dragArea:.65,rollingResistance:.012,
      brakeForce:18000,parkingForce:13000,shiftTime:.14,clutchShiftEngageTime:.16
    },
    'ford-mustang-boss302-1969': {
      mass:3250*.45359237+75,wheelRadius:.32893,primaryDrive:1,
      gears:[2.78,1.93,1.36,1],finalDrive:3.50,
      reverseRatio:2.78,reverseEnabled:true,clutchCapacity:530,
      gearboxInertia:.045,gearboxDrag:.002,synchronizerTorque:30,
      efficiency:.90,dragArea:.90,rollingResistance:.018,
      brakeForce:12000,parkingForce:9500,shiftTime:.18,clutchShiftEngageTime:.20
    },
    'chevrolet-camaro-z28-1969': {
      mass:3296*.45359237+75,wheelRadius:.339471,primaryDrive:1,
      gears:[2.52,1.88,1.46,1],finalDrive:3.73,
      reverseRatio:2.59,reverseEnabled:true,clutchCapacity:530,
      gearboxInertia:.045,gearboxDrag:.002,synchronizerTorque:30,
      efficiency:.90,dragArea:.94,rollingResistance:.018,
      brakeForce:12000,parkingForce:9500,shiftTime:.18,clutchShiftEngageTime:.20
    },
    'f1v12': {
      // Declared circuit ratios, not claimed Ferrari tooth counts. Ferrari's
      // 595 kg "with liquids" is used as the complete reference model mass;
      // the source does not establish a separate driver-mass convention.
      mass:595,wheelRadius:.330,primaryDrive:1,
      gears:[2.75,2.18,1.80,1.53,1.33,1.17],finalDrive:5.4,
      reverseRatio:2.90,reverseEnabled:true,clutchCapacity:600,
      gearboxInertia:.009,gearboxDrag:.0007,synchronizerTorque:40,
      efficiency:.94,dragArea:1.25,rollingResistance:.014,
      brakeForce:12000,parkingForce:4500,shiftTime:.055,clutchShiftEngageTime:.08
    },
    'renesis': {
      mass:3065*.45359237+75,wheelRadius:.32985,primaryDrive:1,
      gears:[3.815,2.260,1.536,1.177,1,.787],finalDrive:4.777,
      reverseRatio:3.603,reverseEnabled:true,clutchCapacity:340,
      gearboxInertia:.021,gearboxDrag:.0011,synchronizerTorque:28,
      efficiency:.94,dragArea:.59,rollingResistance:.012,
      brakeForce:14000,parkingForce:10500,shiftTime:.12,clutchShiftEngageTime:.14
    }
  };

  function defaults(preset = 'two') {
    const name = typeof preset === 'string' ? preset.toLowerCase() : '';
    const engine = typeof preset === 'object' && preset ? preset : EngineCore.defaults(name);
    const two = engine.kind === 'two' || /^(two|2t|zweitakt)$/.test(name);
    const diesel = engine.combustion === 'diesel' || name.includes('diesel');
    const rotary=engine.kind==='rotary',count = rotary?2*engine.rotorCount:engine.cylinderCount || (two || /single/.test(name) ? 1 : /twin/.test(name) ? 2 : 4);
    const light = !rotary&&(two&&count<=2 || count === 1), twin = !rotary&&!two&&!light&&count === 2;
    const d={
      mass: light ? 180 : twin ? 260 : diesel ? 1350 : 1150,
      wheelRadius: light ? .27 : diesel ? .31 : .30,
      primaryDrive: light ? two ? 3.2 : 2.8 : twin ? 1.9 : 1,
      finalDrive: light || twin ? 4.1 : diesel ? 3.4 : 3.7,
      gears: light ? [3.1, 2.1, 1.6, 1.25, 1, .82] : twin ? [3, 2.1, 1.6, 1.28, 1.05, .88] :
        diesel ? [3.6, 2.1, 1.4, 1.04, .82, .68] : [3.6, 2.15, 1.48, 1.1, .88, .72],
      reverseRatio: light || twin ? 3.1 : 3.4,
      reverseEnabled: true,
      speedLimit:0,
      efficiency: light || twin ? .94 : .95,
      clutchCapacity: two ? 22*count : light ? diesel ? 90 : 50 : twin ? diesel ? 160 : 90 : (diesel ? 420 : 260)*Math.max(.5,count/4),
      clutchEngageTime: 1.5, clutchDisengageTime: .12,
      clutchShiftEngageTime: light || twin ? .12 : .16,
      gearboxInertia: light ? .0025 : twin ? .006 : diesel ? .025 : .015,
      gearboxDrag: light ? .0002 : twin ? .0004 : .001,
      synchronizerTorque: light ? 3 : twin ? 8 : diesel ? 40 : 25,
      shiftTime: light || twin ? .10 : .14, rollingResistance: light || twin ? .015 : .012,
      dragArea: light ? .48 : twin ? .60 : diesel ? .69 : .65,
      brakeForce: light ? 1500 : twin ? 2300 : diesel ? 12500 : 11000,
      parkingForce: light ? 1200 : twin ? 1800 : 10000,
      slope: 0
    };
    if(two&&count>1){d.mass=count<=2?230:count<=3?300:count<=4?450:count<=8?800:1000;d.gearboxInertia=.0025*count;d.synchronizerTorque=3*count;d.dragArea=count<=2?.50:count<=4?.56:.64;}
    if(count>4&&!two){const factor=count/4;d.mass+=100*(count-4);d.gearboxInertia*=factor;d.synchronizerTorque*=factor;d.brakeForce*=Math.sqrt(factor);d.parkingForce*=Math.sqrt(factor);}
    if(rotary){d.mass=900+150*(engine.rotorCount-1);d.gearboxInertia=.012*engine.rotorCount;d.synchronizerTorque=20*engine.rotorCount;}
    if(Number.isFinite(EngineCore.displacement(engine))){
      const reference=EngineCore.familyDefaults({kind:engine.kind,layout:engine.layout,cylinderCount:engine.cylinderCount,
        rotorCount:engine.rotorCount,combustion:engine.combustion,fuelType:engine.fuelType,boost:engine.boost});
      const volume=EngineCore.displacement(engine)/EngineCore.displacement(reference),length=Math.cbrt(volume);
      d.clutchCapacity*=volume;d.gearboxInertia*=volume*length*length;d.gearboxDrag*=volume*length;d.synchronizerTorque*=volume;
    }
    // All capacities above were sized at the crank. The primary stage is ahead
    // of the clutch, so the clutch capacity is expressed at the real gearbox
    // input. The listed gearbox inertia already belongs to that shaft. The
    // primary gear itself is ideal;
    // the declared efficiency and drag account for driveline losses once.
    d.clutchCapacity*=d.primaryDrive;
    const profile=VEHICLE_PROFILES[engine.modelId || name];
    if(profile)Object.assign(d,profile,{gears:profile.gears.slice()});
    return d;
  }

  function parameterLimits(){return {
    mass:[5,100000],wheelRadius:[.03,3],primaryDrive:[.1,30],finalDrive:[.1,30],reverseRatio:[.05,30],gears:[.05,30],speedLimit:[0,200],
    efficiency:[.5,1],clutchCapacity:[.001,50000],gearboxInertia:[1e-8,100],
    clutchEngageTime:[0,3],clutchDisengageTime:[0,.8],clutchShiftEngageTime:[0,3],gearboxDrag:[0,10],synchronizerTorque:[.001,10000],shiftTime:[.01,5],
    rollingResistance:[0,.15],dragArea:[0,30],brakeForce:[0,1e6],parkingForce:[0,1e6],slope:[-45,45]
  };}

  function validate(input) {
    const errors = [];
    if (!input || typeof input !== 'object' || Array.isArray(input))
      return {ok: false, errors: ['Konfiguration muss ein Objekt mit engine und drivetrain sein.'], config: null};
    const e = EngineCore.validate(input.engine);
    if (!e.ok) errors.push(...e.errors);
    const supplied = input.drivetrain === undefined ? {} : input.drivetrain;
    if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied))
      errors.push('drivetrain: Objekt erforderlich.');
    const base = defaults(e.config || input.engine || 'two');
    const hasSupplied=supplied && typeof supplied === 'object' && !Array.isArray(supplied);
    const d = {...base, ...(hasSupplied ? supplied : {})};
    // Old saved drivetrains had no primary stage. Preserve their exact ratios;
    // selecting a fresh preset separately opts into the new complete driveline.
    if(hasSupplied&&Array.isArray(supplied.gears)&&!own(supplied,'primaryDrive')){
      d.primaryDrive=1;
      if(!own(supplied,'reverseEnabled'))d.reverseEnabled=true;
    }
    if(hasSupplied&&Array.isArray(supplied.gears)&&!own(supplied,'speedLimit'))d.speedLimit=0;
    // A missing rolling return time receives the new family/profile default.
    // The separate authored launch return time and all ratios remain intact.
    // restore() retains the old duration of an already moving saved pedal.
    const ranges=parameterLimits();
    for (const key of Object.keys(d))
      if (!own(base, key)) errors.push('Unbekannter Antriebsparameter: ' + key + '.');
    for (const [key, [lo, hi]] of Object.entries(ranges)) {
      if(key==='gears')continue;
      if (typeof d[key] !== 'number' || !Number.isFinite(d[key]) || d[key] < lo || d[key] > hi)
        errors.push(key + ': zulässig ' + lo + ' bis ' + hi + ' (SI).');
    }
    if(typeof d.reverseEnabled!=='boolean')errors.push('reverseEnabled: Wahrheitswert erforderlich.');
    if (!Array.isArray(d.gears) || d.gears.length < 1 || d.gears.length > 6 ||
        d.gears.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < ranges.gears[0] || v > ranges.gears[1]))
      errors.push('Gangübersetzungen: ein bis sechs Zahlen zwischen '+ranges.gears[0]+' und '+ranges.gears[1]+' erforderlich.');
    else {
      if(d.gears.some((v,i)=>i>0&&v>=d.gears[i-1]))errors.push('Gangübersetzungen müssen vom ersten zum letzten Gang abnehmen.');
      d.gears = d.gears.slice();
    }
    return {ok: errors.length === 0, errors, config: {engine: e.config, drivetrain: d}};
  }

  function gearInfo(configuration) {
    const c=configuration.drivetrain,e=configuration.engine;
    const primaryDrive=c.primaryDrive===undefined?1:c.primaryDrive;
    const wheelCircumference=2*Math.PI*c.wheelRadius,redlineRpm=e.redlineRpm;
    return {gearCount:c.gears.length,primaryDrive,finalDrive:c.finalDrive,wheelCircumference,
      redlineRpm,reverseEnabled:c.reverseEnabled!==false,speedLimit:c.speedLimit||0,
      gears:c.gears.map((ratio,i)=>{
        const totalRatio=primaryDrive*ratio*c.finalDrive;
        const kmhPer1000Rpm=wheelCircumference*60/totalRatio;
        return {gear:i+1,ratio,totalRatio,kmhPer1000Rpm,
          speedAtRedlineKmh:kmhPer1000Rpm*redlineRpm/1000,
          nextGearRpmAtRedline:i+1<c.gears.length?redlineRpm*c.gears[i+1]/ratio:null};
      })};
  }

  class Simulation {
    constructor(configuration, options = {}) {
      const checked = validate(configuration);
      if (!checked.ok) throw new Error(checked.errors.join('\n'));
      this.config = checked.config;
      this.dt = options.dt === undefined ? DT : options.dt;
      if (!(this.dt > 0 && this.dt <= .02) || !Number.isFinite(this.dt)) throw new Error('Ungültiger Zeitschritt.');
      this.engine = new EngineCore.Engine(this.config.engine, {dt: this.dt});
      if (typeof this.engine.applyShaftImpulse !== 'function')
        throw new Error('Motorkern unterstützt keine bilanzierte Wellenkopplung.');
      this._driver = controlDefaults();
      this._requestedThrottle=this.engine.controls.throttle;
      this.controls = {...this.engine.controls, ...this._driver};
      const dc = this.config.drivetrain;
      this._rollingForce = dc.rollingResistance * dc.mass * G * Math.cos(dc.slope * DEG);
      this._gradeForce = -dc.mass * G * Math.sin(dc.slope * DEG);
      this._airCoefficient = .5 * this.config.engine.ambientP / (287 * this.config.engine.ambientT) * dc.dragArea;
      this._forces = {rolling: this._rollingForce, air: 0, brake: 0, parking: 0};
      this._capacity = 0;
      this._clutchPedal = this._driver.clutch;
      this._clutchReturnDuration = dc.clutchEngageTime;
      this.inputOmega = 0;
      this._shift = null;
      this._clutchImpulse = 0;
      this._gearLossTorque = 0;
      this._lastTorque = 0;
      this._initialK = 0;
      this._totals = {inputWork: 0, clutchHeat: 0, synchHeat: 0, gearboxLoss: 0,
        rollingLoss: 0, airLoss: 0, brakeHeat: 0, parkingHeat: 0, gradeWork: 0};
      this.drive = {v: 0, kmh: 0, gear: 0, requestedGear: 0, shifting: false,
        clutchState: 'getrennt', clutchTorque: 0, clutchSlip: 0, clutchHeat: 0,
        distance: 0, odometer: 0, acceleration: 0, wheelRPM: 0, gearboxRPM: 0,
        ratio: 0, message: '', shiftProgress: 0, synchHeat: 0, gearboxLoss: 0,
        rollingLoss: 0, airLoss: 0, brakeHeat: 0, parkingHeat: 0,
        kineticEnergy: 0, totalKineticEnergy: 0, inputWork: 0, gradeWork: 0,
        energyResidual: 0};
      this._refresh();
    }

    setControls(patch) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Ungültige Bedienwerte.');
      const driver = {...this._driver}, enginePatch = {};
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'clutch' || key === 'brake') {
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
            throw new Error(key + ': zulässig 0 bis 1.');
          driver[key] = value;
        } else if (key === 'parking' || key === 'reverseUnlock') {
          if (typeof value !== 'boolean') throw new Error(key + ': Wahrheitswert erforderlich.');
          driver[key] = value;
        } else if (key === 'gearRequest') {
          if (!Number.isInteger(value) || value < -1 || value > this.config.drivetrain.gears.length)
            throw new Error('Gang: R (-1), N (0) oder 1 bis '+this.config.drivetrain.gears.length+' erforderlich.');
        } else enginePatch[key] = value;
      }
      if (Object.keys(enginePatch).length) this.engine.setControls(enginePatch);
      if(own(enginePatch,'throttle'))this._requestedThrottle=enginePatch.throttle;
      const previousClutchCommand=this._driver.clutch;
      this._driver = driver;
      // The command represents the driver's requested pedal position. A finite
      // foot/return stroke makes separate keyboard actions physically possible;
      // it changes only available friction, never an engine or wheel speed.
      // A keyboard releases its pedal in one command. Keep the measured launch
      // stroke while stationary, but use the declared quicker foot return once
      // already rolling in an engaged gear. Capture the choice at this command
      // edge: accelerating during the launch never shortens its ongoing stroke.
      if(driver.clutch<previousClutchCommand&&driver.clutch<this._clutchPedal){
        const c=this.config.drivetrain;
        this._clutchReturnDuration=this.drive.gear!==0&&Math.abs(this.drive.v)>1?
          Math.min(c.clutchEngageTime,c.clutchShiftEngageTime):c.clutchEngageTime;
      }
      const duration = driver.clutch < this._clutchPedal ? this._clutchReturnDuration :
        this.config.drivetrain.clutchDisengageTime;
      if (duration === 0) this._clutchPedal = driver.clutch;
      this._capacity = this._clutchCapacity(this._clutchPedal);
      this._applySpeedLimiter();
      this.controls = {...this.engine.controls, ...driver,throttle:this._requestedThrottle};
      if (own(patch, 'gearRequest')) this._requestGear(patch.gearRequest);
      this._refresh();
    }

    _ratio(gear) {
      const c = this.config.drivetrain;
      return gear < 0 ? -c.reverseRatio * c.finalDrive : gear > 0 ? c.gears[gear - 1] * c.finalDrive : 0;
    }

    _applySpeedLimiter(){
      const limit=this.config.drivetrain.speedLimit;
      const factor=limit>0?clamp((limit-this.drive.v)/Math.max(.5,.015*limit),0,1):1;
      // The original driver command was validated by Engine.setControls. This
      // actuator only closes its real throttle and never adds brake force,
      // sets RPM or assigns road speed. Direct delivery avoids cloning every
      // other engine control 24,000 times per second for one bounded actuator.
      this.engine.controls.throttle=this._requestedThrottle*factor;
    }

    _requestGear(target) {
      const d = this.drive;
      if(target===-1&&!this.config.drivetrain.reverseEnabled){d.message='Dieses Getriebe hat keinen Rückwärtsgang';return;}
      if (this._driver.clutch < .98) { d.message = 'Kupplung öffnen'; return; }
      if (target === -1 && Math.abs(d.v) >= .35) { d.message = 'R nur bei Stillstand'; return; }
      if (target === -1 && !this._driver.reverseUnlock) { d.message = 'R-Sperre freigeben'; return; }
      if (target > 0 && d.v <= -.35) { d.message = 'Vorwärts nur bei Stillstand'; return; }
      if (target === d.gear && !this._shift) { d.requestedGear = target; d.message = ''; return; }
      // Repeated selection of an already pending gear does not restart the
      // selector or its finite synchronization work.
      if(this._shift&&target===this._shift.target)return;
      // Unmesh without assigning either shaft speed or vehicle speed.
      d.gear = 0; d.ratio = 0; d.requestedGear = target;
      this._shift = {target, elapsed: 0};
      d.shifting = true; d.shiftProgress = 0; d.message = 'Synchronisieren';
    }

    _downstreamK() {
      const c = this.config.drivetrain;
      return .5 * c.mass * this.drive.v ** 2 + .5 * c.gearboxInertia * this.inputOmega ** 2;
    }

    _driveInertia(n) {
      const c = this.config.drivetrain;
      return c.gearboxInertia + (n ? c.mass * c.wheelRadius ** 2 / (n * n) : 0);
    }

    _driveImpulse(impulse, n, inertia) {
      const change = impulse / inertia;
      this.inputOmega += change;
      if (n) this.drive.v += change * this.config.drivetrain.wheelRadius / n;
    }

    _shaftImpulse(impulse) {
      // The return value is the exact change of engine rotational energy.
      const result = this.engine.applyShaftImpulse(impulse);
      if (!result || !Number.isFinite(result.work)) throw new Error('Ungültige Wellenarbeitsbilanz.');
      this._totals.inputWork -= result.work;
    }

    _roadForces() {
      const c = this.config.drivetrain, u = this._driver;
      const forces = this._forces;
      forces.air = this._airCoefficient * this.drive.v ** 2;
      forces.brake = u.brake * c.brakeForce;
      forces.parking = u.parking ? c.parkingForce : 0;
      return forces;
    }

    _roadHeat(work, forces) {
      if (!(work > 0)) return;
      const sum = forces.rolling + forces.air + forces.brake + forces.parking;
      if (!(sum > 0)) return;
      const t = this._totals;
      t.rollingLoss += work * forces.rolling / sum;
      t.airLoss += work * forces.air / sum;
      t.brakeHeat += work * forces.brake / sum;
      t.parkingHeat += work * forces.parking / sum;
    }

    _gravity(dt, n, inertia) {
      const c = this.config.drivetrain;
      if (!c.slope) return;
      const before = this._downstreamK(), force = this._gradeForce;
      if (n) this._driveImpulse(force * c.wheelRadius / n * dt, n, inertia);
      else this.drive.v += force / c.mass * dt;
      this._totals.gradeWork += this._downstreamK() - before;
    }

    _gearLoss(dt, n, inertia) {
      const c = this.config.drivetrain, w = this.inputOmega;
      this._gearLossTorque=0;
      if (w === 0) return;
      // Efficiency is a dissipative transmitted-torque approximation. The
      // ideal gear constraint remains exact in forward and overrun operation.
      const lossTorque = c.gearboxDrag * Math.abs(w) + (n ? (1 - c.efficiency) * Math.abs(this._lastTorque) : 0);
      const impulse = Math.sign(w) * Math.min(Math.abs(w) * inertia, lossTorque * dt);
      this._gearLossTorque=impulse/dt;
      const before = this._downstreamK();
      this._driveImpulse(-impulse, n, inertia);
      this._totals.gearboxLoss += Math.max(0, before - this._downstreamK());
    }

    _freeVehicle(dt, forces) {
      const c = this.config.drivetrain, v = this.drive.v;
      const total = forces.rolling + forces.air + forces.brake + forces.parking;
      const impulse = Math.sign(v) * Math.min(Math.abs(v) * c.mass, total * dt);
      this.drive.v -= impulse / c.mass;
      this._roadHeat(.5 * c.mass * (v * v - this.drive.v * this.drive.v), forces);
    }

    _clutchCapacity(pedal) {
      return this.config.drivetrain.clutchCapacity * Math.max(0, (.98 - pedal) / .98) ** 1.5;
    }

    _clutch(dt, n, inertia, forces) {
      const c = this.config.drivetrain, primary=c.primaryDrive;
      const ie = this.engine.config.inertia*primary*primary;
      const capacity = this._capacity;
      const road = n ? (forces.rolling + forces.air + forces.brake + forces.parking) * c.wheelRadius / Math.abs(n) : 0;
      if (capacity === 0) {
        if (road > 0) {
          const w = this.inputOmega;
          const impulse = Math.sign(w) * Math.min(Math.abs(w) * inertia, road * dt);
          this._driveImpulse(-impulse, n, inertia);
          this._roadHeat(impulse * w - .5 * impulse * impulse / inertia, forces);
        }
        return;
      }
      let remaining = dt;
      let count = 0;
      const eps = 1e-8;
      // Integrate Coulomb friction up to each slip-zero or drive-zero event.
      // Static brakes therefore stop, hold, or are overcome by drive torque;
      // their own force can never accelerate the vehicle through zero.
      while (remaining > 1e-14) {
        if (++count > 16) throw new Error('Kupplung: Reibungsereignisse nicht auflösbar.');
        const e = this.engine.omega/primary, w = this.inputOmega, slip = e - w;
        let tc = 0, tb = 0;
        if (Math.abs(slip) > eps) {
          tc = Math.sign(slip) * capacity;
          tb = Math.abs(w) > eps ? Math.sign(w) * road : clamp(tc, -road, road);
        } else if (Math.abs(w) > eps) {
          tb = Math.sign(w) * road;
          tc = clamp(tb * ie / (ie + inertia), -capacity, capacity);
        }
        const ae = -tc / ie, ad = (tc - tb) / inertia, relativeAcceleration = ae - ad;
        let h = remaining;
        if (Math.abs(slip) > eps && slip * relativeAcceleration < 0)
          h = Math.min(h, -slip / relativeAcceleration);
        if (Math.abs(w) > eps && w * ad < 0) h = Math.min(h, -w / ad);
        if (!(h > 0) || !Number.isFinite(h)) throw new Error('Ungültiger Kupplungszeitschritt.');
        if (tc !== 0) this._shaftImpulse(-tc * h/primary);
        this._driveImpulse((tc - tb) * h, n, inertia);
        this._clutchImpulse += tc * h;
        const clutchWork = tc * (slip * h + .5 * relativeAcceleration * h * h);
        const roadWork = tb * (w * h + .5 * ad * h * h);
        // Roundoff at exact event crossings is below 1e-12 J. A macroscopic
        // negative loss is an error, not a state to be silently replaced.
        if (clutchWork < -1e-9 || roadWork < -1e-9) throw new Error('Reibungsarbeit hat ein unzulässiges Vorzeichen.');
        this._totals.clutchHeat += Math.max(0, clutchWork);
        this._roadHeat(Math.max(0, roadWork), forces);
        remaining -= h;
      }
    }

    _synchronize(dt) {
      const s = this._shift;
      if (!s) return;
      const c = this.config.drivetrain, d = this.drive;
      if (this._driver.clutch < .98) { this._shift = null; d.shifting = false; d.message = 'Kupplung öffnen'; return; }
      // The selector travel and clutch-opening foot stroke overlap. Their
      // elapsed time is physical simulation time, never a presentation timer.
      s.elapsed += dt;
      d.shiftProgress = Math.min(1, s.elapsed / c.shiftTime);
      // Begin the speed match only when the actual clutch has zero capacity;
      // otherwise it would fight the still-coupled engine during this stroke.
      if (this._capacity > 0) { d.message = 'Kupplung öffnet'; return; }
      d.message='Synchronisieren';
      const n = this._ratio(s.target);
      if (n && s.elapsed >= .2 * c.shiftTime) {
        const jv = c.mass * c.wheelRadius ** 2;
        const relative = this.inputOmega - n * d.v / c.wheelRadius;
        const inverse = 1 / c.gearboxInertia + n * n / jv;
        const impulse = clamp(relative / inverse, -c.synchronizerTorque * dt, c.synchronizerTorque * dt);
        this.inputOmega -= impulse / c.gearboxInertia;
        d.v += n * impulse / jv * c.wheelRadius;
        this._totals.synchHeat += Math.max(0, impulse * relative - .5 * impulse * impulse * inverse);
      }
      const synced = !n || Math.abs(this.inputOmega - n * d.v / c.wheelRadius) < 1e-7;
      if (s.elapsed >= c.shiftTime && synced) {
        if (s.target === -1 && (Math.abs(d.v) >= .35 || !this._driver.reverseUnlock)) {
          d.message = Math.abs(d.v) >= .35 ? 'R nur bei Stillstand' : 'R-Sperre freigeben';
        } else if (s.target > 0 && d.v <= -.35) d.message = 'Vorwärts nur bei Stillstand';
        else { d.gear = s.target; d.ratio = n; d.message = ''; }
        this._shift = null; d.shifting = false; d.shiftProgress = 1;
      } else if (s.elapsed > 6) {
        this._shift = null; d.shifting = false; d.message = 'Synchronisierung dauert zu lange';
      }
    }

    step(dt = this.dt) {
      if (!Number.isFinite(dt) || !(dt > 0 && dt <= .02)) throw new Error('Ungültiger Fahrzeugzeitschritt.');
      // Large manual steps preserve the same small mechanical resolution.
      // Smaller steps are retained for convergence comparisons.
      let remaining = dt;
      while (remaining > 1e-14) {
        const h = Math.min(remaining, this.dt, 1 / 1000);
        this._advance(h);
        remaining -= h;
      }
      return this.drive;
    }

    _advance(dt) {
      const d = this.drive, beforeV = d.v,beforeInputOmega=this.inputOmega;
      const beforePedal = this._clutchPedal, target = this._driver.clutch;
      const duration = target < beforePedal ? this._clutchReturnDuration :
        this.config.drivetrain.clutchDisengageTime;
      this._clutchPedal = duration === 0 ? target : beforePedal +
        clamp(target - beforePedal, -dt / duration, dt / duration);
      // Midpoint normal-force capacity within this actual mechanical substep.
      this._capacity = this._clutchCapacity(.5 * (beforePedal + this._clutchPedal));
      this._applySpeedLimiter();
      this.engine.step(dt);
      const n = this._ratio(d.gear), inertia = this._driveInertia(n);
      this._clutchImpulse = 0;
      this._gravity(dt, n, inertia);
      this._gearLoss(dt, n, inertia);
      const forces = this._roadForces();
      if (!n) this._freeVehicle(dt, forces);
      this._clutch(dt, n, inertia, forces);
      this._synchronize(dt);
      d.distance += .5 * (beforeV + d.v) * dt;
      d.odometer += .5 * (Math.abs(beforeV) + Math.abs(d.v)) * dt;
      d.acceleration = (d.v - beforeV) / dt;
      d.inputAcceleration=(this.inputOmega-beforeInputOmega)/dt;
      d.clutchTorque = this._clutchImpulse / dt;
      this._lastTorque = d.clutchTorque;
      // Starter-duration commands remain owned by simulated engine time.
      this.controls.starter = this.engine.controls.starter;
      this._refresh();
    }

    _refresh() {
      const d = this.drive, c = this.config.drivetrain, t = this._totals;
      d.kmh = d.v * 3.6;
      d.wheelRPM = d.v / c.wheelRadius * 30 / Math.PI;
      d.gearboxRPM = this.inputOmega * 30 / Math.PI;
      d.clutchSlip = this.engine.omega/c.primaryDrive - this.inputOmega;
      d.clutchPedal = this._clutchPedal;
      d.clutchReturnTime = this._clutchReturnDuration;
      d.clutchCapacity = this._clutchCapacity(this._clutchPedal);
      d.clutchState = this._clutchPedal >= .98 ? 'getrennt' : Math.abs(d.clutchSlip) < 1e-6 ? 'haftend' : 'schleifend';
      d.shifting = this._shift !== null;
      d.ratio = this._ratio(d.gear);
      d.gearCount=c.gears.length;
      d.reverseEnabled=c.reverseEnabled;
      d.primaryDrive=c.primaryDrive;
      d.gearRatio=d.gear<0?-c.reverseRatio:d.gear>0?c.gears[d.gear-1]:0;
      d.totalRatio=c.primaryDrive*d.ratio;
      d.speedLimit=c.speedLimit;
      d.requestedThrottle=this._requestedThrottle;
      d.effectiveThrottle=this.engine.controls.throttle;
      d.speedLimiterActive=c.speedLimit>0&&d.effectiveThrottle+1e-12<this._requestedThrottle;
      d.engineCoupledRpm=d.wheelRPM*d.totalRatio;
      // Actual wheel force after accelerating the input-shaft inertia, before
      // road/brake forces. Instantaneous combustion ripple remains visible.
      d.tractiveForce=d.ratio?(d.clutchTorque-this._gearLossTorque-c.gearboxInertia*(d.inputAcceleration||0))*d.ratio/c.wheelRadius:0;
      const air=this._airCoefficient*d.v*d.v;
      d.roadResistanceForce=this._rollingForce+air-Math.sign(d.v||1)*this._gradeForce;
      d.roadLoadPower=(this._rollingForce+air)*Math.abs(d.v)-this._gradeForce*d.v;
      Object.assign(d, t);
      d.kineticEnergy = this._downstreamK();
      d.totalKineticEnergy = d.kineticEnergy + .5 * this.engine.config.inertia * this.engine.omega ** 2;
      d.energyResidual = d.kineticEnergy - this._initialK - t.inputWork + t.clutchHeat + t.synchHeat +
        t.gearboxLoss + t.rollingLoss + t.airLoss + t.brakeHeat + t.parkingHeat - t.gradeWork;
      if (!Number.isFinite(d.v) || !Number.isFinite(this.inputOmega) || !Number.isFinite(d.clutchSlip) ||
          !Number.isFinite(d.energyResidual) || !Number.isFinite(d.totalKineticEnergy))
        throw new Error('Nicht endlicher Antriebszustand.');
      if (Math.abs(d.v) > 200 || Math.abs(this.inputOmega) > 8000)
        throw new Error('Antrieb außerhalb des gültigen Geschwindigkeitsbereichs.');
    }

    snapshot() {
      this._refresh();
      const result = this.engine.snapshot();
      result.controls = {...result.controls, ...this._driver,throttle:this._requestedThrottle};
      result.drive = {...this.drive};
      result.configuration = copy(this.config);
      return result;
    }

    serialize() {
      return {version: 1, configuration: copy(this.config), engine: this.engine.serialize(),
        driver: {...this._driver}, inputOmega: this.inputOmega, drive: {...this.drive},
        requestedThrottle:this._requestedThrottle,
        clutchPedal: this._clutchPedal,
        clutchReturnDuration: this._clutchReturnDuration,
        shift: this._shift ? {...this._shift} : null, totals: {...this._totals},
        initialK: this._initialK, lastTorque: this._lastTorque, gearLossTorque:this._gearLossTorque, dt: this.dt};
    }

    restore(state) {
      if (!state || state.version !== 1 || !state.engine || !state.drive || !state.driver || !state.totals)
        throw new Error('Ungültiger Fahrzeugzustand.');
      const checked = validate(state.configuration);
      if (!checked.ok) throw new Error('Gesicherte Fahrzeugkonfiguration ist ungültig.');
      if (JSON.stringify(checked.config) !== JSON.stringify(this.config))
        throw new Error('Zustand passt nicht zur Fahrzeugkonfiguration.');
      const engineCheck=EngineCore.validate(state.engine.config);
      if (!engineCheck.ok || JSON.stringify(engineCheck.config) !== JSON.stringify(this.config.engine))
        throw new Error('Gesicherter Motorzustand passt nicht zur Fahrzeugkonfiguration.');
      for (const key of ['inputOmega', 'initialK', 'lastTorque', 'dt'])
        if (!Number.isFinite(state[key])) throw new Error('Ungültiger Fahrzeugzustand: ' + key + '.');
      if(state.gearLossTorque!==undefined&&!Number.isFinite(state.gearLossTorque))throw new Error('Ungültiges gesichertes Verlustmoment.');
      if(state.requestedThrottle!==undefined&&(!Number.isFinite(state.requestedThrottle)||state.requestedThrottle<0||state.requestedThrottle>1))
        throw new Error('Ungültiger gesicherter Fahrpedalbefehl.');
      if (!(state.dt > 0 && state.dt <= .02)) throw new Error('Ungültiger gesicherter Zeitschritt.');
      if (state.initialK < 0) throw new Error('Ungültige anfängliche Antriebsenergie.');
      for (const key of Object.keys(this._totals))
        if (!Number.isFinite(state.totals[key]) ||
            (key !== 'inputWork' && key !== 'gradeWork' && state.totals[key] < 0))
          throw new Error('Ungültige Antriebsbilanz: ' + key + '.');
      for (const key of ['v', 'distance', 'odometer', 'acceleration', 'clutchTorque'])
        if (!Number.isFinite(state.drive[key])) throw new Error('Ungültiger Fahrzeugzustand: ' + key + '.');
      for (const key of ['gear', 'requestedGear'])
        if (!Number.isInteger(state.drive[key]) || state.drive[key] < -1 || state.drive[key] > this.config.drivetrain.gears.length ||
            (state.drive[key]===-1&&!this.config.drivetrain.reverseEnabled))
          throw new Error('Ungültiger gesicherter Gang.');
      for (const key of ['clutch', 'brake'])
        if (!Number.isFinite(state.driver[key]) || state.driver[key] < 0 || state.driver[key] > 1)
          throw new Error('Ungültige gesicherte Pedalstellung.');
      if (state.clutchPedal !== undefined && (!Number.isFinite(state.clutchPedal) || state.clutchPedal < 0 || state.clutchPedal > 1))
        throw new Error('Ungültige gesicherte Kupplungsbetätigung.');
      if(state.clutchReturnDuration!==undefined&&(!Number.isFinite(state.clutchReturnDuration)||state.clutchReturnDuration<0||state.clutchReturnDuration>3))
        throw new Error('Ungültige gesicherte Kupplungsrücklaufzeit.');
      if (typeof state.driver.parking !== 'boolean' || typeof state.driver.reverseUnlock !== 'boolean')
        throw new Error('Ungültiger gesicherter Fahrbefehl.');
      if (state.shift && (!Number.isInteger(state.shift.target) || state.shift.target < -1 || state.shift.target > this.config.drivetrain.gears.length ||
          (state.shift.target===-1&&!this.config.drivetrain.reverseEnabled)||
          !Number.isFinite(state.shift.elapsed) || state.shift.elapsed < 0 || state.drive.gear !== 0))
        throw new Error('Ungültige gesicherte Schaltphase.');
      const n = this._ratio(state.drive.gear);
      if (n && Math.abs(state.inputOmega - n * state.drive.v / this.config.drivetrain.wheelRadius) > 1e-5)
        throw new Error('Gesicherte Getriebedrehzahlen passen nicht zur Übersetzung.');
      this.engine.restore(copy(state.engine));
      this._requestedThrottle=state.requestedThrottle===undefined?this.engine.controls.throttle:state.requestedThrottle;
      this._driver = {clutch: state.driver.clutch, brake: state.driver.brake,
        parking: state.driver.parking, reverseUnlock: state.driver.reverseUnlock};
      this._clutchPedal = state.clutchPedal === undefined ? this._driver.clutch : state.clutchPedal;
      this._clutchReturnDuration=state.clutchReturnDuration===undefined?this.config.drivetrain.clutchEngageTime:state.clutchReturnDuration;
      this._capacity = this._clutchCapacity(this._clutchPedal);
      this.inputOmega = state.inputOmega;
      this._gearLossTorque=state.gearLossTorque===undefined?0:state.gearLossTorque;
      this._initialK = state.initialK; this._lastTorque = state.lastTorque; this.dt = state.dt;
      this._shift = state.shift ? {...state.shift} : null;
      for (const key of Object.keys(this._totals)) this._totals[key] = state.totals[key];
      Object.assign(this.drive, state.drive);
      this.controls = {...this.engine.controls, ...this._driver,throttle:this._requestedThrottle};
      this._refresh();
      return this;
    }
  }
  return {Simulation, defaults, validate, gearInfo, parameterLimits, constants: {DT, G}, driverKeys: Array.from(DRIVER_KEYS)};
})();
