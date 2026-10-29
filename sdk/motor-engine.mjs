/* MotorLab game SDK 1.6.3 + SIDEWAYS spatial-emitter extension; physics unchanged. */
/* Fahrzeuglabor: common geometry, conservative gas rooms and crankshaft dynamics.
   SI units throughout. No DOM, timers or frame-rate inputs here.
   Passive mechanical acoustic observers never feed forces into the solver.
   Model equations and numerical choices are documented in the delivered guide. */
const EngineCore = (() => {
  'use strict';
  const Math=globalThis.Math,Number=globalThis.Number;
  const PI = Math.PI, TAU = 2 * PI, DEG = PI / 180;
  const R = 287, CV = 718, CP = CV + R, GAMMA = CP / CV;
  const AFR = 14.7, LHV = 44e6, DT = 1 / 24000;
  const CRITICAL = Math.pow(2 / (GAMMA + 1), GAMMA / (GAMMA - 1));
  const CHOKED = Math.sqrt(GAMMA) * Math.pow(2 / (GAMMA + 1), (GAMMA + 1) / (2 * (GAMMA - 1)));
  const BURN_NORMALIZATION = 1-Math.exp(-6.9);
  const mod = (v, p) => ((v % p) + p) % p;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function mechanicsSignal(c){return {crankAngle:0,crankOmega:0,angularAcceleration:0,
    pistonSideForce:0,reciprocatingForce:0,pistonContactImpulse:0,pistonContactEnergy:0,
    valveContactImpulse:0,frictionPower:0,timingAngle:0,timingOmega:0,timingLoad:0,
    timingChain:c.kind==='four'&&c.timingDrive==='chain',timingTeeth:c.timingCrankTeeth};}
  function acousticState(c,count){return {version:1,springEnergy:0,
    pistonPosition:Array(c.kind==='rotary'?0:count).fill(0),
    pistonVelocity:Array(c.kind==='rotary'?0:count).fill(0)};}
  const MODEL_IDS=Object.freeze(['hellcat','bestia50','f1v12','renesis','v8-12l','r3-turbo-660','boxer6-38','rotary4-race',
    'bmw-m3-e46-2002-us','bmw-m5-e39-2003-us','bmw-330i-e46-2001-us','ford-mustang-boss302-1969','chevrolet-camaro-z28-1969']);
  const FUELS=Object.freeze({
    gasoline:Object.freeze({id:'gasoline',label:'Benzin',afr:14.7,lhv:44e6,combustion:'otto',ignitionDelayFactor:1,flameDurationFactor:1}),
    diesel:Object.freeze({id:'diesel',label:'Diesel',afr:14.7,lhv:42.5e6,combustion:'diesel',ignitionDelayFactor:1,flameDurationFactor:1}),
    kerosene:Object.freeze({id:'kerosene',label:'Kerosin (Jet-A-Nominalmodell)',afr:14.8,lhv:43.1e6,combustion:'diesel',ignitionDelayFactor:1.35,flameDurationFactor:1}),
    ethanol:Object.freeze({id:'ethanol',label:'Ethanol',afr:9.0,lhv:26.8e6,combustion:'otto',ignitionDelayFactor:1,flameDurationFactor:.9}),
    methanol:Object.freeze({id:'methanol',label:'Methanol',afr:6.45,lhv:19.9e6,combustion:'otto',ignitionDelayFactor:1,flameDurationFactor:.8}),
    lpg:Object.freeze({id:'lpg',label:'LPG (Propan-Nominalmodell)',afr:15.67,lhv:46.4e6,combustion:'otto',ignitionDelayFactor:1,flameDurationFactor:1}),
    cng:Object.freeze({id:'cng',label:'CNG (Methan-Nominalmodell)',afr:17.2,lhv:50e6,combustion:'otto',ignitionDelayFactor:1,flameDurationFactor:1.15}),
    hydrogen:Object.freeze({id:'hydrogen',label:'Wasserstoff',afr:34.3,lhv:120e6,combustion:'otto',ignitionDelayFactor:1,flameDurationFactor:.55})
  });
  function fuelProperties(value){const id=typeof value==='string'?value:value?.fuelType||(value?.combustion==='diesel'?'diesel':'gasoline');return FUELS[id]||null;}
  function cycleDegrees(c){return c.kind==='rotary'?1080:c.kind==='two'?360:720;}
  function chamberCount(c){return c.kind==='rotary'?3*c.rotorCount:c.cylinderCount;}
  function displacement(c){return c.kind==='rotary'?3*Math.sqrt(3)*c.eccentricity*c.rotorRadius*c.rotorWidth*c.rotorCount:PI*c.bore*c.bore*c.stroke*c.cylinderCount/4;}
  function chamberLabel(c,i){return c.kind==='rotary'?'R'+(Math.floor(i/3)+1)+' K'+(i%3+1):'Z'+(i+1);}
  function layoutLabel(c){return c.kind==='rotary'?'Wankel':({inline:'Reihe',v:'V',boxer:'Boxer',w:'W',radial:'Stern'}[c.layout||'inline']||'Unbekannt');}
  function layoutCounts(kind,layout='inline'){
    if(kind==='rotary')return layout==='inline'?[1,2,3,4]:[];
    if(!['two','four'].includes(kind))return [];
    if(layout==='inline')return Array.from({length:16},(_,i)=>i+1);
    if(layout==='v'||layout==='boxer')return Array.from({length:8},(_,i)=>2*i+2);
    if(layout==='w')return [4,8,12,16];
    if(layout==='radial')return [3,5,7,9,11,13,15];return [];
  }

  const DESIGN_PROFILES=Object.freeze({road:{pistonOtto:20,pistonTwo:16,pistonDiesel:13,apex:40},
    sport:{pistonOtto:24,pistonTwo:19,pistonDiesel:16,apex:48},
    race:{pistonOtto:27,pistonTwo:22,pistonDiesel:18,apex:54}});
  function rpmSettings(c={}){
    return {redlineEnabled:c.redlineEnabled!==false,redlineRpm:c.redlineRpm,
      revLimiterEnabled:c.revLimiterEnabled!==false,limitRpm:c.revLimitRpm>0?c.revLimitRpm:c.redlineRpm};
  }
  function rpmEnvelope(c,options={}){
    const profile=options.profile||'road',p=DESIGN_PROFILES[profile]||DESIGN_PROFILES.road;
    const rotary=c.kind==='rotary',speed=rotary?p.apex:c.combustion==='diesel'?p.pistonDiesel:c.kind==='two'?p.pistonTwo:p.pistonOtto;
    const raw=rotary?speed*90/(PI*(c.rotorRadius+3*c.eccentricity)):speed*30/c.stroke;
    const recommended=Math.max(300,Math.min(30000,50*Math.round(raw/50))),rpm=c.redlineRpm??recommended;
    return {profile,recommendedRpm:recommended,numericalRpmRange:[300,30000],
      criterion:rotary?'maximumApexSpeed':'meanPistonSpeed',designSpeed:speed,
      meanPistonSpeed:rotary?null:2*c.stroke*rpm/60,
      maximumApexSpeed:rotary?(c.rotorRadius+3*c.eccentricity)*rpm*TAU/180:null,
      configuredRpm:rpm,aboveRecommendation:rpm>recommended,
      note:'Geometrische Auslegungsempfehlung; keine Werkstoff-, Ventiltrieb- oder Festigkeitsfreigabe.'};
  }

  function geometryMargins(c){const scale=Math.min(1,c.bore/.054,c.stroke/.0545);
    return {scale,pin:.0005*scale,rod:.0002*scale,crank:.002*scale,web:.001*scale,head:.006*scale,valve:.0007*scale,port:.001*scale};}

  function defaults(preset = 'two') {
    if(preset&&typeof preset==='object')return familyDefaults(preset);
    if(/^(rotary|wankel)[1-4]?$/.test(preset))return familyDefaults({kind:'rotary',rotorCount:Number(preset.match(/[1-4]$/)?.[0]||1)});
    if(preset==='kerosene')return familyDefaults({fuelType:'kerosene',boost:'turbo'});
    if(MODEL_IDS.includes(preset))return {...namedDesign(preset),modelId:preset};
    const two = preset === 'two', twin = preset === 'twin', single = preset === 'single4';
    const diesel = preset === 'diesel' || preset === 'turbodiesel';
    const count = two || single ? 1 : twin ? 2 : 4;
    const large = count === 4;
    const bore = two ? .054 : large ? .082 : .068;
    const stroke = two ? .0545 : large ? .086 : .068;
    const pistonHeight = two ? Math.max(stroke + .055*bore, .74*bore) : .44*bore;
    const cylinderWall = Math.max(8/2200, .055*bore);
    return {
      kind: two ? 'two' : 'four', cylinderCount: count,layout:'inline',bankAngle:90,rotorCount:1,
      fuelType:diesel?'diesel':'gasoline',modelId:'',
      // The old ideal cam constraint does not imply a real timing chain.
      // Tooth counts are explicitly effective acoustic geometry, not OEM data.
      timingDrive:'ideal',timingCrankTeeth:20,
      rotorRadius:.105,eccentricity:.015,rotorWidth:.065,rotorSpacing:.090,rotaryHousingWall:.008,rotarySidePlate:.008,
      rotaryIntakeArea:.0010,rotaryExhaustArea:.0012,rotaryIntakeOpen:520,rotaryIntakeClose:850,rotaryExhaustOpen:220,rotaryExhaustClose:560,
      combustion: diesel ? 'diesel' : 'otto',
      boost: ['turbo','turbodiesel'].includes(preset) ? 'turbo' : preset === 'supercharger' ? 'supercharger' : 'none',
      bore, stroke,
      rod: two ? .105 : large ? .145 : .115, compression: diesel ? 18 : two ? 9 : 9.5,
      pistonHeight, pistonPinOffset: pistonHeight*(two ? .34 : .48), pistonClearance: .00004,
      pistonSkirtWall: Math.max(5/2200, .06*bore), pistonCrownThickness: Math.max(5/2200, .065*bore),
      rodWidth: 16/2200, cylinderWall, cylinderSpacing: bore+2*cylinderWall+.010,
      headHeight: Math.max(34/2200, .22*bore),
      inertia: two ? .028 : large ? .19 : count === 2 ? .08 : .05,
      frictionBase: two ? .18 : large ? 1.6 : .35 * count,
      frictionViscous: two ? .0018 : large ? .014 : .0023 * count, frictionWindage:(two?1e-6:1.15e-6)*count,bearingWear: 0,
      intakeArea: two ? .00025 : large ? .0024 : .00035 * count,
      intakeVolume: two ? .00012 : large ? .0016 : .000225 * count,
      intakeLength: two ? .18 : large ? .4 : .28, intakeDiameter: two ? .020 : large ? .055 : .032,
      exhaustLength: two ? .70 : large ? 1.4 : .95, exhaustDiameter: two ? .027 : large ? .050 : .037,
      exhaustDamping: .45, ambientP: 101325, ambientT: 293.15, wallT: diesel ? 460 : 430,
      burnDuration: two ? 45 : 48, combustionEfficiency: diesel ? .90 : .90,
      valveDiameter: large ? .032 : .026, valveLift: large ? .008 : .007,valvesPerPort:1,
      valveProfileExponent: 2, camPhaserRate:180, intakeCd: .70, exhaustCd: .74, transferCd: .74, reedCd: .78, throttleCd: .72,
      intakeOpen: diesel ? 360 : 350, intakeClose: diesel ? 560 : 580,
      exhaustOpen: 140, exhaustClose: diesel ? 360 : 370,
      transferTop: .038, transferHeight: .014, transferWidth: .032,
      exhaustTop: .0315, exhaustHeight: .020, exhaustWidth: .022, crankcaseRatio: 1.5, reedArea: .00025,
      reedCrackPressure: 30, reedFullOpenPressure: 1530, heatTransferScale: 1,
      idleEnabled: true, idleRpm: two ? 2200 : diesel ? 800 : large ? 900 : 1400,
      idleMax: diesel ? .28 : .20, redlineRpm: two ? 8500 : diesel ? 4500 : large ? 7000 : 8000,
      redlineEnabled:true,revLimiterEnabled:true,revLimitRpm:0,
      starterTorque:two?6:large?(diesel?220:150):count===2?(diesel?65:21):(diesel?35:12),
      starterNoLoadRpm:(large?95:190)*60/TAU,
      injectionAdvance: 10, injectionDuration: 22, maxFuelPerCycle: large ? .000055 : .000030,
      dieselMinLambda: 1.25, dieselMixTime: .0008,
      boostVolume: large ? .0015 : .0006, compressorArea: large ? .0012 : .00055,
      compressorEfficiency: .68, boostTarget: diesel ? 90000 : 60000,
      intercoolerEnabled: true, intercoolerEfficiency: .60,
      turboCount:1,turboInertia: large ? .000020 : .000006, turboDesignRpm: 130000,
      turboMaxPressureRatio: 2.6, turboMaxFlow: large ? .18 : .065,
      turbineArea: large ? .00035 : .00015, turbineEfficiency: .65,
      turboRadius: large ? .025 : .018, turboFriction: .00000015,
      wastegateArea: large ? .0005 : .00022,
      superchargerRatio: 1.8, superchargerDisplacement: large ? .00070 : .00020,
      superchargerFriction: .08, bypassArea: large ? .0012 : .0006,
      compressorDuctLength:.35,turboSurgeFlowFraction:.30,autoBypassEnabled:true,bypassResponseTime:.012
    };
  }
  function familyDefaults(spec={}){
    if(typeof spec==='string')return defaults(spec);
    const kind=spec.kind||'four',count=kind==='rotary'?0:(spec.cylinderCount??4),rotors=spec.rotorCount??1;
    const combustion=spec.combustion||(spec.fuelType&&fuelProperties(spec.fuelType)?.combustion)||'otto';
    const preset=kind==='two'?'two':combustion==='diesel'?(spec.boost==='turbo'?'turbodiesel':'diesel'):count===1?'single4':count===2?'twin':spec.boost==='turbo'?'turbo':spec.boost==='supercharger'?'supercharger':'i4';
    const c=defaults(preset),baseCount=c.cylinderCount;
    c.kind=kind;c.cylinderCount=count;c.rotorCount=rotors;c.layout=spec.layout||'inline';c.combustion=combustion;c.fuelType=spec.fuelType||(combustion==='diesel'?'diesel':'gasoline');
    if(kind==='rotary'){
      c.compression=9.5;c.inertia=.12*rotors;c.frictionBase=.70*rotors;c.frictionViscous=.0055*rotors;c.frictionWindage=2.3e-6*rotors;
      c.intakeArea=.0014*rotors;c.intakeVolume=.0009*rotors;c.intakeDiameter=.040*Math.sqrt(rotors);c.intakeLength=.30;
      c.exhaustDiameter=.040*Math.sqrt(rotors);c.exhaustLength=1.1;c.burnDuration=65;c.idleRpm=1100;c.idleMax=.24;c.redlineRpm=7500;
      c.boostVolume=.001*rotors;c.compressorArea=.0008*rotors;c.turbineArea=.00025*rotors;c.wastegateArea=.00035*rotors;
      c.turboMaxFlow=.12*rotors;c.turboInertia=.000012*rotors;c.superchargerDisplacement=.0005*rotors;c.bypassArea=.0008*rotors;
      c.starterTorque=100*rotors;c.starterNoLoadRpm=95*60/TAU;
    }else{
      const factor=count/baseCount,baseInertia=c.inertia;
      for(const key of ['inertia','frictionBase','frictionViscous','frictionWindage','intakeArea','intakeVolume','boostVolume','compressorArea','turbineArea','wastegateArea','superchargerDisplacement','bypassArea','turboInertia','turboMaxFlow'])c[key]*=factor;
      // A single high-compression cylinder needs flywheel energy through its
      // unpowered compression stroke; retain the legacy diesel flywheel.
      if(combustion==='diesel'&&count===1)c.inertia=baseInertia;
      c.starterTorque=kind==='two'?6*count:count>=3?(combustion==='diesel'?220:150)*count/4:count===2?(combustion==='diesel'?65:21):(combustion==='diesel'?35:12);
      c.starterNoLoadRpm=(count>=3&&kind!=='two'?95:190)*60/TAU;
      c.intakeDiameter*=Math.sqrt(factor);c.exhaustDiameter*=Math.sqrt(factor);
      if(count>=3&&kind!=='two'){c.idleRpm=combustion==='diesel'?800:900;}
    }
    c.bankAngle=c.layout==='boxer'?180:c.layout==='w'?90:[6,12].includes(count)?60:count===10?72:90;
    // Each parallel turbo is a complete, geometrically similar machine. The
    // pair shares the reference flow capacity, not a multiplied boost target.
    // Explicit hardware in spec still wins over this automatic starting point.
    if(spec.turboCount===2&&(spec.boost??c.boost)==='turbo'){const length=1/Math.sqrt(2);
      for(const key of ['compressorArea','turbineArea','wastegateArea','bypassArea','turboMaxFlow'])c[key]/=2;
      c.turboRadius*=length;c.compressorDuctLength*=length;
      c.turboInertia*=length**5;c.turboDesignRpm/=length;c.turboFriction*=length**4;
    }
    return {...c,...spec,kind,cylinderCount:count,rotorCount:rotors,combustion,fuelType:c.fuelType};
  }
  function sizeForDisplacement(config,targetM3,options={}){
    if(!config||typeof config!=='object'||!Number.isFinite(targetM3)||targetM3<=0)throw new Error('Auslegung benötigt eine Konfiguration und positiven Hubraum in m³.');
    const selectors={kind:config.kind||'four',layout:config.layout||'inline',cylinderCount:config.cylinderCount,rotorCount:config.rotorCount,
      combustion:config.combustion,fuelType:config.fuelType,boost:config.boost,turboCount:config.turboCount};
    for(const key of Object.keys(selectors))if(selectors[key]===undefined)delete selectors[key];
    const ref=options.reference?{...options.reference}:familyDefaults(selectors),out={...ref,...config,modelId:''};
    const current=displacement(out),linear=Math.cbrt(targetM3/current);
    if(!(current>0)||!Number.isFinite(linear))throw new Error('Ausgangsgeometrie besitzt keinen endlichen positiven Hubraum.');
    const dims=out.kind==='rotary'?['rotorRadius','eccentricity','rotorWidth','rotorSpacing','rotaryHousingWall','rotarySidePlate']:
      ['bore','stroke','rod','pistonHeight','pistonPinOffset','pistonClearance','pistonSkirtWall','pistonCrownThickness','rodWidth','cylinderWall','cylinderSpacing','headHeight'];
    if(options.preserveGeometry){if(Math.abs(current-targetM3)>Math.max(1e-12,targetM3*1e-8))throw new Error('Bereits gelöste Geometrie stimmt nicht mit dem Zielhubraum überein.');}
    else for(const key of dims)out[key]*=linear;
    const volumeRatio=displacement(out)/displacement(ref),lengthRatio=Math.cbrt(volumeRatio),areaRatio=lengthRatio*lengthRatio;
    const boreRatio=out.kind==='rotary'?out.rotorRadius/ref.rotorRadius:out.bore/ref.bore,strokeRatio=out.kind==='rotary'?out.eccentricity/ref.eccentricity:out.stroke/ref.stroke;
    const profile=options.profile||'road',sport=profile==='sport',race=profile==='race',inertiaFactor=race?.65:sport?.85:1;
    // Homothetic mass grows as length³, rotational inertia as length⁵.
    out.inertia=ref.inertia*volumeRatio*lengthRatio*lengthRatio*inertiaFactor;
    out.frictionBase=ref.frictionBase*volumeRatio;out.frictionViscous=ref.frictionViscous*volumeRatio*lengthRatio;
    out.frictionWindage=ref.frictionWindage*volumeRatio*lengthRatio*lengthRatio;
    for(const key of ['intakeVolume','boostVolume','superchargerDisplacement'])out[key]=ref[key]*volumeRatio;
    for(const key of ['intakeArea','compressorArea','turbineArea','wastegateArea','bypassArea'])out[key]=ref[key]*areaRatio;
    for(const key of ['intakeLength','exhaustLength','intakeDiameter','exhaustDiameter','compressorDuctLength','turboRadius'])out[key]=ref[key]*lengthRatio;
    out.turboInertia=ref.turboInertia*volumeRatio*lengthRatio*lengthRatio;
    out.turboDesignRpm=ref.turboDesignRpm/lengthRatio;out.turboMaxFlow=ref.turboMaxFlow*areaRatio;
    out.turboFriction=ref.turboFriction*volumeRatio*lengthRatio;out.superchargerFriction=ref.superchargerFriction*volumeRatio;
    out.maxFuelPerCycle=ref.maxFuelPerCycle*volumeRatio;
    out.starterTorque=ref.starterTorque*volumeRatio;out.starterNoLoadRpm=ref.starterNoLoadRpm/Math.sqrt(lengthRatio);
    out.redlineRpm=rpmEnvelope(out,{profile}).recommendedRpm;
    out.idleRpm=Math.round(Math.max(out.combustion==='diesel'?450:out.kind==='two'?1200:550,Math.min(out.redlineRpm*.45,ref.idleRpm/Math.sqrt(lengthRatio)))/25)*25;
    if(race)out.idleRpm=Math.max(out.idleRpm,Math.min(2500,out.redlineRpm*.14));
    out.burnDuration=ref.burnDuration*(race?.82:sport?.92:1);
    if(out.kind==='rotary'){
      const faceScale=out.rotorRadius*out.rotorWidth/(ref.rotorRadius*ref.rotorWidth);
      out.rotaryIntakeArea=ref.rotaryIntakeArea*faceScale;out.rotaryExhaustArea=ref.rotaryExhaustArea*faceScale;
    }else if(out.kind==='two'){
      for(const name of ['transfer','exhaust']){out[name+'Top']=ref[name+'Top']*strokeRatio;out[name+'Height']=ref[name+'Height']*strokeRatio;out[name+'Width']=ref[name+'Width']*boreRatio;}
      out.reedArea=ref.reedArea*areaRatio;
    }else{out.valveDiameter=ref.valveDiameter*boreRatio;out.valveLift=ref.valveLift*boreRatio;}
    // An inactive machine keeps its stored example parameters. In particular,
    // a tiny naturally aspirated engine does not need a fictitious turbo whose
    // unused design speed would invalidate the otherwise admissible geometry.
    const boostOnly=['boostVolume','compressorArea','compressorDuctLength','turboRadius','turboInertia','turboDesignRpm','turboMaxFlow',
      'turboFriction','turbineArea','wastegateArea','superchargerDisplacement','superchargerFriction','bypassArea'];
    for(const key of boostOnly)if(out.boost==='none'||(out.boost==='supercharger'&&(/^(turbo|turbine|wastegate)/.test(key))))out[key]=config[key]??ref[key];
    return out;
  }

  function namedDesign(name){
    let c;
    if(name==='bmw-m3-e46-2002-us'){
      c=pistonDesign({layout:'inline',cylinderCount:6,bore:.087,stroke:.091,compression:11.5,redlineRpm:8000,idleRpm:900},'sport');
      Object.assign(c,{valvesPerPort:2,valveDiameter:.034,valveLift:.0115,intakeOpen:335,intakeClose:600,exhaustOpen:120,exhaustClose:385,
        intakeArea:.0032,intakeDiameter:.09,exhaustDiameter:.085,burnDuration:44,combustionEfficiency:.77,frictionBase:8});
      return c;
    }
    if(name==='bmw-m5-e39-2003-us')return pistonDesign({layout:'v',cylinderCount:8,bankAngle:90,bore:.094,stroke:.089,compression:11,redlineRpm:7000,idleRpm:850,valvesPerPort:2,combustionEfficiency:.72},'sport');
    if(name==='bmw-330i-e46-2001-us')return pistonDesign({layout:'inline',cylinderCount:6,bore:.084,stroke:.0896,compression:10.2,redlineRpm:6500,idleRpm:800,valvesPerPort:2,combustionEfficiency:.72});
    if(name==='ford-mustang-boss302-1969'||name==='chevrolet-camaro-z28-1969'){
      const ford=name==='ford-mustang-boss302-1969';
      return pistonDesign({layout:'v',cylinderCount:8,bankAngle:90,bore:.1016,stroke:.0762,compression:ford?10.5:11,redlineRpm:ford?6150:6500,
        idleRpm:ford?850:900,combustionEfficiency:.64},'sport');
    }
    if(name==='bestia50'){
      c=sizeForDisplacement(familyDefaults({kind:'two',cylinderCount:1}),.00005);
      return {...c,redlineRpm:9000,idleRpm:2400,compression:12,burnDuration:36,starterTorque:4,
        transferWidth:.045,transferTop:.032,transferHeight:.008,exhaustWidth:.027,exhaustTop:.027,exhaustHeight:.013,
        reedArea:.00023,intakeArea:.00023,exhaustDiameter:.025};
    }
    if(name==='renesis'||name==='rotary4-race'){
      const rotors=name==='renesis'?2:4;
      c=familyDefaults({kind:'rotary',rotorCount:rotors});
      c.rotorWidth=.000654/(3*Math.sqrt(3)*c.eccentricity*c.rotorRadius);c.rotorSpacing=c.rotorWidth+2*c.rotarySidePlate+.009;
      c=sizeForDisplacement(c,.000654*rotors,{preserveGeometry:true,profile:name==='renesis'?'sport':'race'});
      return {...c,compression:10,redlineRpm:name==='renesis'?9000:10000,idleRpm:name==='renesis'?1100:1600,
        ...(name==='renesis'?{combustionEfficiency:.67,rotaryIntakeArea:.0016,rotaryExhaustArea:.00185,rotaryIntakeClose:900,exhaustDiameter:.068}:{})};
    }
    if(name==='v8-12l')return sizeForDisplacement(familyDefaults({layout:'v',cylinderCount:8}),.012);
    if(name==='r3-turbo-660')return sizeForDisplacement(familyDefaults({cylinderCount:3,boost:'turbo'}),.000660,{profile:'sport'});
    if(name==='boxer6-38')return sizeForDisplacement(familyDefaults({layout:'boxer',cylinderCount:6}),.0038,{profile:'sport'});
    const f1=name==='f1v12',bore=f1?.086:.1039,stroke=f1?.043:.0909,count=f1?12:8;
    c=familyDefaults({layout:'v',cylinderCount:count,bankAngle:f1?75:90,boost:f1?'none':'supercharger'});
    const scale=bore/c.bore;
    for(const key of ['rod','pistonHeight','pistonPinOffset','pistonClearance','pistonSkirtWall','pistonCrownThickness','rodWidth','cylinderWall','cylinderSpacing','headHeight'])c[key]*=scale;
    c.bore=bore;c.stroke=stroke;
    c=sizeForDisplacement(c,displacement(c),{preserveGeometry:true,profile:f1?'race':'road'});
    c.compression=f1?12.8:9.5;c.redlineRpm=f1?17000:6200;c.idleRpm=f1?2400:850;
    if(f1){c.valvesPerPort=2;c.combustionEfficiency=.86;c.burnDuration=35;c.valveDiameter=.037;c.valveLift=.011;c.intakeArea*=1.6;c.intakeDiameter*=1.2;c.exhaustDiameter*=1.2;c.intakeLength=.18;c.exhaustLength=.7;}
    else{c.superchargerDisplacement=.00238;c.superchargerRatio=2.36;c.boostTarget=80000;c.intakeArea*=1.3;c.intakeDiameter*=1.15;c.exhaustDiameter*=1.15;
      // Mopar Hellcrate 6.2L instruction K6862743AB, p.16: odd and even
      // cylinder numbers occupy opposite banks. Old saved configurations
      // without this optional field retain their original cylinder timing.
      c.firingOrder='1-8-4-3-6-5-7-2';
      Object.assign(c,{valveLift:.013,valveProfileExponent:1.6,intakeOpen:340,intakeClose:615,exhaustOpen:125,exhaustClose:380,combustionEfficiency:.735});}
    return c;
  }
  function pistonDesign(spec,profile='road'){
    const c=familyDefaults({kind:'four',layout:spec.layout,cylinderCount:spec.cylinderCount,boost:spec.boost||'none'}),scale=spec.bore/c.bore;
    for(const key of ['rod','pistonHeight','pistonPinOffset','pistonClearance','pistonSkirtWall','pistonCrownThickness','rodWidth','cylinderWall','cylinderSpacing','headHeight'])c[key]*=scale;
    c.bore=spec.bore;c.stroke=spec.stroke;
    return {...sizeForDisplacement(c,displacement(c),{preserveGeometry:true,profile}),...spec};
  }
  function firingOffsets(c) {
    if(c.kind==='rotary')return Array.from({length:chamberCount(c)},(_,i)=>Math.floor(i/3)*360/c.rotorCount+(i%3)*360);
    const n=c.cylinderCount,cycle=cycleDegrees(c),layout=c.layout||'inline',out=Array(n).fill(0);
    if(n===1)return out;
    // Configuration uses physical, 1-based cylinder numbers. This changes
    // the actual chamber cycle, valve motion and combustion timing together,
    // rather than scheduling a different firing rhythm inside the audio.
    if(c.firingOrder){const order=c.firingOrder.split('-').map(Number);for(let i=0;i<n;i++)out[order[i]-1]=i*cycle/n;return out;}
    if(layout==='boxer'&&c.kind==='four'){for(let i=0;i<n;i++)out[i]=Math.floor(i/2)*720/n+(i%2)*360;return out;}
    const order=layout==='radial'&&c.kind==='four'?Array.from({length:n},(_,i)=>(2*i)%n):n===4&&layout==='inline'&&c.kind==='four'?[0,2,3,1]:Array.from({length:n},(_,i)=>i);
    for(let i=0;i<n;i++)out[order[i]]=i*cycle/n;return out;
  }

  function compileGeometry(c){
    const rotary=c.kind==='rotary',r=c.stroke/2,area=PI*c.bore*c.bore/4;
    const swept=rotary?3*Math.sqrt(3)*c.eccentricity*c.rotorRadius*c.rotorWidth:area*c.stroke;
    return {r,rodSquared:c.rod*c.rod,area,swept,clearance:swept/(c.compression-1),rotarySide:2*Math.sqrt(3)*c.rotorRadius*c.rotorWidth};
  }
  function geometryInto(c, angle, out, compiled=null) {
    if(c.kind==='rotary'){
      const swept=compiled?compiled.swept:3*Math.sqrt(3)*c.eccentricity*c.rotorRadius*c.rotorWidth,clearance=compiled?compiled.clearance:swept/(c.compression-1);
      out.volume=clearance+swept/2*(1-Math.cos(2*angle/3));out.dV=swept/3*Math.sin(2*angle/3);
      out.area=out.volume/c.rotorWidth;out.surface=2*out.area+(compiled?compiled.rotarySide:2*Math.sqrt(3)*c.rotorRadius*c.rotorWidth);
      if(!compiled){out.displacement=swept;out.clearance=clearance;out.x=null;out.dx=0;out.crankRadius=c.eccentricity;out.rod=null;}return out;
    }
    const r = compiled?compiled.r:c.stroke / 2, sin = Math.sin(angle), cos = Math.cos(angle);
    const root = Math.sqrt((compiled?compiled.rodSquared:c.rod*c.rod) - r * r * sin * sin);
    const area = compiled?compiled.area:PI * c.bore * c.bore / 4;
    const displacement = compiled?compiled.swept:area*c.stroke, clearance = compiled?compiled.clearance:displacement / (c.compression - 1);
    out.x = r * (1 - cos) + c.rod - root;
    out.dx = r * sin + r * r * sin * cos / root;
    out.volume = clearance + area * out.x;
    out.dV=area*out.dx;
    if(!compiled){out.area = area; out.displacement = displacement; out.clearance = clearance;
      out.crankRadius = r; out.rod = c.rod;}
    return out;
  }
  function geometry(c, angle) {
    const g=geometryInto(c,angle,{});
    if(c.kind==='rotary')return {...g,mechanism:'rotary',chamberAngle:angle,rotorRadius:c.rotorRadius,eccentricity:c.eccentricity,rotorWidth:c.rotorWidth};
    g.clearanceHeight=g.clearance/g.area;
    g.pistonHeight=c.pistonHeight;g.pistonPinOffset=c.pistonPinOffset;
    g.pistonClearance=c.pistonClearance;g.pistonDiameter=c.bore-2*c.pistonClearance;
    g.pistonSkirtWall=c.pistonSkirtWall;g.pistonCrownThickness=c.pistonCrownThickness;
    g.lowerSkirt=c.pistonHeight-c.pistonPinOffset;g.rodWidth=c.rodWidth;
    g.cylinderWall=c.cylinderWall;g.cylinderSpacing=c.cylinderSpacing;g.headHeight=c.headHeight;
    // All axial coordinates point down from the flat-equivalent chamber roof.
    // Geometry is exposed here, outside the allocation-free time-step kernel.
    g.blockHeight=g.crankRadius+c.rod+c.pistonPinOffset+g.clearanceHeight;
    g.crankAxis=g.blockHeight;g.crown=g.clearanceHeight+g.x;
    g.crankEnvelopeRadius=g.crankRadius+c.rodWidth/2+.001*geometryMargins(c).scale;
    g.pin=g.crown+c.pistonPinOffset;
    g.crankPinX=g.crankRadius*Math.sin(angle);g.crankPinY=g.crankAxis-g.crankRadius*Math.cos(angle);
    g.cylinderHeight=g.clearanceHeight+c.stroke+c.pistonHeight+.004*geometryMargins(c).scale;
    return g;
  }
  function liftAt(phase, open, close, maxLift, exponent=2, span=mod(close-open,720)) {
    const elapsed = mod(phase - open, 720);
    if (!span || elapsed >= span) return 0;
    const s = Math.sin(PI * elapsed / span);
    return maxLift * (exponent===2 ? s*s : exponent===4 ? s*s*s*s : Math.pow(s,exponent));
  }
  function valveLifts(c, phase, camPhaser=null) {
    return {intake: liftAt(phase+(camPhaser?.intakeAdvance||0), c.intakeOpen, c.intakeClose, c.valveLift,c.valveProfileExponent),
      exhaust: liftAt(phase+(camPhaser?.exhaustAdvance||0), c.exhaustOpen, c.exhaustClose, c.valveLift,c.valveProfileExponent)};
  }
  // A bounded configuration cache keeps target validation out of the time-step
  // kernel. Every permitted target includes the entire path from neutral, so
  // moving between any two accepted targets cannot bypass an unsafe phase.
  const camClearanceCache=new Map();
  const CAM_CLEARANCE_FIELDS=['kind','bore','stroke','rod','compression','valveLift','valveProfileExponent','intakeOpen','intakeClose','exhaustOpen','exhaustClose'];
  function validateCamTargets(c,targets={}){
    if(!targets||typeof targets!=='object'||Array.isArray(targets))return {ok:false,errors:['Nockenziele müssen ein Objekt sein.'],minClearance:null,requiredClearance:null,stepDegrees:.5};
    const errors=[],values={intake:targets.intakeCamAdvance??0,exhaust:targets.exhaustCamAdvance??0};
    for(const [channel,value] of Object.entries(values))if(!Number.isFinite(value)||value< -40||value>40)errors.push(channel+'CamAdvance: zulässig -40 bis 40 Kurbelgrad.');
    if(errors.length)return {ok:false,errors,minClearance:null,requiredClearance:null,stepDegrees:.5};
    if(c?.kind!=='four'){
      if(values.intake!==0||values.exhaust!==0)errors.push('Nockenverstellung benötigt einen Viertakt-Kolbenmotor.');
      return {ok:errors.length===0,errors,minClearance:null,requiredClearance:null,stepDegrees:.5};
    }
    if(CAM_CLEARANCE_FIELDS.slice(1).some(key=>!Number.isFinite(c[key]))||c.rod<=c.stroke/2||c.compression<=1)
      return {ok:false,errors:['Nockenverstellung benötigt eine gültige Ventil-/Kolbengeometrie.'],minClearance:null,requiredClearance:null,stepDegrees:.5};
    const key=CAM_CLEARANCE_FIELDS.map(field=>c[field]).join('|');let profile=camClearanceCache.get(key);
    if(!profile){
      const crown=new Float64Array(1441),g={},compiled=compileGeometry(c);
      for(let i=0;i<crown.length;i++){geometryInto(c,i*.5*DEG,g,compiled);crown[i]=compiled.clearance/compiled.area+g.x;}
      profile={crown,required:geometryMargins(c).valve};
      if(camClearanceCache.size>=32)camClearanceCache.delete(camClearanceCache.keys().next().value);
      camClearanceCache.set(key,profile);
    }
    const minClearance={intake:Infinity,exhaust:Infinity};
    for(const channel of ['intake','exhaust']){
      const advance=values[channel],lo=Math.min(0,advance),hi=Math.max(0,advance),open=c[channel+'Open'],close=c[channel+'Close'];
      const span=mod(close-open,720),peak=open+span/2;
      for(let i=0;i<profile.crown.length;i++){
        const phase=i*.5;
        const maximum=mod(peak-phase-lo,720)<=hi-lo?c.valveLift:Math.max(
          liftAt(phase+lo,open,close,c.valveLift,c.valveProfileExponent,span),liftAt(phase+hi,open,close,c.valveLift,c.valveProfileExponent,span));
        minClearance[channel]=Math.min(minClearance[channel],profile.crown[i]-maximum);
      }
      if(minClearance[channel]<profile.required)errors.push((channel==='intake'?'Einlass':'Auslass')+'-Nockenverstellung unterschreitet den Ventil-/Kolbenabstand. Verstellung verringern oder Geometrie anpassen.');
    }
    return {ok:errors.length===0,errors,minClearance,requiredClearance:profile.required,stepDegrees:.5};
  }
  function portAreas(c, x) {
    return {transfer: c.transferWidth * clamp(x - c.transferTop, 0, c.transferHeight),
      exhaust: c.exhaustWidth * clamp(x - c.exhaustTop, 0, c.exhaustHeight)};
  }
  function rotaryPortAreas(c,phase){
    const area=(open,close,maximum)=>{const elapsed=mod(phase-open,1080),span=close-open;if(elapsed>=span)return 0;const s=Math.sin(PI*elapsed/span);return maximum*s*s;};
    return {intake:area(c.rotaryIntakeOpen,c.rotaryIntakeClose,c.rotaryIntakeArea),exhaust:area(c.rotaryExhaustOpen,c.rotaryExhaustClose,c.rotaryExhaustArea)};
  }
  function layoutInfo(c){const name=c.layout||'inline';return {layout:name,label:layoutLabel(c),bankCount:c.kind==='rotary'?0:name==='w'?4:name==='v'||name==='boxer'?2:name==='radial'?c.cylinderCount:1,bankAngle:c.bankAngle,counts:layoutCounts(c.kind,name)};}
  function layoutGeometry(c,shaftAngle=0){
    const info=layoutInfo(c),offsets=firingOffsets(c),cylinders=[];
    if(c.kind==='rotary')return {...info,cylinders,rotorCount:c.rotorCount,rotorSpacing:c.rotorSpacing};
    for(let i=0;i<c.cylinderCount;i++){
      const bankIndex=info.layout==='radial'?i:i%info.bankCount,station=info.layout==='radial'?0:Math.floor(i/info.bankCount);
      const axisAngle=info.layout==='radial'?i*TAU/c.cylinderCount:info.layout==='boxer'?(bankIndex?PI/2:-PI/2):info.bankCount>1?(-c.bankAngle/2+bankIndex*c.bankAngle/(info.bankCount-1))*DEG:0;
      const mechanicalAngle=mod(shaftAngle-offsets[i]*DEG,TAU),g=geometry(c,mechanicalAngle),axis={x:Math.sin(axisAngle),y:-Math.cos(axisAngle)};
      const pinRadius=c.rod+c.stroke/2-g.x,point=radius=>({x:axis.x*radius,y:axis.y*radius});
      cylinders.push({index:i,bankIndex,station,axisAngle,axialPosition:i*c.cylinderSpacing,mechanicalAngle,firingOffset:offsets[i],crankPhase:axisAngle-offsets[i]*DEG,
        axis,shaft:{x:0,y:0},crankPin:{x:c.stroke/2*Math.sin(mechanicalAngle+axisAngle),y:-c.stroke/2*Math.cos(mechanicalAngle+axisAngle)},pin:point(pinRadius),crown:point(pinRadius+c.pistonPinOffset),head:point(g.blockHeight)});
    }
    return {...info,cylinders,independentJournals:true,axiallyStaggered:true};
  }
  function rotorProfile(c){const Rr=c.rotorRadius,e=c.eccentricity,amplitude=1.5*Math.sqrt(3)*e*Rr;
    const triangleMean=(PI/3-Math.sqrt(3)/4)*Rr*Rr+PI*e*e,clearanceArea=2*amplitude/(c.compression-1);
    return {bulge:1.5*(triangleMean-amplitude-clearanceArea)/(Math.sqrt(3)*Rr),amplitude,triangleMean,clearanceArea};}
  function rotaryGeometry(c,shaftAngle=0,rotorIndex=0,options={}){
    if(c.kind!=='rotary'||!Number.isInteger(rotorIndex)||rotorIndex<0||rotorIndex>=c.rotorCount)throw new Error('Wankel-Geometrie benötigt einen gültigen Rotor.');
    const segments=clamp(Math.round(options.segments||96),24,720),Rr=c.rotorRadius,e=c.eccentricity,theta=(shaftAngle-rotorIndex*TAU/c.rotorCount)/3+PI/6;
    const eccentricAngle=3*theta,center={x:e*Math.cos(eccentricAngle),y:e*Math.sin(eccentricAngle)},profile=rotorProfile(c);
    const housingAt=t=>({x:Rr*Math.cos(t)+e*Math.cos(3*t),y:Rr*Math.sin(t)+e*Math.sin(3*t)});
    const faceAt=(a,u)=>{const ax=Rr*Math.cos(a),ay=Rr*Math.sin(a),bx=Rr*Math.cos(a+TAU/3),by=Rr*Math.sin(a+TAU/3),bump=4*profile.bulge*u*(1-u);
      return {x:center.x+ax+(bx-ax)*u+Math.cos(a+PI/3)*bump,y:center.y+ay+(by-ay)*u+Math.sin(a+PI/3)*bump};};
    const housing=[],housingOuter=[],rotor=[],apices=[],chambers=[];
    for(let j=0;j<=segments*3;j++){const a=j*TAU/(segments*3),p=housingAt(a),dx=-Rr*Math.sin(a)-3*e*Math.sin(3*a),dy=Rr*Math.cos(a)+3*e*Math.cos(3*a),length=Math.hypot(dx,dy);housing.push(p);housingOuter.push({x:p.x+c.rotaryHousingWall*dy/length,y:p.y-c.rotaryHousingWall*dx/length});}
    for(let f=0;f<3;f++)for(let j=0;j<segments;j++)rotor.push(faceAt(theta+f*TAU/3,j/segments));rotor.push({...rotor[0]});
    for(let f=0;f<3;f++){
      const a=theta-f*TAU/3,phase=mod(shaftAngle/DEG-rotorIndex*360/c.rotorCount-f*360,1080),g=geometry(c,phase*DEG),ports=rotaryPortAreas(c,phase),path=[];
      const apex=faceAt(a,0);apices.push(apex);
      for(let j=0;j<=segments;j++)path.push(housingAt(a+j*TAU/(3*segments)));
      for(let j=segments;j>=0;j--)path.push(faceAt(a,j/segments));path.push({...path[0]});
      chambers.push({index:rotorIndex*3+f,rotorIndex,faceIndex:f,path,area:g.volume/c.rotorWidth,volume:g.volume,dV:g.dV,phase,areaIn:ports.intake,areaEx:ports.exhaust});
    }
    const ports={};for(const name of ['intake','exhaust']){const cap=name[0].toUpperCase()+name.slice(1),open=c['rotary'+cap+'Open'],close=c['rotary'+cap+'Close'],a=(open+close)/2*DEG/3+PI/2,p=housingAt(a),length=Math.hypot(p.x,p.y);
      ports[name]={type:'side',equivalent:true,position:{x:p.x*.97,y:p.y*.97},normal:{x:p.x/length,y:p.y/length},areaMax:c['rotary'+cap+'Area'],open,close,areas:chambers.map(z=>name==='intake'?z.areaIn:z.areaEx)};}
    return {rotorIndex,shaft:{x:0,y:0},axialPosition:rotorIndex*c.rotorSpacing,center,rotorAngle:theta,eccentricAngle,housing,housingOuter,rotor,apices,chambers,ports,ignition:{position:housingAt(PI/2),normal:{x:0,y:1}},rotorWidth:c.rotorWidth,sidePlate:c.rotarySidePlate,profile};
  }
  const rotaryMotionCache=new Map();
  function rotaryMotionCheck(c,step){
    const keys=['rotorRadius','eccentricity','rotorWidth','rotorSpacing','rotaryHousingWall','rotarySidePlate','compression'];
    if(keys.some(k=>!Number.isFinite(c[k]))||c.rotorRadius<=3*c.eccentricity||c.eccentricity<=0||c.compression<=1)
      return {ok:false,errors:['Endliche Wankelgeometrie mit R > 3e und positiver Verdichtung erforderlich.'],diagnostics:[],metrics:null,samples:0};
    const key=keys.map(k=>c[k]).join(',')+','+step;let cached=rotaryMotionCache.get(key);
    if(cached)return cached;
    const errors=[],diagnostics=[],Rr=c.rotorRadius,e=c.eccentricity,p=rotorProfile(c);let minGap=Infinity;
    const issue=(code,message,actual,required,fields)=>{errors.push(message);diagnostics.push({code,message,actual,required,fields});};
    if(c.rotorSpacing<c.rotorWidth+2*c.rotarySidePlate+.001)issue('rotor_spacing','Rotorabstand muss Rotorbreite, zwei Seitenplatten und 1 mm Zwischenraum aufnehmen.',c.rotorSpacing,c.rotorWidth+2*c.rotarySidePlate+.001,['rotorSpacing','rotorWidth','rotarySidePlate']);
    // Rigid parabolic flanks are checked against the same epitrochoid used by
    // the renderer. Apex contact is intentional; the sampled flank must remain inside.
    const angles=Math.ceil(1080/step);
    for(let j=0;j<angles;j++){
      const a=j*TAU/angles,cx=e*Math.cos(3*a),cy=e*Math.sin(3*a),ax=Rr*Math.cos(a),ay=Rr*Math.sin(a),bx=Rr*Math.cos(a+TAU/3),by=Rr*Math.sin(a+TAU/3);
      for(let k=1;k<24;k++){
        const u=k/24,bump=4*p.bulge*u*(1-u),x=cx+ax+(bx-ax)*u+Math.cos(a+PI/3)*bump,y=cy+ay+(by-ay)*u+Math.sin(a+PI/3)*bump,phi=Math.atan2(y,x);let t=phi;
        for(let it=0;it<6;it++){const hx=Rr*Math.cos(t)+e*Math.cos(3*t),hy=Rr*Math.sin(t)+e*Math.sin(3*t),err=mod(Math.atan2(hy,hx)-phi+PI,TAU)-PI,den=Rr*Rr+e*e+2*Rr*e*Math.cos(2*t);t-=err*den/(Rr*Rr+3*e*e+4*Rr*e*Math.cos(2*t));}
        minGap=Math.min(minGap,Math.hypot(Rr*Math.cos(t)+e*Math.cos(3*t),Rr*Math.sin(t)+e*Math.sin(3*t))-Math.hypot(x,y));
      }
    }
    if(minGap< -1e-7)issue('rotor_housing','Die starre Rotorflanke schneidet das Trochoidengehäuse. R/e oder Verdichtung ändern.',minGap,0,['rotorRadius','eccentricity','compression']);
    if(Rr/2+p.bulge<2*e+.002)issue('rotor_hub','Rotorflanke lässt zu wenig Raum für die Exzenterhülle.',Rr/2+p.bulge,2*e+.002,['rotorRadius','eccentricity','compression']);
    const g=geometry(c,0);cached={ok:errors.length===0,errors,diagnostics,metrics:{minFlankClearance:minGap,apexContactError:0,rotorBulge:p.bulge,clearanceVolume:g.clearance,displacement:g.displacement,compression:c.compression,flankSubdivisions:24,rotorStepDegrees:360/angles},samples:angles*23,stepDegrees:1080/angles};
    rotaryMotionCache.set(key,cached);if(rotaryMotionCache.size>64)rotaryMotionCache.delete(rotaryMotionCache.keys().next().value);return cached;
  }

  function motionCheck(c, options={}) {
    const step=options.stepDegrees===undefined?.5:options.stepDegrees;
    if (!(step>=.05&&step<=5) || !Number.isFinite(step))
      throw new Error('Bewegungsprüfung: Winkelschritt 0,05 bis 5 Grad erforderlich.');
    if(c?.kind==='rotary')return rotaryMotionCheck(c,step);
    const errors=[],diagnostics=[];
    const issue=(code,fields,message,actual,required,angleDegrees=null)=>{
      errors.push(message);diagnostics.push({code,fields,message,actual,required,angleDegrees});
    };
    const keys=['bore','stroke','rod','compression','pistonHeight','pistonPinOffset','pistonClearance',
      'pistonSkirtWall','pistonCrownThickness','rodWidth','cylinderWall','cylinderSpacing','headHeight'];
    if(c&&c.kind==='two')keys.push('transferTop','transferHeight','exhaustTop','exhaustHeight');
    else keys.push('valveLift','valveProfileExponent','intakeOpen','intakeClose','exhaustOpen','exhaustClose');
    if(!c||keys.some(k=>!Number.isFinite(c[k]))||c.rod<=c.stroke/2||c.compression<=1)
      return {ok:false,errors:['Bewegungsprüfung benötigt endliche, kinematisch mögliche Geometrie.'],diagnostics:[],metrics:null,samples:0};
    const g0=geometry(c,0),margin=geometryMargins(c),lower=g0.lowerSkirt,inner=g0.pistonDiameter/2-c.pistonSkirtWall;
    const root=Math.sqrt(c.rod*c.rod-g0.crankRadius*g0.crankRadius);
    const rodEnvelope=g0.crankRadius/root*lower+c.rodWidth/2*c.rod/root;
    const crankGap=c.rod-g0.crankRadius-lower-g0.crankEnvelopeRadius;
    const metrics={blockHeight:g0.blockHeight,cylinderHeight:g0.cylinderHeight,clearanceVolume:g0.clearance,
      pistonDiameter:g0.pistonDiameter,minRodSkirtClearance:inner-rodEnvelope,
      minCrankSkirtClearance:crankGap,minHeadClearance:g0.clearanceHeight,
      minValveClearance:Infinity,minValveClearanceAngle:null,maxRodLengthError:0,
      cylinderWeb:c.cylinderSpacing-c.bore-2*c.cylinderWall};
    if(c.pistonPinOffset-c.pistonCrownThickness<c.rodWidth/2+margin.pin)
      issue('pin_crown',['pistonPinOffset','pistonCrownThickness','rodWidth'],'Kolbenbolzen/Pleuelhülle benötigt geometrischen Freigang unter der Kolbenkrone.',c.pistonPinOffset-c.pistonCrownThickness-c.rodWidth/2,margin.pin);
    if(lower<c.rodWidth/2+margin.pin)
      issue('pin_skirt',['pistonHeight','pistonPinOffset','rodWidth'],'Kolbenbolzen liegt zu nahe am unteren Hemdende.',lower-c.rodWidth/2,margin.pin);
    if(metrics.minRodSkirtClearance<margin.rod)
      issue('rod_skirt',['bore','pistonClearance','pistonSkirtWall','pistonHeight','pistonPinOffset','rodWidth','rod','stroke'],
        'Pleuelhülle berührt den erforderlichen Freiraum des Kolbenhemds.',metrics.minRodSkirtClearance,margin.rod,90);
    if(crankGap<margin.crank)
      issue('crank_skirt',['rod','stroke','pistonHeight','pistonPinOffset','rodWidth'],
        'Kolbenhemd berührt den Freiraum der konservativen Kurbelhülle.',crankGap,margin.crank,180);
    if(c.cylinderSpacing<c.bore+2*c.cylinderWall+margin.web-1e-12)
      issue('cylinder_spacing',['cylinderSpacing','bore','cylinderWall'],'Zylinderachsabstand benötigt Bohrung, zwei Wände und einen positiven Zwischenraum.',metrics.cylinderWeb,margin.web);
    if(c.headHeight<c.cylinderWall+margin.head)
      issue('head_wall',['headHeight','cylinderWall'],'Kopf benötigt Wanddicke plus modellierten Kanal-/Deckelraum.',c.headHeight-c.cylinderWall,margin.head);
    if(c.kind==='two'){
      const covered=Math.max(c.exhaustTop+c.exhaustHeight,c.transferTop+c.transferHeight);
      metrics.portSkirtOverlap=c.pistonHeight-covered;
      if(metrics.portSkirtOverlap<margin.port-1e-12)
        issue('port_skirt',['pistonHeight','exhaustTop','exhaustHeight','transferTop','transferHeight'],
          'Das Kolbenhemd muss bei OT beide Ports mit positiver Überdeckung verschließen.',metrics.portSkirtOverlap,margin.port,0);
      // A measurable geometric value, separate from the compression entered at
      // BDC. Exhaust closure fixes the trapped volume of this ideal piston port.
      metrics.effectiveCompression=(g0.clearance+g0.area*c.exhaustTop)/g0.clearance;
    }
    const cycle=c.kind==='two'?360:720,samples=Math.ceil(cycle/step);
    for(let i=0;i<=samples;i++){
      const degrees=cycle*i/samples,g=geometry(c,degrees*DEG);
      metrics.maxRodLengthError=Math.max(metrics.maxRodLengthError,Math.abs(Math.hypot(g.crankPinX,g.crankPinY-g.pin)-c.rod));
      if(c.kind!=='two'){
        const v=valveLifts(c,degrees),gap=g.crown-Math.max(v.intake,v.exhaust);
        if(gap<metrics.minValveClearance){metrics.minValveClearance=gap;metrics.minValveClearanceAngle=degrees;}
      }
    }
    if(c.kind==='two')metrics.minValveClearance=null;
    else if(metrics.minValveClearance<margin.valve)
      issue('valve_piston',['valveLift','valveProfileExponent','intakeOpen','intakeClose','exhaustOpen','exhaustClose','compression','stroke'],
        'Ventil und Kolben unterschreiten den erforderlichen geometrischen Abstand bei '+metrics.minValveClearanceAngle+' Grad.',metrics.minValveClearance,margin.valve,metrics.minValveClearanceAngle);
    return {ok:errors.length===0,errors,diagnostics,metrics,samples:samples+1,stepDegrees:cycle/samples};
  }

  function parameterLimits(c={}) {
    return {
      bore: [.012, .300], stroke: [.008, .400], rod: [.012, 1.2], compression: c.combustion === 'diesel' ? [10,30] : [3,20],
      pistonHeight:[.002,1],pistonPinOffset:[.0005,.8],pistonClearance:[.000001,.004],
      pistonSkirtWall:[.0002,.10],pistonCrownThickness:[.0002,.15],rodWidth:[.0005,.15],
      cylinderWall:[.0005,.15],cylinderSpacing:[.015,1],headHeight:[.002,.30],
      valveProfileExponent:[1.5,6],camPhaserRate:[1,720],valvesPerPort:[1,3],timingCrankTeeth:[6,80],intakeCd:[.05,1],exhaustCd:[.05,1],transferCd:[.05,1],reedCd:[.05,1],throttleCd:[.05,1],
      reedCrackPressure:[0,10000],reedFullOpenPressure:[1,100000],heatTransferScale:[0,10],
      inertia: [.000001, 100], frictionBase: [0, 1000], frictionViscous: [0, 10],frictionWindage:[0,1],bearingWear: [0, 1],
      intakeArea: [.0000001, .5], intakeVolume: [.0000001, 1], intakeLength: [.005, 10],
      intakeDiameter: [.001, 1], exhaustLength: [.02, 15], exhaustDiameter: [.001, 1],
      exhaustDamping: [0, 1], ambientP: [20000, 200000], ambientT: [200, 380], wallT: [200, 1000],
      burnDuration: [5,180], combustionEfficiency: [.1,1],
      idleRpm: [200,6000], idleMax: [.001,1], redlineRpm: [300,30000],revLimitRpm:[0,30000],
      starterTorque:[.01,10000],starterNoLoadRpm:[50,10000],
      injectionAdvance: [-20,50], injectionDuration: [1,100], maxFuelPerCycle: [1e-9,.01],
      dieselMinLambda: [1,5], dieselMixTime: [.00005,.020],
      boostVolume: [.000001,1], compressorArea: [.0000001,.5], compressorEfficiency: [.1,.95],
      boostTarget: [0,500000], intercoolerEfficiency: [0,.99],
      turboCount:[1,2],turboInertia: [1e-9,.1], turboDesignRpm: [10000,350000], turboMaxPressureRatio: [1.01,8],
      turboMaxFlow: [.00001,20], turbineArea: [.0000001,.3], turbineEfficiency: [.1,.95],
      turboRadius: [.002,.30], turboFriction: [0,.01], wastegateArea: [0,.3],
      superchargerRatio: [.1,8], superchargerDisplacement: [.0000001,.2], superchargerFriction: [0,100],
      bypassArea: [0,.5],compressorDuctLength:[.01,10],turboSurgeFlowFraction:[.10,.6],bypassResponseTime:[.0001,.5],rotorCount:[1,4],bankAngle:[0,180],
      rotorRadius:[.020,.50],eccentricity:[.002,.10],rotorWidth:[.005,.40],rotorSpacing:[.012,1],rotaryHousingWall:[.0005,.10],rotarySidePlate:[.0005,.10],
      rotaryIntakeArea:[.0000001,.1],rotaryExhaustArea:[.0000001,.1],rotaryIntakeOpen:[400,700],rotaryIntakeClose:[700,1050],rotaryExhaustOpen:[100,450],rotaryExhaustClose:[450,750]
    };
  }

  function validate(input) {
    const errors = [];
    if (!input || typeof input !== 'object' || Array.isArray(input))
      return {ok: false, errors: ['Konfiguration muss ein JSON-Objekt sein.'], config: null};
    if (input.kind !== undefined && !['two','four','twin','rotary'].includes(input.kind))
      errors.push('Grundbauart muss two, four oder rotary sein.');
    const legacy = input.kind === 'twin';
    const preset = input.kind === 'two' ? 'two' : input.combustion === 'diesel' ? 'diesel' :
      (legacy || input.cylinderCount === 2) ? 'twin' : input.cylinderCount === 1 ? 'single4' : 'i4';
    const base=input.kind==='rotary'?familyDefaults({kind:'rotary',rotorCount:input.rotorCount??1}):defaults(preset),c = {...base, ...input};
    for(const key of Object.keys(input))if(key!=='firingOrder'&&!Object.prototype.hasOwnProperty.call(base,key))errors.push('Unbekannter Parameter: '+key);
    if (legacy) { c.kind = 'four'; c.cylinderCount = 2; }
    if(input.starterTorque===undefined)c.starterTorque=c.kind==='two'?6*c.cylinderCount:c.kind==='rotary'?100*c.rotorCount:c.cylinderCount>=3?(c.combustion==='diesel'?220:150)*c.cylinderCount/4:c.cylinderCount===2?(c.combustion==='diesel'?65:21):(c.combustion==='diesel'?35:12);
    if(input.starterNoLoadRpm===undefined)c.starterNoLoadRpm=(c.kind==='rotary'||c.kind!=='two'&&c.cylinderCount>=3?95:190)*60/TAU;
    if(input.frictionWindage===undefined)c.frictionWindage=c.kind==='two'?1e-6*c.cylinderCount:c.kind==='rotary'?2.3e-6*c.rotorCount:1.15e-6*c.cylinderCount;
    if (!['otto','diesel'].includes(c.combustion)) errors.push('Verbrennung muss otto oder diesel sein.');
    if (!['none','turbo','supercharger'].includes(c.boost)) errors.push('Aufladung ungültig.');
    if(!['ideal','chain','belt','gear'].includes(c.timingDrive))errors.push('Nockenantrieb: ideal, chain, belt oder gear erforderlich.');
    if(!Number.isInteger(c.timingCrankTeeth))errors.push('Effektive Zahnzahl am Steuerkettenrad muss ganzzahlig sein.');
    if(![1,2].includes(c.turboCount))errors.push('Turboladeranzahl: 1 oder 2 parallele Lader.');
    if(!['inline','v','boxer','w','radial'].includes(c.layout))errors.push('Anordnung muss inline, v, boxer, w oder radial sein.');
    if(c.kind==='rotary'){
      if(c.cylinderCount!==0)errors.push('Wankel besitzt keine Kolbenzylinder: cylinderCount muss 0 sein.');
      if(![1,2,3,4].includes(c.rotorCount)||c.layout!=='inline')errors.push('Wankel: 1 bis 4 axial angeordnete Rotoren.');
      if(c.combustion!=='otto')errors.push('Wankel benötigt in diesem Modell Fremdzündung (Otto).');
    }else if(!layoutCounts(c.kind,c.layout).includes(c.cylinderCount))errors.push('Zylinderzahl passt nicht zur unterstützten Anordnung.');
    if(Object.prototype.hasOwnProperty.call(c,'firingOrder')){
      const value=c.firingOrder;
      if(typeof value!=='string')errors.push('Zündfolge: Zeichenfolge wie 1-3-4-2 oder leer für die bisherige Reihenfolge erforderlich.');
      else if(value!==''){
        const order=/^[1-9]\d*(?:-[1-9]\d*)*$/.test(value)?value.split('-').map(Number):[];
        if(c.kind==='rotary'||order.length!==c.cylinderCount||new Set(order).size!==c.cylinderCount||order.some(x=>!Number.isInteger(x)||x<1||x>c.cylinderCount))
          errors.push('Zündfolge muss jeden vorhandenen Kolbenzylinder genau einmal mit Nummern von 1 bis zur Zylinderzahl enthalten. Wankel verwendet seine feste Kammerfolge.');
      }
    }
    if (c.kind === 'two' && (c.combustion !== 'otto' || c.boost !== 'none'))
      errors.push('Kurbelgehäusegespülter Zweitakt unterstützt Otto ohne zusätzliche Aufladung.');
    const fuel=fuelProperties(c);if(!fuel)errors.push('Unbekannter Kraftstoff.');else if(fuel.combustion!==c.combustion)errors.push(fuel.label+' passt nicht zum gewählten Zündverfahren.');
    if(c.layout==='v'&&!(c.bankAngle>=20&&c.bankAngle<=160))errors.push('V-Bankwinkel: 20 bis 160 Grad.');
    if(c.layout==='w'&&!(c.bankAngle>=40&&c.bankAngle<=140))errors.push('W-Außenbankwinkel: 40 bis 140 Grad.');
    if(c.layout==='boxer'&&c.bankAngle!==180)errors.push('Boxeranordnung benötigt 180 Grad Bankwinkel.');
    if(typeof c.modelId!=='string'||c.modelId.length>48||c.modelId!==''&&!MODEL_IDS.includes(c.modelId))errors.push('Modellbezug muss leer oder eine bekannte Modell-ID sein.');
    const strings = new Set(['kind','combustion','boost','layout','fuelType','modelId','timingDrive','firingOrder']), booleans = new Set(['idleEnabled','intercoolerEnabled','autoBypassEnabled','redlineEnabled','revLimiterEnabled']);
    for (const key of Object.keys(c)) {
      if (strings.has(key)) continue;
      if (booleans.has(key)) { if (typeof c[key] !== 'boolean') errors.push(key + ': Wahrheitswert erforderlich.'); }
      else if (!Number.isFinite(c[key]) || typeof c[key] !== 'number') errors.push(key + ': endliche Zahl erforderlich.');
    }
    const ranges=parameterLimits(c);
    for (const [k, [lo, hi]] of Object.entries(ranges))
      if (c[k] < lo || c[k] > hi) errors.push(k + ': zulässig ' + lo + ' bis ' + hi + ' (SI).');
    if(![1,2,3].includes(c.valvesPerPort))errors.push('Ventilanzahl je Ein-/Auslass: 1, 2 oder 3.');
    if (c.kind!=='rotary'&&c.rod <= c.stroke / 2) errors.push('Pleuel muss länger als der Kurbelradius sein.');
    if(c.reedFullOpenPressure<=c.reedCrackPressure)errors.push('Volle Membranöffnung benötigt mehr Druckdifferenz als der Öffnungsbeginn.');
    if (c.kind === 'two') {
      if (!(c.crankcaseRatio > 1 && c.crankcaseRatio <= 5)) errors.push('Kurbelgehäuse-Verhältnis: größer als 1 und höchstens 5.');
      if (!(c.reedArea > 0 && c.reedArea <= .1)) errors.push('Membranfläche: größer 0 und höchstens 0,1 m².');
      for (const name of ['transfer', 'exhaust']) {
        if (!(c[name + 'Top'] > 0 && c[name + 'Top'] < c.stroke))
          errors.push(name + ': Portoberkante muss innerhalb des Hubs liegen.');
        if (!(c[name + 'Height'] > 0 && c[name + 'Top'] + c[name + 'Height'] <= c.stroke + 1e-12))
          errors.push(name + ': Porthöhe muss positiv sein und bis UT in den Hub passen.');
        if (!(c[name + 'Width'] > 0 && c[name + 'Width'] < PI * c.bore * .7))
          errors.push(name + ': äquivalente Portbreite ist unzulässig.');
      }
      if (c.transferTop <= c.exhaustTop) errors.push('Überströmer müssen später als der Auslass öffnen.');
    } else if(c.kind!=='rotary') {
      if (!(c.valveDiameter > .001 && c.valveDiameter <= .44 * c.bore)) errors.push('Ventildurchmesser: größer 1 mm und höchstens 44 % der Bohrung für die zwei modellierten Ventile.');
      if (!(c.valveLift > .0001 && c.valveLift <= .5 * c.valveDiameter)) errors.push('Ventilhub: größer 0,1 mm und höchstens halber Ventildurchmesser.');
      const timingRanges = {intakeOpen: [240, 450], intakeClose: [450, 700], exhaustOpen: [30, 270], exhaustClose: [270, 450]};
      for (const [k, [lo, hi]] of Object.entries(timingRanges))
        if (c[k] < lo || c[k] > hi) errors.push(k + ': zulässig ' + lo + ' bis ' + hi + ' Grad.');
    }
    if(c.kind==='rotary'&&(c.rotaryIntakeClose<=c.rotaryIntakeOpen||c.rotaryExhaustClose<=c.rotaryExhaustOpen))errors.push('Seitenport-Schließen muss nach dem Öffnen liegen.');
    const rpm=rpmSettings(c);
    if(rpm.redlineEnabled&&c.idleRpm>=rpm.redlineRpm)errors.push('Leerlauf muss unter der eingeschalteten Redline-Markierung liegen.');
    if(rpm.revLimiterEnabled&&c.idleRpm>=rpm.limitRpm)errors.push('Leerlauf muss unter der eingeschalteten Abschaltdrehzahl liegen.');
    const motion=errors.length===0?motionCheck(c):null;
    if(motion&&!motion.ok)errors.push(...motion.errors);
    return {ok: errors.length === 0, errors, config: c, motion};
  }

  // A calorically perfect pseudo-mixture. Air is fresh oxygen-bearing air;
  // burned is inert product gas. Chemical energy is separate from sensible U.
  function gas(volume, p, T, fresh = true) {
    const m = p * volume / (R * T);
    return {volume, p, T, m, air: fresh ? m : 0, fuel: 0, burned: fresh ? 0 : m,
      U: m * CV * T, dm: 0, dAir: 0, dFuel: 0, dBurned: 0, dU: 0, outMass: 0};
  }
  function refresh(g) {
    g.m = g.air + g.fuel + g.burned;
    g.T = g.U / (CV * g.m);
    g.p = (GAMMA - 1) * g.U / g.volume;
  }
  function adiabatic(g, nextVolume, refreshStationary=false) {
    if (g.volume === nextVolume) {if(refreshStationary)refresh(g);return 0;}
    const before = g.U;
    g.U *= Math.pow(g.volume / nextVolume, GAMMA - 1);
    g.volume = nextVolume;
    refresh(g);
    return before - g.U;
  }
  function flowRate(a, b, area, cd = .72) {
    if (!(area > 0) || a.p === b.p) return 0;
    const positive = a.p > b.p, u = positive ? a : b, d = positive ? b : a;
    const ratio = d.p / u.p;
    let factor;
    if (ratio <= CRITICAL) factor = CHOKED;
    else {const root=Math.pow(ratio,1/GAMMA);
      factor=Math.sqrt(Math.max(0,2*GAMMA/(GAMMA-1)*root*(root-ratio)));}
    const rate = cd * area * u.p / Math.sqrt(R * u.T) * factor;
    return positive ? rate : -rate;
  }
  function copyGas(g) {
    return {p: g.p, T: g.T, m: g.m, fuel: g.fuel, air: g.air, burned: g.burned,
      volume: g.volume, U: g.U};
  }
  // Configuration is fixed for an Engine instance. These values contain no
  // dynamic state and are rebuilt after restore instead of bloating saves.
  function compileEngine(c,offsets){
    const rho=c.ambientP/(R*c.ambientT);
    // Acoustic-only secondary-motion estimate. A hollow aluminium crown/skirt
    // and one third of a steel rod provide a declared mass approximation.
    // This mass never replaces the authored crankshaft inertia.
    const pistonRadius=Math.max(.0001,(c.bore-2*c.pistonClearance)/2);
    const skirtInner=Math.max(0,pistonRadius-c.pistonSkirtWall);
    const pistonMass=2700*PI*(pistonRadius*pistonRadius*c.pistonCrownThickness+
      (pistonRadius*pistonRadius-skirtInner*skirtInner)*Math.max(0,c.pistonHeight-c.pistonCrownThickness));
    return {geometry:compileGeometry(c),offsetRadians:offsets.map(offset=>offset*DEG),
      acousticPistonMass:Math.max(.001,pistonMass),
      acousticReciprocatingMass:Math.max(.001,pistonMass+7800*c.rod*c.rodWidth*c.rodWidth*.18/3),
      // Effective valve spring values, not manufacturer-calibrated springs.
      acousticValveStiffness:30000*c.valveDiameter/.032,
      acousticValvePreload:120*(c.valveDiameter/.032)**2,
      throttleArea:Math.min(c.intakeArea,PI*c.intakeDiameter**2/4),
      throttleResistance:Math.sqrt(1+.025*c.intakeLength/c.intakeDiameter),
      tailArea:PI*c.exhaustDiameter**2/4/Math.sqrt(1.5+10*c.exhaustDamping**2+.025*c.exhaustLength/c.exhaustDiameter),
      seat:PI*c.valveDiameter**2/4,valveCircumference:PI*c.valveDiameter,
      intakeSpan:mod(c.intakeClose-c.intakeOpen,720),exhaustSpan:mod(c.exhaustClose-c.exhaustOpen,720),
      rotaryIntakeSpan:c.rotaryIntakeClose-c.rotaryIntakeOpen,rotaryExhaustSpan:c.rotaryExhaustClose-c.rotaryExhaustOpen,
      boostReliefRange:Math.max(15000,.25*c.ambientP),turboDesignOmega:c.turboDesignRpm*TAU/60,
      ambientEnthalpy:CP*c.ambientT,compressorTemperatureScale:Math.sqrt(293.15/c.ambientT),
      compressorDrag:(1+.03*c.compressorDuctLength/Math.sqrt(4*c.compressorArea/PI))/(2*rho*rho*c.compressorArea*c.compressorArea),
      starterNoLoadOmega:c.starterNoLoadRpm*TAU/60,boreCircumference:PI*c.bore,
      intakeHeat:1.2*c.heatTransferScale,exhaustHeat:(2.8+3*c.exhaustLength)*c.heatTransferScale,
      crankcaseHeat:1.8*c.heatTransferScale,crankcaseWall:Math.min(c.wallT,350)};
  }

  class Engine {
    constructor(config = defaults('two'), options = {}) {
      const v = validate(config); if (!v.ok) throw new Error(v.errors.join('\n'));
      const c = this.config = v.config;
      this.dt = options.dt || DT;
      this.count = chamberCount(c); this.two = c.kind === 'two'; this.rotary=c.kind==='rotary'; this.diesel = c.combustion === 'diesel';
      this.offsets = firingOffsets(c);this.cycleDegrees=cycleDegrees(c);this.cycleRadians=this.cycleDegrees*DEG;
      Object.defineProperty(this,'_compiled',{value:compileEngine(c,this.offsets),writable:true});
      // Recomputed derived values only; no state or checkpoint fields are added.
      Object.defineProperty(this,'_derivedCache',{value:{dt:0,idleResponse:0,valveDecay:1,throttle:NaN,throttleArea:0}});
      this.fuel=fuelProperties(c);this.afr=this.fuel.afr;this.lhv=this.fuel.lhv;
      this.controls = {throttle:0,load:0,fuel:true,lambdaTarget:1,ignition:true,advance:20,
        injectionAdvance:c.injectionAdvance,starter:false,cylinders:Array(this.count).fill(true),wastegate:0,bypass:0,
        boostTarget:c.boostTarget,intakeCamAdvance:0,exhaustCamAdvance:0};
      this.camPhaser={intakeAdvance:0,exhaustAdvance:0};
      this.time=0;this.angle=0;this.omega=0;this.rpm=0;this._starterUntil=null;this.warning=null;this.events=[];
      this.torque=0;this.brakeTorque=0;this.meanTorque=0;this.power=0;
      this.frictionTorque=0;this.starterTorque=0;this.loadTorque=0;this.superchargerTorque=0;
      this.cycleReady=false;this.revCut=false;this.idleIntegral=0;this._idleRpm=0;
      this.idle={demand:0,effectiveThrottle:0,effectiveFuel:0,targetRpm:c.idleRpm};
      this._geoms=this.offsets.map(o=>geometry(c,-o*DEG));
      this._mids=this._geoms.map(g=>({...g}));this._nexts=this._geoms.map(g=>({...g}));
      this._geom=this._geoms[0];
      this.acousticState=acousticState(c,this.count);
      const swept=displacement(c)*(this.rotary?2:1);
      const intakeV=c.intakeVolume+PI*c.intakeDiameter**2*c.intakeLength/4;
      const pipeV=PI*c.exhaustDiameter**2*c.exhaustLength/4+1.5*swept;
      this.ambient={p:c.ambientP,T:c.ambientT,m:Infinity,air:1,fuel:0,burned:0,volume:Infinity};
      this.intake=gas(intakeV,c.ambientP,c.ambientT);
      this.exhaust=gas(c.boost==='turbo'?Math.max(.00012,.45*swept):pipeV,c.ambientP,c.ambientT,false);
      this.charge=c.boost!=='none'?gas(c.boostVolume,c.ambientP,c.ambientT):null;
      this.tailpipe=c.boost==='turbo'?gas(pipeV,c.ambientP,c.ambientT,false):null;
      this.cyl=this._geoms.map((g,i)=>Object.assign(gas(g.volume,c.ambientP,c.ambientT),{
        x:g.x,phase:mod(-this.offsets[i],this.cycleDegrees),mechanicalAngle:mod(-this.offsets[i]*DEG,this.rotary?this.cycleRadians:TAU),rotorIndex:this.rotary?Math.floor(i/3):null,faceIndex:this.rotary?i%3:null,
        liftIn:0,liftEx:0,areaIn:0,areaEx:0,burn:0,burning:false,events:0,heatTotal:0,
        lastSparkTime:-1e6,lastSparkAngle:0,lastBurnTime:-1e6,spark:false,lastSparkCycle:-1e9,
        combustionState:null,sparkOpportunities:0,injection:false,injectionRate:0,lastInjectionTime:-1e6,
        lastInjectionAngle:0,injectionState:null,injectionIntegral:0,dieselBurn:false,dieselEventFuel:0,
        dieselBurnedFuel:0,injectionEvents:0,lastIgnitionDelay:null
      }));
      this.ccMax=this._geom.displacement*c.crankcaseRatio/(c.crankcaseRatio-1);
      this.crankcases=this.two?this._geoms.map(g=>gas(this.ccMax-g.area*g.x,c.ambientP,c.ambientT)):[];this.crankcase=this.crankcases[0]||null;
      this.rooms=[this.intake,this.exhaust,...this.cyl];
      this.rooms.push(...this.crankcases);
      if(this.charge)this.rooms.push(this.charge);if(this.tailpipe)this.rooms.push(this.tailpipe);
      this.flows={air:0,fuel:0,intake:Array(this.count).fill(0),exhaust:Array(this.count).fill(0),
        transfer:0,reed:0,transfers:Array(this.two?this.count:0).fill(0),reeds:Array(this.two?this.count:0).fill(0),tailpipe:0,compressor:0,bypass:0,turbine:0,wastegate:0,compressorLeak:0};
      this.portsByCylinder=Array.from({length:this.two?this.count:0},()=>({transfer:0,exhaust:0}));this.ports=this.portsByCylinder[0]||{transfer:0,exhaust:0};this.reedOpening=0;this.reedOpenings=Array(this.two?this.count:0).fill(0);
      this.boost={kind:c.boost,omega:0,rpm:0,angle:0,energy:0,compressorFlow:0,turbineFlow:0,
        wastegateFlow:0,bypassFlow:0,compressorPower:0,turbinePower:0,shaftPower:0,
        wastegateOpening:0,bypassOpening:0,chargePressure:c.ambientP,chargeTemperature:c.ambientT,
        boostPressure:0,warning:null,compressorFlowState:0,compressorInertialEnergy:0,
        compressorPressureRise:0,compressorMapPressureRise:0,surgeActive:false,surgeEvents:0,lastSurgeTime:-1e6,surgeIntensity:0};
      // Keep the established single-machine state and arithmetic intact. Only
      // an actual parallel pair owns separate physical branch states.
      Object.defineProperty(this,'_turboBranches',{value:c.boost==='turbo'&&c.turboCount===2?[]:null});
      if(this._turboBranches)this.boost.units=[{...this.boost,surge:0,surgeFlow:0},{...this.boost,surge:0,surgeFlow:0}];
      this._compressorRho=c.ambientP/(R*c.ambientT);this._compressorInertance=c.compressorDuctLength/(this._compressorRho*c.compressorArea);
      this._initialDuctEnergy=0;this._compressorMap={};
      this.signal={exhaustFlow:0,intakeFlow:0,exhaustPressure:c.ambientP,intakePressure:c.ambientP,
        exhaustTemp:c.ambientT,intakeTemp:c.ambientT,combustion:0,structure:0,valve:0,bearing:0,
        manifoldPressure:c.ambientP,manifoldTemp:c.ambientT,manifoldFlow:0,mechanics:mechanicsSignal(c),
        rpm:0,load:0,throttle:0,boosterRpm:0,compressorFlow:0,turbineFlow:0,bypassFlow:0,
        compressorPower:0,turboRpm:0,superchargerRpm:0,injection:0,time:0,angle:0,dt:0,
        boostAngle:0,boostRpm:0,ambientPressure:c.ambientP,chargePressure:c.ambientP,compressorPressureRise:0,
        surge:0,surgeFlow:0,bypassOpening:0,wastegateFlow:0,wastegateOpening:0,turbinePower:0,
        heatReleaseRates:Array(this.count).fill(0),heatPressureRates:Array(this.count).fill(0),valveImpulses:Array(this.count).fill(0),
        exhaustMomentumFluxes:Array(this.count).fill(0),exhaustMomentumFlux:0};
      if(this._turboBranches)this.signal.turboUnits=this.boost.units.map(()=>({
        angle:0,omega:0,rpm:0,compressorFlow:0,compressorPower:0,compressorPressureRise:0,
        turbineFlow:0,turbinePower:0,wastegateFlow:0,wastegateOpening:0,bypassFlow:0,bypassOpening:0,
        chargePressure:c.ambientP,ambientPressure:c.ambientP,surge:0,surgeFlow:0}));
      this._bindSignals();
      this.totals={fuelInjected:0,fuelConsumed:0,heat:0,chemicalConsumed:0,shaftWork:0,
        starterWork:0,loadWork:0,frictionWork:0,gasWork:0,volumeWork:0,ambientPistonWork:0,
        shortCircuitFuel:0,energyIn:0,energyOut:0,wallHeat:0,massIn:0,massOut:0,
        airAdmitted:0,airBackflow:0,driveWork:0,driveTorque:0,couplingWork:0,
        airIn:0,airOut:0,fuelOut:0,burnedOut:0,combustionLoss:0,
        compressorWork:0,turbineWork:0,turboFrictionWork:0,compressorShaftWork:0,
        superchargerLossWork:0,intercoolerHeat:0,compressorKineticWork:0};
      this.numerics={steps:0,limitedTransfers:0,energyResidual:0,mechanicalResidual:0,massResidual:0,rotorResidual:0,compressorInertialResidual:0,totalEnergyResidual:0,
        speciesResidual:{air:0,fuel:0,burned:0}};
      this._initialU=this.rooms.reduce((s,g)=>s+g.U,0);this._initialMass=this.rooms.reduce((s,g)=>s+g.m,0);
      this._initialAir=this.rooms.reduce((s,g)=>s+g.air,0);this._initialFuel=0;
      this._initialBurned=this.rooms.reduce((s,g)=>s+g.burned,0);
      this._initialK=0;this._cycleWork=0;this._cycleAngle=0;this._cycleTime=0;this._lastCycle=0;
      this._pressureRise=0;this._valveSignal=0;this._links=[];this._stepOmega=0;this._gasMassRate=0;
      this._oldResistance={};this._resistanceNow={};
      const link=(a,b,name,index=-1,cd=.72,kind='orifice')=>{const l={a,b,name,index,cd,kind,area:0,dm:0,up:null,down:null,sign:1,active:false};this._links.push(l);return l;};
      this.throttleLink=link(this.charge||this.ambient,this.intake,'air',-1,c.throttleCd);
      if(this.two){this.reedLinks=this.crankcases.map((cc,i)=>link(this.intake,cc,'reeds',i,c.reedCd,'reed'));
        this.transferLinks=this.crankcases.map((cc,i)=>link(cc,this.cyl[i],'transfers',i,c.transferCd));this.reedLink=this.reedLinks[0];this.transferLink=this.transferLinks[0];this.intakeLinks=[];
      }else this.intakeLinks=this.cyl.map((z,i)=>link(this.intake,z,'intake',i,c.intakeCd));
      this.exhaustLinks=this.cyl.map((z,i)=>link(z,this.exhaust,'exhaust',i,c.exhaustCd));
      if(this.charge){this.compressorLink=link(this.ambient,this.charge,'compressor',-1,.72,'compressor');
        this.bypassLink=link(this.charge,this.ambient,'bypass',-1,.72);
        if(c.boost==='supercharger')this.leakLink=link(this.ambient,this.charge,'compressorLeak',-1,.65);
      }
      if(this.tailpipe){this.turbineLink=link(this.exhaust,this.tailpipe,'turbine',-1,.72,'turbine');
        this.wastegateLink=link(this.exhaust,this.tailpipe,'wastegate',-1,.78);}
      if(this._turboBranches){
        this._turboBranches.push({compressor:this.compressorLink,bypass:this.bypassLink,
          turbine:this.turbineLink,wastegate:this.wastegateLink,_compressorMap:{}});
        this._turboBranches.push({compressor:link(this.ambient,this.charge,'compressor',-1,.72,'compressor'),
          bypass:link(this.charge,this.ambient,'bypass',-1,.72),turbine:link(this.exhaust,this.tailpipe,'turbine',-1,.72,'turbine'),
          wastegate:link(this.exhaust,this.tailpipe,'wastegate',-1,.78),_compressorMap:{}});
        for(let i=0;i<this._turboBranches.length;i++)for(const key of ['compressor','bypass','turbine','wastegate'])this._turboBranches[i][key].turboIndex=i;
      }
      this.tailLink=link(this.tailpipe||this.exhaust,this.ambient,'tailpipe',-1,.86);
      this._idleStep(0);this._openings(this._geoms,this.angle);
      this.acousticState.springEnergy=this._valveSpringEnergy();
    }
    _bindSignals(){const s=this.signal;s.exhaustFlows=this.flows.exhaust;s.intakeFlows=this.flows.intake;
      for(const key of ['heatReleaseRates','heatPressureRates','valveImpulses','exhaustMomentumFluxes'])if(!Array.isArray(s[key])||s[key].length!==this.count)s[key]=Array(this.count).fill(0);
      if(s.exhaustMomentumFlux===undefined)s.exhaustMomentumFlux=0;}
    setControls(patch){
      if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new Error('Ungültige Bedienwerte.');
      for(const key of Object.keys(patch))if(key!=='starterSeconds'&&!Object.prototype.hasOwnProperty.call(this.controls,key))throw new Error('Unbekannter Bedienwert: '+key);
      const next={...this.controls,...patch},seconds=patch.starterSeconds;
      if(seconds!==undefined&&(!(seconds>0&&seconds<=10)||!Number.isFinite(seconds)||patch.starter!==true))throw new Error('Starterlaufzeit ungültig.');
      delete next.starterSeconds;
      const limits={throttle:[0,1],load:[0,100000],lambdaTarget:[.60,1.8],advance:[-10,50],injectionAdvance:[-20,50],wastegate:[0,1],bypass:[0,1],
        boostTarget:[0,500000],intakeCamAdvance:[-40,40],exhaustCamAdvance:[-40,40]};
      for(const[k,[lo,hi]]of Object.entries(limits))if(!Number.isFinite(next[k])||next[k]<lo||next[k]>hi)throw new Error(k+': außerhalb des gültigen Bereichs.');
      for(const k of ['fuel','ignition','starter'])if(typeof next[k]!=='boolean')throw new Error(k+': Wahrheitswert erforderlich.');
      if(!Array.isArray(next.cylinders)||next.cylinders.length!==this.count||next.cylinders.some(v=>typeof v!=='boolean'))throw new Error('Zylinderfreigaben passen nicht zum Motor.');
      if(next.intakeCamAdvance!==this.controls.intakeCamAdvance||next.exhaustCamAdvance!==this.controls.exhaustCamAdvance){
        const phasing=validateCamTargets(this.config,next);if(!phasing.ok)throw new Error(phasing.errors.join('\n'));
      }
      if(Object.prototype.hasOwnProperty.call(patch,'starter'))this._starterUntil=patch.starter&&seconds!==undefined?this.time+seconds:null;
      this.controls={...next,cylinders:next.cylinders.slice()};
    }
    _moveCamPhaser(dt){
      const p=this.camPhaser,u=this.controls,limit=this.config.camPhaserRate*dt;
      if(p.intakeAdvance!==u.intakeCamAdvance)p.intakeAdvance+=clamp(u.intakeCamAdvance-p.intakeAdvance,-limit,limit);
      if(p.exhaustAdvance!==u.exhaustCamAdvance)p.exhaustAdvance+=clamp(u.exhaustCamAdvance-p.exhaustAdvance,-limit,limit);
    }
    setTestDrive(rpm){
      if(rpm===null){this.testDrive=null;return;}
      if(!Number.isFinite(rpm)||rpm<50||rpm>30000)throw new Error('Prüfantrieb: 50 bis 30000 rpm.');
      const before=.5*this.config.inertia*this.omega**2;
      this.testDrive=rpm*TAU/60;this.omega=this.testDrive;this.rpm=rpm;
      this.totals.driveWork+=.5*this.config.inertia*this.omega**2-before;
    }
    applyShaftImpulse(impulse){
      if(!Number.isFinite(impulse))throw new Error('Ungültiger Kupplungsimpuls.');
      const before=.5*this.config.inertia*this.omega**2;
      this.omega+=impulse/this.config.inertia;this.rpm=this.omega*60/TAU;
      const work=.5*this.config.inertia*this.omega**2-before;
      this.totals.couplingWork+=work;this.signal.rpm=this.rpm;
      this.signal.mechanics.crankOmega=this.omega;
      this.signal.mechanics.timingOmega=this.config.kind==='four'?this.omega:0;
      if(this.config.boost==='supercharger'){this.boost.omega=this.omega*this.config.superchargerRatio;
        this.boost.rpm=this.rpm*this.config.superchargerRatio;this.signal.boosterRpm=this.signal.superchargerRpm=this.boost.rpm;}
      return {impulse,work};
    }
    _record(type,cylinder,time=this.time,angle=this.angle){this.events.push({type,cylinder,time,angle});if(this.events.length>24)this.events.shift();}
    _idleStep(dt){
      const c=this.config,u=this.controls,rpm=Math.max(0,this.rpm);
      const response=this._derivedCache.dt===dt?this._derivedCache.idleResponse:-Math.expm1(-dt/.12);
      this._idleRpm+=(rpm-this._idleRpm)*response;
      if(c.revLimiterEnabled){
        const limit=c.revLimitRpm>0?c.revLimitRpm:c.redlineRpm;
        if(this.revCut&&rpm<limit*.98)this.revCut=false;
        if(rpm>limit)this.revCut=true;
      }else this.revCut=false;
      const error=(c.idleRpm-this._idleRpm)/c.idleRpm;
      const base=this.diesel?.025:this.two?.047:this.rotary?.030:this.count>=3?.022:.035;
      let demand=0;
      if(c.idleEnabled&&u.ignition&&u.fuel){
        const raw=base+.10*error+this.idleIntegral;
        if((raw>0&&raw<c.idleMax)||(raw<=0&&error>0)||(raw>=c.idleMax&&error<0))
          this.idleIntegral=clamp(this.idleIntegral+.10*error*dt,-base,c.idleMax);
        demand=clamp(base+.10*error+this.idleIntegral,0,c.idleMax);
      }
      this.idle.demand=demand;
      this.idle.effectiveThrottle=this.diesel?1:Math.max(u.throttle,demand);
      this.idle.effectiveFuel=Math.max(u.throttle,demand);
    }
    _openings(geoms,angle,intakeAdvance=this.camPhaser.intakeAdvance,exhaustAdvance=this.camPhaser.exhaustAdvance,publishFields=true){
      const c=this.config,u=this.controls,k=this._compiled,degrees=angle/DEG,mechanicalCycle=this.rotary?this.cycleRadians:TAU;
      const cache=this._derivedCache,throttle=this.idle.effectiveThrottle;
      if(cache.throttle!==throttle){
        const floor=this.two?.004:.001;
        const fraction=floor+(1-floor)*Math.sin(throttle*PI/2)**2;
        cache.throttleArea=k.throttleArea*fraction/k.throttleResistance;cache.throttle=throttle;
      }
      this.throttleLink.area=cache.throttleArea;
      this.tailLink.area=k.tailArea;
      const seat=k.seat,circumference=k.valveCircumference,inSpan=k.intakeSpan,exSpan=k.exhaustSpan;
      for(let i=0;i<this.count;i++){
        const z=this.cyl[i],g=geoms[i];
        // Midpoint transport needs valve/port geometry, not display coordinates.
        // The public step still publishes every field at its final angle.
        if(publishFields){z.x=g.x;z.mechanicalAngle=mod(angle-k.offsetRadians[i],mechanicalCycle);}
        if(publishFields||!this.two||this.diesel)z.phase=mod(degrees-this.offsets[i],this.cycleDegrees);
        if(this.two){const ports=this.portsByCylinder[i];ports.transfer=c.transferWidth*clamp(g.x-c.transferTop,0,c.transferHeight);
          ports.exhaust=c.exhaustWidth*clamp(g.x-c.exhaustTop,0,c.exhaustHeight);
          this.transferLinks[i].area=ports.transfer;this.exhaustLinks[i].area=ports.exhaust;
          z.areaIn=ports.transfer;z.areaEx=ports.exhaust;z.liftIn=z.liftEx=0;
        }else if(this.rotary){const elapsedIn=mod(z.phase-c.rotaryIntakeOpen,1080),elapsedEx=mod(z.phase-c.rotaryExhaustOpen,1080),spanIn=k.rotaryIntakeSpan,spanEx=k.rotaryExhaustSpan;
          z.areaIn=elapsedIn>=spanIn?0:c.rotaryIntakeArea*Math.sin(PI*elapsedIn/spanIn)**2;z.areaEx=elapsedEx>=spanEx?0:c.rotaryExhaustArea*Math.sin(PI*elapsedEx/spanEx)**2;z.liftIn=z.liftEx=0;
          this.intakeLinks[i].area=z.areaIn;this.exhaustLinks[i].area=z.areaEx;
        }else{z.liftIn=liftAt(z.phase+intakeAdvance,c.intakeOpen,c.intakeClose,c.valveLift,c.valveProfileExponent,inSpan);z.liftEx=liftAt(z.phase+exhaustAdvance,c.exhaustOpen,c.exhaustClose,c.valveLift,c.valveProfileExponent,exSpan);
          z.areaIn=c.valvesPerPort*Math.min(circumference*z.liftIn,seat);z.areaEx=c.valvesPerPort*Math.min(circumference*z.liftEx,seat);
          this.intakeLinks[i].area=z.areaIn;this.exhaustLinks[i].area=z.areaEx;
        }
      }
      if(this.two){for(let i=0;i<this.count;i++){this.reedOpenings[i]=clamp((this.intake.p-this.crankcases[i].p-c.reedCrackPressure)/(c.reedFullOpenPressure-c.reedCrackPressure),0,1);this.reedLinks[i].area=c.reedArea*this.reedOpenings[i];}this.reedOpening=this.reedOpenings[0];}
      if(this.charge){
        const gauge=this.charge.p-c.ambientP;
        const pressureRelief=clamp((gauge-u.boostTarget)/k.boostReliefRange,0,1);
        if(this._turboBranches){
          for(let i=0;i<this.boost.units.length;i++){const b=this.boost.units[i],links=this._turboBranches[i];
            const speedRelief=clamp((b.rpm/c.turboDesignRpm-1.15)/.25,0,1);
            b.wastegateOpening=Math.max(u.wastegate,pressureRelief,speedRelief);
            links.wastegate.area=c.wastegateArea*b.wastegateOpening;links.turbine.area=c.turbineArea;
            links.bypass.area=c.bypassArea*b.bypassOpening;
          }
          this.boost.wastegateOpening=(this.boost.units[0].wastegateOpening+this.boost.units[1].wastegateOpening)/2;
        }else if(c.boost==='turbo'){
          const speedRelief=clamp((this.boost.rpm/c.turboDesignRpm-1.15)/.25,0,1);
          this.boost.wastegateOpening=Math.max(u.wastegate,pressureRelief,speedRelief);
          this.wastegateLink.area=c.wastegateArea*this.boost.wastegateOpening;this.turbineLink.area=c.turbineArea;
        }else{
          this.leakLink.area=.025*c.compressorArea;
        }
        if(!this._turboBranches)this.bypassLink.area=c.bypassArea*this.boost.bypassOpening;
      }
    }
    _compressorFlow(omega=this._stepOmega,b=this.boost){
      if(!this.charge)return 0;
      const c=this.config;
      if(c.boost==='supercharger'){
        const w=omega*c.superchargerRatio;
        const rho=w>=0?c.ambientP/(R*c.ambientT):this.charge.m/this.charge.volume;
        return rho*c.superchargerDisplacement*w/TAU*.92;
      }
      return b.compressorFlowState;
    }
    _updateBypass(dt){
      if(!this.charge)return;
      const c=this.config,u=this.controls,gauge=this.charge.p-c.ambientP;let automatic=0;
      if(c.autoBypassEnabled){
        if(c.boost==='turbo')automatic=clamp((this.charge.p-this.intake.p-5000)/25000,0,1)*clamp(gauge/15000,0,1);
        else automatic=Math.max(clamp(1-4*this.idle.effectiveFuel,0,1),clamp((gauge-u.boostTarget)/this._compiled.boostReliefRange,0,1));
      }
      const target=Math.max(u.bypass,automatic);
      if(this._turboBranches){const response=-Math.expm1(-dt/c.bypassResponseTime);
        for(const b of this.boost.units)b.bypassOpening+=(target-b.bypassOpening)*response;
        this.boost.bypassOpening=(this.boost.units[0].bypassOpening+this.boost.units[1].bypassOpening)/2;
      }else this.boost.bypassOpening+=(target-this.boost.bypassOpening)*(-Math.expm1(-dt/c.bypassResponseTime));
    }
    _compressorCoefficients(b=this.boost,m=this._compressorMap){
      const c=this.config,k=this._compiled,n=b.omega/k.turboDesignOmega;
      m.head=k.ambientEnthalpy*(Math.pow(1+(c.turboMaxPressureRatio-1)*n*n,(GAMMA-1)/GAMMA)-1);
      m.freeFlow=c.turboMaxFlow*Math.max(n,1e-8)*k.compressorTemperatureScale;m.peakFlow=m.freeFlow*c.turboSurgeFlowFraction;
      m.rightCoefficient=m.head/((m.freeFlow-m.peakFlow)**2);m.leftCoefficient=.35*m.head/(m.peakFlow*m.peakFlow);
      m.dragCoefficient=k.compressorDrag;
      m.load=k.ambientEnthalpy*(Math.pow(this.charge.p/c.ambientP,(GAMMA-1)/GAMMA)-1);
      return m;
    }
    _compressorCharacteristic(q,scale,m){
      let pump,derivative,loss=0,lossDerivative=0;
      if(q>=m.peakFlow){
        const x=q-m.peakFlow,head=m.head-m.rightCoefficient*x*x,d=-2*m.rightCoefficient*x;
        if(head>=0){pump=head;derivative=d;}else{pump=0;derivative=0;loss=head;lossDerivative=d;}
      }else if(q>=0){pump=.65*m.head+m.leftCoefficient*(2*q*m.peakFlow-q*q);derivative=2*m.leftCoefficient*(m.peakFlow-q);}
      else{pump=.65*m.head;derivative=0;loss=m.leftCoefficient*q*q;lossDerivative=2*m.leftCoefficient*q;}
      m.pump=scale*pump;m.net=scale*pump+loss-m.dragCoefficient*q*Math.abs(q);
      m.derivative=scale*derivative+lossDerivative-2*m.dragCoefficient*Math.abs(q);
    }
    _compressorStepBound(){
      if(this.config.boost!=='turbo')return Infinity;
      if(this._turboBranches){let bound=Infinity;const c=this.config;
        // Both ducts act on the shared pressure storage. Its fastest acoustic
        // mode sees their combined area; each map slope is still independent.
        const acoustic=Math.sqrt(GAMMA*R*this.charge.T*c.compressorArea*this.boost.units.length/(c.compressorDuctLength*this.charge.volume));
        for(let i=0;i<this.boost.units.length;i++){
          const b=this.boost.units[i],m=this._compressorCoefficients(b,this._turboBranches[i]._compressorMap);
          this._compressorCharacteristic(b.compressorFlowState,1,m);
          bound=Math.min(bound,.18/Math.max(1,acoustic+Math.abs(m.derivative)/this._compressorInertance));
        }
        return bound;
      }
      const m=this._compressorCoefficients(),c=this.config,q=this.boost.compressorFlowState;
      this._compressorCharacteristic(q,1,m);
      const acoustic=Math.sqrt(GAMMA*R*this.charge.T*c.compressorArea/(c.compressorDuctLength*this.charge.volume));
      return .18/Math.max(1,acoustic+Math.abs(m.derivative)/this._compressorInertance);
    }
    _prepareCompressor(dt,b=this.boost,cache=this){
      const c=this.config,m=this._compressorCoefficients(b,cache._compressorMap),old=b.compressorFlowState,I=this._compressorInertance;
      let scale=1,next=old,mid=old,work=0;
      // Implicit midpoint conserves the quadratic kinetic storage exactly.
      // The positive machine head is reduced if the finite rotor cannot supply
      // its work; no rotor speed or flow is prescribed by a sound oscillator.
      for(let budget=0;budget<6;budget++){
        next=old;
        for(let k=0;k<5;k++){
          mid=(old+next)/2;this._compressorCharacteristic(mid,scale,m);
          const residual=next-old-dt*(m.net-m.load)/I,denominator=1-dt*m.derivative/(2*I);
          next-=residual/denominator;
          if(Math.abs(residual)<1e-13)break;
        }
        mid=(old+next)/2;this._compressorCharacteristic(mid,scale,m);
        work=dt*mid*m.pump*(mid>=0?1/c.compressorEfficiency:c.compressorEfficiency);
        if(work<=.20*b.energy+1e-12)break;
        scale*=.20*b.energy/work;
        if(budget===4)scale=0;
      }
      if(!Number.isFinite(next)||!Number.isFinite(work)||work>b.energy+1e-10)throw new Error('Verdichterimpuls kann nicht konservativ aufgelöst werden.');
      cache._compressorOldFlow=old;cache._compressorNextFlow=next;cache._compressorTransportFlow=mid;cache._compressorRotorWork=work;
      b.compressorMapPressureRise=c.ambientP*(Math.pow(1+Math.max(0,m.pump)/(CP*c.ambientT),GAMMA/(GAMMA-1))-1);
    }
    _commitCompressor(dm,dt,b=this.boost,cache=this,index=-1){
      const c=this.config,t=this.totals,old=cache._compressorOldFlow;
      const requested=Math.abs(cache._compressorTransportFlow)*dt,fraction=requested>0?Math.min(1,dm/requested):1;
      const next=old+(cache._compressorNextFlow-old)*fraction,work=cache._compressorRotorWork*fraction;
      const energy=.5*this._compressorInertance*next*next,kinetic=energy-b.compressorInertialEnergy;
      b.energy-=work;if(b.energy<0&&b.energy>-1e-10)b.energy=0;
      b.omega=Math.sqrt(2*b.energy/c.turboInertia);b.compressorFlowState=next;b.compressorInertialEnergy=energy;
      b.surgeActive=next<0&&b.compressorMapPressureRise>0&&this.charge.p>c.ambientP;
      b.surgeIntensity=b.surgeActive?-next/Math.max(1e-9,cache._compressorMap.freeFlow):0;
      if(old>0&&next<=0&&b.compressorMapPressureRise>1&&this.charge.p>c.ambientP){
        const when=this.time+dt*old/(old-next);b.surgeEvents++;b.lastSurgeTime=when;
        // The integral of this causal event rate is the pressure ratio excess.
        const impulse=Math.max(0,this.charge.p/c.ambientP-1);
        this.signal.surge+=impulse;
        if(index>=0)this.signal.turboUnits[index].surge+=impulse;
        this._record('surge',-1,when);
        if(index>=0)this.events[this.events.length-1].turboIndex=index;
      }
      t.compressorKineticWork+=kinetic;t.compressorWork+=work;this._compressorWork+=work;
      if(index>=0)cache._compressorWork+=work;
      return work-kinetic;
    }
    _injectMass(room,mass){
      if(!(mass>0))return;
      const h=CP*this.config.ambientT;room.fuel+=mass;room.U+=mass*h;
      this.totals.fuelInjected+=mass;this.totals.massIn+=mass;this.totals.energyIn+=mass*h;
      refresh(room);
    }
    _transport(dt){
      const f=this.flows,c=this.config,t=this.totals,u=this.controls;
      f.air=f.fuel=f.reed=f.transfer=f.tailpipe=f.compressor=f.bypass=f.turbine=f.wastegate=f.compressorLeak=0;
      for(let i=0;i<this.count;i++){f.intake[i]=0;f.exhaust[i]=0;if(this.two){f.reeds[i]=f.transfers[i]=0;}}
      for(const g of this.rooms)g.dm=g.dAir=g.dFuel=g.dBurned=g.dU=g.outMass=0;
      this._compressorWork=0;this._turbineWork=0;
      if(this._turboBranches){
        for(let i=0;i<this.boost.units.length;i++){const b=this.boost.units[i],cache=this._turboBranches[i];
          b.compressorFlow=b.turbineFlow=b.wastegateFlow=b.bypassFlow=0;
          cache._compressorWork=cache._turbineWork=0;this._prepareCompressor(dt,b,cache);
        }
      }else if(c.boost==='turbo')this._prepareCompressor(dt);
      for(const l of this._links){
        if(l.kind!=='compressor'&&l.area<=0){l.dm=0;l.active=false;continue;}
        let q=l.kind==='compressor'?(c.boost==='turbo'?(this._turboBranches?this._turboBranches[l.turboIndex]._compressorTransportFlow:this._compressorTransportFlow):this._compressorFlow()):flowRate(l.a,l.b,l.area,l.cd);
        if(l.kind==='reed'&&q<0)q=0;
        if(q===0&&l.kind!=='compressor'){l.dm=0;l.active=false;continue;}l.active=true;
        l.sign=q>=0?1:-1;l.up=q>=0?l.a:l.b;l.down=q>=0?l.b:l.a;
        const up=l.up,down=l.down,inv=(up===this.ambient?0:1/up.volume)+(down===this.ambient?0:1/down.volume);
        const equal=l.kind==='compressor'?Infinity:Math.max(0,up.p-down.p)/((GAMMA-1)*CP*up.T*inv);
        l.dm=Math.min(Math.abs(q)*dt,equal);
        if(up!==this.ambient)up.outMass+=l.dm;
      }
      // Predict the next gas-exchange timescale from this step's actual donor
      // demand, before any safeguard. The finite rate is serialized along with
      // the thermodynamic state; old states retain the constructor's zero.
      this._gasMassRate=0;
      for(const l of this._links){
        if(!l.active)continue;
        const up=l.up,down=l.down;let dm=l.dm;
        if(up!==this.ambient&&up.outMass>.08*up.m){dm*=.08*up.m/up.outMass;this.numerics.limitedTransfers++;}
        let machineWork=0,turbineWork=0;
        if(l.kind==='compressor'&&c.boost==='turbo')machineWork=this._turboBranches?
          this._commitCompressor(dm,dt,this.boost.units[l.turboIndex],this._turboBranches[l.turboIndex],l.turboIndex):this._commitCompressor(dm,dt);
        else if(l.kind==='compressor'&&dm>0){
          let specific=0;
          const ideal=CP*up.T*(Math.pow(down.p/up.p,(GAMMA-1)/GAMMA)-1);
          specific=ideal>0?ideal/c.compressorEfficiency:ideal*c.compressorEfficiency;
          machineWork=dm*specific;
          this._compressorWork+=machineWork;t.compressorWork+=machineWork;
        }
        if(l.kind==='turbine'&&l.sign>0&&dm>0){
          const b=this._turboBranches?this.boost.units[l.turboIndex]:this.boost;
          const available=CP*up.T*(1-Math.pow(down.p/up.p,(GAMMA-1)/GAMMA));
          const jet=Math.sqrt(Math.max(0,2*available));
          const torque=dm/dt*c.turboRadius*Math.max(0,jet-b.omega*c.turboRadius)*c.turbineEfficiency*.65;
          const demand=torque*b.omega*dt+.5*torque*torque*dt*dt/c.turboInertia;
          turbineWork=Math.min(dm*available*c.turbineEfficiency,demand);
          b.energy+=turbineWork;b.omega=Math.sqrt(2*b.energy/c.turboInertia);
          this._turbineWork+=turbineWork;t.turbineWork+=turbineWork;
          if(this._turboBranches)this._turboBranches[l.turboIndex]._turbineWork+=turbineWork;
        }
        l.dm=dm;const enthalpy=dm*CP*up.T;
        const air=up===this.ambient?dm:dm*up.air/up.m;
        const fuel=up===this.ambient?0:dm*up.fuel/up.m;
        const burned=Math.max(0,dm-air-fuel);
        if(up!==this.ambient){up.dAir-=air;up.dFuel-=fuel;up.dBurned-=burned;up.dU-=enthalpy;}
        else{t.energyIn+=enthalpy;t.massIn+=dm;t.airIn+=air;}
        if(down!==this.ambient){down.dAir+=air;down.dFuel+=fuel;down.dBurned+=burned;down.dU+=enthalpy+machineWork-turbineWork;}
        else{t.energyOut+=enthalpy+machineWork-turbineWork;t.massOut+=dm;t.airOut+=air;t.fuelOut+=fuel;t.burnedOut+=burned;}
        const rate=l.sign*dm/dt;
        if(l.turboIndex!==undefined){f[l.name]+=rate;this.boost.units[l.turboIndex][l.name+'Flow']=rate;}
        else if(l.index>=0)f[l.name][l.index]=rate;else f[l.name]=rate;
        if(l.name==='exhaust'&&dm>0){
          // Passive coherent jet-momentum observer. The isentropic enthalpy
          // drop gives the ideal expansion speed from the actual pre-transfer
          // donor/receiver states. Use the transferred mass after every cap,
          // not the unbounded orifice request. Signed dm*v is an impulse (N s);
          // step() sums every substep and publishes its mean flux in newtons.
          // This estimates acoustic forcing only. It removes no extra energy,
          // changes no massflow, and is not a calibrated sound-pressure model.
          const head=CP*up.T*(1-Math.pow(down.p/up.p,(GAMMA-1)/GAMMA));
          this.signal.exhaustMomentumFluxes[l.index]+=l.sign*dm*Math.sqrt(Math.max(0,2*head));
        }
        if(l.name==='exhaust'&&l.sign>0)t.shortCircuitFuel+=fuel;
        if((!this.charge&&l===this.throttleLink)||(this.charge&&l.kind==='compressor')){
          if(l.sign>0)t.airAdmitted+=air;else t.airBackflow+=air;
        }
        // Otto 2T: upstream vapor metering. Otto 4T: port injection after the
        // charge pipe/throttle, including credit for fuel in any reverse-flow gas.
        const doseHere=!this.diesel&&u.fuel&&!this.revCut&&l.sign>0&&
          ((this.two&&l===this.throttleLink)||(!this.two&&l.name==='intake'));
        if(doseHere){const injected=Math.max(0,air/(this.afr*u.lambdaTarget)-fuel);
          down.dFuel+=injected;down.dU+=injected*CP*c.ambientT;
          t.fuelInjected+=injected;t.massIn+=injected;t.energyIn+=injected*CP*c.ambientT;f.fuel+=injected/dt;}
      }
      for(const g of this.rooms){
        // Read the unchanged donor mass before committing this room. No link
        // in the preceding pass consumes the next-step timescale.
        this._gasMassRate=Math.max(this._gasMassRate,g.outMass/(g.m*dt));
        g.air+=g.dAir;g.fuel+=g.dFuel;g.burned+=g.dBurned;g.U+=g.dU;
        if(g.air<0&&g.air>-1e-18)g.air=0;if(g.fuel<0&&g.fuel>-1e-18)g.fuel=0;if(g.burned<0&&g.burned>-1e-18)g.burned=0;refresh(g);}
      if(this.two)for(let i=0;i<this.count;i++){f.intake[i]=f.reeds[i];f.reed+=f.reeds[i];f.transfer+=f.transfers[i];}
      if(this._turboBranches){
        const decay=Math.exp(-2*c.turboFriction*dt/c.turboInertia);
        for(let i=0;i<this.boost.units.length;i++){const b=this.boost.units[i],cache=this._turboBranches[i],before=b.energy;
          b.energy*=decay;t.turboFrictionWork+=before-b.energy;b.omega=Math.sqrt(2*b.energy/c.turboInertia);
          b.angle+=b.omega*dt;b.rpm=b.omega*60/TAU;
          b.compressorPower=cache._compressorWork/dt;b.turbinePower=cache._turbineWork/dt;
        }
        this._sumTurboUnits();
      }else if(c.boost==='turbo'){
        const before=this.boost.energy;this.boost.energy*=Math.exp(-2*c.turboFriction*dt/c.turboInertia);
        t.turboFrictionWork+=before-this.boost.energy;this.boost.omega=Math.sqrt(2*this.boost.energy/c.turboInertia);
        this.boost.angle+=this.boost.omega*dt;
      }
    }
    _sumTurboUnits(){
      const b=this.boost,a=b.units[0],z=b.units[1];
      // Pressures do not add across parallel paths. The legacy shaft/phase and
      // map head identify the first machine; extensive quantities are totals.
      b.omega=a.omega;b.rpm=a.rpm;b.angle=a.angle;b.compressorMapPressureRise=a.compressorMapPressureRise;
      for(const key of ['energy','compressorInertialEnergy','compressorFlowState','compressorFlow','turbineFlow',
        'wastegateFlow','bypassFlow','compressorPower','turbinePower','surgeEvents'])b[key]=a[key]+z[key];
      b.wastegateOpening=(a.wastegateOpening+z.wastegateOpening)/2;b.bypassOpening=(a.bypassOpening+z.bypassOpening)/2;
      b.surgeActive=a.surgeActive||z.surgeActive;b.surgeIntensity=Math.max(a.surgeIntensity,z.surgeIntensity);
      b.lastSurgeTime=Math.max(a.lastSurgeTime,z.lastSurgeTime);
    }
    _publishTurboUnits(){
      const c=this.config;
      for(let i=0;i<this.boost.units.length;i++){const b=this.boost.units[i],s=this.signal.turboUnits[i];
        b.chargePressure=this.charge.p;b.chargeTemperature=this.charge.T;b.boostPressure=this.intake.p-c.ambientP;
        b.compressorPressureRise=this.charge.p-c.ambientP;
        b.warning=b.rpm>1.5*c.turboDesignRpm?'Lader außerhalb des Kennfeldbereichs':null;
        for(const key of ['angle','omega','rpm','compressorFlow','compressorPower','compressorPressureRise','turbineFlow',
          'turbinePower','wastegateFlow','wastegateOpening','bypassFlow','bypassOpening','chargePressure'])s[key]=b[key];
        s.ambientPressure=c.ambientP;s.surgeFlow=b.surgeActive?Math.min(0,b.compressorFlowState):0;b.surgeFlow=s.surgeFlow;
      }
      this.boost.warning=this.boost.units[0].warning||this.boost.units[1].warning;
    }
    _events(oldAngle,newAngle,dt,oldIntakeAdvance=this.camPhaser.intakeAdvance,oldExhaustAdvance=this.camPhaser.exhaustAdvance){
      if(newAngle<=oldAngle)return;
      const c=this.config,u=this.controls,cycle=this.cycleDegrees,oldDegrees=oldAngle/DEG,newDegrees=newAngle/DEG;
      for(let i=0;i<this.count;i++){
        const offset=this.offsets[i],z=this.cyl[i];
        if(!this.two&&!this.rotary)for(let k=0;k<2;k++){
          const advance=k===0?this.camPhaser.intakeAdvance:this.camPhaser.exhaustAdvance,oldAdvance=k===0?oldIntakeAdvance:oldExhaustAdvance;
          const close=k===0?c.intakeClose:c.exhaustClose,before=Math.floor((oldDegrees+oldAdvance-offset-close)/720),after=Math.floor((newDegrees+advance-offset-close)/720);
          if(after>before){const camDelta=advance-oldAdvance,exact=camDelta===0?(after*720+offset+close-advance)*DEG:
              oldAngle+(after*720+offset+close-oldDegrees-oldAdvance)/(newDegrees-oldDegrees+camDelta)*(newAngle-oldAngle);
            const span=(close-(k===0?c.intakeOpen:c.exhaustOpen))*DEG,angularSpeed=camDelta===0?this.omega:this.omega+camDelta*DEG/dt;
            const impulse=Math.min(2,Math.sqrt(2*c.valveLift*(PI/span)**2*angularSpeed**2/800));
            this._valveSignal+=impulse;this.signal.valveImpulses[i]+=impulse;
            this._record('valve',i,this.time+(exact-oldAngle)/(newAngle-oldAngle)*dt,exact);}
        }
        const advance=this.diesel?u.injectionAdvance:u.advance;
        const before=Math.floor((oldDegrees+advance-offset)/cycle),after=Math.floor((newDegrees+advance-offset)/cycle);
        if(after<=before||z.lastSparkCycle===after)continue;
        z.lastSparkCycle=after;z.sparkOpportunities++;
        const exact=(after*cycle+offset-advance)*DEG;
        const when=this.time+clamp((exact-oldAngle)/(newAngle-oldAngle),0,1)*dt;
        if(this.diesel){
          z.dieselBurn=false;z.injectionIntegral=0;z.dieselEventFuel=0;z.dieselBurnedFuel=0;z.burn=0;
          if(!u.ignition||!u.fuel||!u.cylinders[i]||this.revCut)continue;
          const target=Math.min(c.maxFuelPerCycle*this.idle.effectiveFuel,
            Math.max(0,z.air/(this.afr*Math.max(c.dieselMinLambda,u.lambdaTarget))-z.fuel));
          if(target<=1e-12)continue;
          const duration=Math.max(.00035,c.injectionDuration*DEG/Math.max(Math.abs(this.omega),15));
          z.injectionState={time:when,duration,target,lastFraction:0};z.lastInjectionTime=when;
          z.lastInjectionAngle=exact;z.injectionEvents++;this._record('injection',i,when,exact);
        }else{
          if(!u.ignition||!u.cylinders[i]||this.revCut)continue;
          z.lastSparkTime=when;z.lastSparkAngle=exact;this._record('spark',i,when,exact);z.burn=0;
          const lambda=z.fuel>1e-14?z.air/(this.afr*z.fuel):Infinity,residual=z.burned/z.m;
          const reactive=Math.min(z.fuel,z.air/this.afr);
          if(lambda<.55||lambda>1.65||residual>.66||reactive<1e-10||z.T<235||z.combustionState){this._record('misfire',i,when,exact);continue;}
          const speed=Math.max(Math.abs(this.omega),15),mix=1+.7*Math.abs(lambda-1)+1.2*residual;
          z.combustionState={time:when+.00015+.75*DEG/speed,duration:Math.max(.00045,c.burnDuration*DEG/speed)*mix*this.fuel.flameDurationFactor,
            target:reactive,lastFraction:0,started:false,lambda,residual};
        }
      }
    }
    _react(z,wanted,dt){
      const consumed=Math.min(Math.max(0,wanted),z.fuel,z.air/this.afr);
      const airUsed=Math.min(z.air,this.afr*consumed);
      z.fuel-=consumed;z.air-=airUsed;z.burned+=consumed+airUsed;
      const heat=consumed*this.lhv*this.config.combustionEfficiency;
      z.U+=heat;z.heatTotal+=heat;
      z.heatReleaseRate=(z.heatReleaseRate||0)+heat/dt;
      z.heatPressureRate=(z.heatPressureRate||0)+(GAMMA-1)*heat/z.volume/dt;
      this._pressureRise+=(GAMMA-1)*heat/z.volume/dt;
      this.totals.fuelConsumed+=consumed;this.totals.chemicalConsumed+=consumed*this.lhv;this.totals.heat+=heat;this.totals.combustionLoss+=consumed*this.lhv-heat;
      z.burning=consumed>1e-15;refresh(z);return consumed;
    }
    _dieselStep(z,i,dt){
      const c=this.config,u=this.controls,inj=z.injectionState;z.injection=false;z.injectionRate=0;
      if(inj){
        if(!u.fuel||!u.ignition||!u.cylinders[i]||this.revCut){z.injectionState=null;}
        else{
          const p=clamp((this.time+dt-inj.time)/inj.duration,0,1),fraction=p-Math.sin(TAU*p)/TAU;
          const wanted=inj.target*Math.max(0,fraction-inj.lastFraction);
          const mass=Math.min(wanted,Math.max(0,z.air/(this.afr*c.dieselMinLambda)-z.fuel));
          this._injectMass(z,mass);this.flows.fuel+=mass/dt;z.injectionRate=mass/dt;z.injection=mass>1e-14;
          z.dieselEventFuel+=mass;inj.lastFraction=fraction;if(p>=1)z.injectionState=null;
        }
      }
      if(!z.dieselBurn&&z.fuel>1e-10&&z.air>1e-9&&z.dieselEventFuel>0&&z.T>500){
        const tau=clamp(.00075*this.fuel.ignitionDelayFactor*Math.pow(4e6/z.p,.7)*Math.exp(4500*(1/z.T-1/900)),.00010,.050);
        z.injectionIntegral+=dt/tau;
        if(z.injectionIntegral>=1){z.dieselBurn=true;z.events++;z.lastBurnTime=this.time+dt;
          z.lastIgnitionDelay=z.lastBurnTime-z.lastInjectionTime;this._record('burn',i,z.lastBurnTime);}
      }
      if(z.dieselBurn){
        const tau=c.dieselMixTime*(1+.7*z.burned/z.m)*Math.pow(300/Math.max(30,Math.abs(this.omega)),.15);
        const available=Math.min(z.fuel,z.air/this.afr);
        const burned=this._react(z,available*(-Math.expm1(-dt/tau)),dt);z.dieselBurnedFuel+=burned;
        z.burn=z.dieselEventFuel>0?clamp(z.dieselBurnedFuel/z.dieselEventFuel,0,1):0;
        if((!z.injectionState&&z.fuel<1e-11)||(z.phase>110&&z.phase<650&&z.T<700))z.dieselBurn=false;
      }
    }
    _heat(dt,geoms,deferMovingRefresh=false){
      this._pressureRise=0;const c=this.config,k=this._compiled,baseTransfer=60+80*Math.sqrt(Math.abs(this.omega)/100);
      for(let i=0;i<this.count;i++){
        const z=this.cyl[i],g=geoms[i];z.burning=false;z.heatReleaseRate=0;z.heatPressureRate=0;
        if(this.diesel)this._dieselStep(z,i,dt);
        else{const b=z.combustionState;if(b&&this.time+dt>b.time){
          if(!b.started){b.started=true;z.events++;z.lastBurnTime=b.time;this._record('burn',i,b.time);}
          const p=clamp((this.time+dt-b.time)/b.duration,0,1),fraction=(1-Math.exp(-6.9*p**3))/BURN_NORMALIZATION;
          this._react(z,b.target*Math.max(0,fraction-b.lastFraction),dt);z.burn=fraction;b.lastFraction=fraction;
          if(p>=1||z.fuel<1e-14||z.air<1e-13)z.combustionState=null;
        }}
        this.signal.heatReleaseRates[i]+=z.heatReleaseRate*dt;this.signal.heatPressureRates[i]+=z.heatPressureRate*dt;
        const surface=this.rotary?g.surface:2*g.area+k.boreCircumference*g.volume/g.area;
        this._cool(z,c.wallT,c.heatTransferScale*(baseTransfer+(z.burning?70:0))*surface,dt,!deferMovingRefresh);
      }
      this._cool(this.intake,c.ambientT,k.intakeHeat,dt);
      this._cool(this.exhaust,c.wallT,k.exhaustHeat,dt);
      for(const cc of this.crankcases)this._cool(cc,k.crankcaseWall,k.crankcaseHeat,dt,!deferMovingRefresh);
      if(this.tailpipe)this._cool(this.tailpipe,c.wallT,k.exhaustHeat,dt);
      if(this.charge){
        let ua=.5*c.heatTransferScale;
        if(c.intercoolerEnabled&&c.intercoolerEfficiency>0)ua+=(.001+Math.abs(this.flows.compressor))*CP*c.intercoolerEfficiency/(1-c.intercoolerEfficiency);
        const q=this._cool(this.charge,c.ambientT,ua,dt);if(c.intercoolerEnabled)this.totals.intercoolerHeat+=q;
      }
    }
    _cool(g,wall,k,dt,refreshNow=true){
      if(g.T<=wall)return 0;const q=(g.U-g.m*CV*wall)*(-Math.expm1(-k*dt/(g.m*CV)));
      g.U-=q;this.totals.wallHeat+=q;if(refreshNow)refresh(g);return q;
    }
    _gasTorque(geoms){let out=0;for(let i=0;i<this.count;i++){const pressure=this.cyl[i].p-(this.two?this.crankcases[i].p:this.config.ambientP);out+=this.rotary?pressure*geoms[i].dV:pressure*geoms[i].area*geoms[i].dx;}return out;}
    _starter(w){const c=this.config;return this.controls.starter?c.starterTorque*Math.max(0,1-Math.max(0,w)/this._compiled.starterNoLoadOmega):0;}
    _resistance(w,torque,out){const c=this.config,wear=c.bearingWear;
      out.coulomb=c.frictionBase*(1+3*wear)+wear*.018*Math.abs(torque);out.viscous=c.frictionViscous*(1+4*wear);
      out.windage=c.frictionWindage*w*w;out.load=this.controls.load;return out;}
    _resist(free,dt,r){return Math.sign(free)*Math.max(0,Math.abs(free)-(r.coulomb+r.windage+r.load)*dt/this.config.inertia)/(1+r.viscous*dt/this.config.inertia);}
    _valveSpringEnergy(){
      if(this.two||this.rotary)return 0;
      const k=this._compiled,c=this.config;let energy=0;
      for(let i=0;i<this.count;i++){
        const z=this.cyl[i],a=z.liftIn,b=z.liftEx;
        energy+=c.valvesPerPort*(k.acousticValvePreload*(a+b)+.5*k.acousticValveStiffness*(a*a+b*b));
      }
      return energy;
    }
    _pistonContact(index,force,dt){
      const state=this.acousticState,mass=this._compiled.acousticPistonMass;
      const clearance=this.config.pistonClearance;
      let x=state.pistonPosition[index],v=state.pistonVelocity[index],remaining=dt;
      const a=force/mass,m=this.signal.mechanics;
      // Passive, inelastic secondary-motion observer. The piston crosses its
      // authored lateral clearance under the estimated side force. Only an
      // actual boundary crossing emits an impulse; no firing/RPM timer exists.
      // Oil films, pin freedom and liner elasticity are not resolved here.
      for(let pass=0;pass<3&&remaining>1e-15;pass++){
        if((x>=clearance&&v>=0&&a>=0)||(x<=-clearance&&v<=0&&a<=0)){v=0;break;}
        let hit=remaining+1,side=0;
        for(let sign=-1;sign<=1;sign+=2){
          const distance=sign*clearance-x;
          if(Math.abs(a)<1e-12){
            const t=v===0?Infinity:distance/v;
            if(t>1e-15&&t<=remaining&&sign*v>0&&t<hit){hit=t;side=sign;}
          }else{
            const discriminant=v*v+2*a*distance;
            if(discriminant>=0){
              const root=Math.sqrt(discriminant);
              for(let direction=-1;direction<=1;direction+=2){
                const t=(-v+direction*root)/a;
                if(t>1e-15&&t<=remaining&&sign*(v+a*t)>0&&t<hit){hit=t;side=sign;}
              }
            }
          }
        }
        if(!side){x+=v*remaining+.5*a*remaining*remaining;v+=a*remaining;remaining=0;}
        else{
          v+=a*hit;x=side*clearance;
          m.pistonContactImpulse+=mass*Math.abs(v);
          m.pistonContactEnergy+=.5*mass*v*v;
          v=0;remaining-=hit;
        }
      }
      state.pistonPosition[index]=clamp(x,-clearance,clearance);
      state.pistonVelocity[index]=v;
    }
    _observeMechanics(dt,oldGeoms,oldOmega){
      const c=this.config,k=this._compiled,m=this.signal.mechanics;
      m.crankAngle=this.angle;m.crankOmega=this.omega;
      m.angularAcceleration=(this.omega-oldOmega)/dt;
      m.pistonSideForce=0;m.reciprocatingForce=0;
      if(!this.rotary)for(let i=0;i<this.count;i++){
        const g=this._geoms[i],velocity=g.dx*this.omega;
        const acceleration=(velocity-oldGeoms[i].dx*oldOmega)/dt;
        const inertia=k.acousticReciprocatingMass*acceleration;
        const gasForce=(this.cyl[i].p-(this.two?this.crankcases[i].p:c.ambientP))*g.area;
        const offset=(c.stroke/2)*Math.sin(this.angle-k.offsetRadians[i]);
        const rodRoot=Math.sqrt(c.rod*c.rod-offset*offset);
        const sideForce=(gasForce-inertia)*offset/rodRoot;
        m.pistonSideForce+=sideForce;m.reciprocatingForce+=inertia;
        this._pistonContact(i,sideForce,dt);
      }
      m.frictionPower=Math.abs(this.frictionTorque*this.omega);
      const springEnergy=this._valveSpringEnergy();
      // The spring work is inferred from the real valve lift trajectory.
      // Its acoustic load neither removes shaft work nor changes valve timing.
      m.timingLoad=!this.two&&!this.rotary&&Math.abs(this.omega)>1e-6?
        (springEnergy-this.acousticState.springEnergy)/(this.omega*dt):0;
      this.acousticState.springEnergy=springEnergy;
      m.timingAngle=!this.two&&!this.rotary?this.angle:0;
      m.timingOmega=!this.two&&!this.rotary?this.omega:0;
    }
    step(dt=this.dt){
      if(!(dt>0&&dt<=.02)||!Number.isFinite(dt))throw new Error('Ungültiger Physikzeitschritt.');if(this.warning)throw new Error(this.warning);
      // Aim below the unchanged 8% donor safeguard. This refines only phases
      // with rapid gas exchange and adds no mass, heat or mechanical work.
      const n=Math.max(1,Math.ceil(dt/(1/12000)),Math.ceil(Math.abs(this.omega)*dt/(2.5*DEG)),Math.ceil(dt/this._compressorStepBound()),Math.ceil(dt*this._gasMassRate/.06));
      if(n>2048)throw new Error('Diese Geometrie benötigt einen kleineren äußeren Physikzeitschritt für die Gas- oder Verdichterdynamik.');
      const s=this.signal;s.valveImpulses.fill(0);s.heatReleaseRates.fill(0);s.heatPressureRates.fill(0);s.surge=0;
      s.exhaustMomentumFluxes.fill(0);s.exhaustMomentumFlux=0;
      s.mechanics.pistonContactImpulse=0;s.mechanics.pistonContactEnergy=0;s.mechanics.valveContactImpulse=0;
      if(this._turboBranches)for(const unit of s.turboUnits)unit.surge=0;
      for(let i=0;i<n;i++)this._substep(dt/n,i===n-1);
      s.dt=dt;s.surge/=dt;s.combustion=0;
      if(this._turboBranches)for(let i=0;i<s.turboUnits.length;i++){
        s.turboUnits[i].surge/=dt;this.boost.units[i].surge=s.turboUnits[i].surge;
      }
      for(let i=0;i<this.count;i++){s.heatReleaseRates[i]/=dt;s.heatPressureRates[i]/=dt;s.combustion+=s.heatPressureRates[i]/1e9;
        s.exhaustMomentumFluxes[i]/=dt;s.exhaustMomentumFlux+=s.exhaustMomentumFluxes[i];
        s.mechanics.valveContactImpulse+=s.valveImpulses[i];}
    }
    _substep(dt,publish=true){
      if(this._starterUntil!==null&&this.time+1e-10>=this._starterUntil){this.controls.starter=false;this._starterUntil=null;}
      const c=this.config,k=this._compiled,I=c.inertia,oldOmega=this.omega,oldAngle=this.angle;
      const oldIntakeAdvance=this.camPhaser.intakeAdvance,oldExhaustAdvance=this.camPhaser.exhaustAdvance;
      const rates=this._derivedCache;
      if(rates.dt!==dt){rates.dt=dt;rates.idleResponse=-Math.expm1(-dt/.12);rates.valveDecay=Math.exp(-dt/.0002);}
      this._moveCamPhaser(dt);
      this._idleStep(dt);this._updateBypass(dt);
      const oldTorque=this._gasTorque(this._geoms),start=this._starter(oldOmega),resistance=this._resistance(oldOmega,oldTorque,this._oldResistance);
      const half=this.testDrive!=null?this.testDrive:this._resist(oldOmega+(oldTorque+start-this.superchargerTorque)*dt/(2*I),dt/2,resistance);
      this._stepOmega=half;const delta=half*dt,nextAngle=oldAngle+delta;let volumeWork=0,ambientWork=0;
      for(let i=0;i<this.count;i++){
        geometryInto(c,oldAngle+delta/2-k.offsetRadians[i],this._mids[i],k.geometry);
        geometryInto(c,nextAngle-k.offsetRadians[i],this._nexts[i],k.geometry);
        volumeWork+=adiabatic(this.cyl[i],this._mids[i].volume);
        if(!this.two)ambientWork+=c.ambientP*(this._nexts[i].volume-this._geoms[i].volume);
      }
      for(let i=0;i<this.crankcases.length;i++)volumeWork+=adiabatic(this.crankcases[i],this.ccMax-this._mids[i].area*this._mids[i].x);
      this._valveSignal*=rates.valveDecay;
      this._openings(this._mids,oldAngle+delta/2,(oldIntakeAdvance+this.camPhaser.intakeAdvance)/2,(oldExhaustAdvance+this.camPhaser.exhaustAdvance)/2,false);
      this._transport(dt);this._events(oldAngle,nextAngle,dt,oldIntakeAdvance,oldExhaustAdvance);this._heat(dt,this._mids,true);
      // Cooling changes only U. Its derived p/T are first read after these
      // updates, which also refresh the zero-motion/equal-volume case.
      for(let i=0;i<this.count;i++)volumeWork+=adiabatic(this.cyl[i],this._nexts[i].volume,true);
      for(let i=0;i<this.crankcases.length;i++)volumeWork+=adiabatic(this.crankcases[i],this.ccMax-this._nexts[i].area*this._nexts[i].x,true);
      const gasWork=volumeWork-ambientWork,torque=Math.abs(delta)>1e-12?gasWork/delta:this._gasTorque(this._mids);
      const starter=this._starter(half),r=this._resistance(half,torque,this._resistanceNow);
      let scWork=0;
      if(c.boost==='supercharger'){
        const loss=(c.superchargerFriction*c.superchargerRatio+.000003*(half*c.superchargerRatio)**2*c.superchargerRatio)*Math.abs(delta);
        this.totals.superchargerLossWork+=loss;scWork=this._compressorWork+loss;this.totals.compressorShaftWork+=scWork;
      }
      const scTorque=Math.abs(delta)>1e-12?scWork/delta:0;this.superchargerTorque=scTorque;
      const free=oldOmega+(torque+starter-scTorque)*dt/I;
      let nextOmega=this._resist(free,dt,r);
      const totalRes=I*(free-nextOmega)/dt,sign=Math.sign(totalRes);
      const rawLoad=sign*r.load,rawFriction=sign*(r.coulomb+r.windage)+r.viscous*nextOmega;
      const factor=Math.abs(rawLoad+rawFriction)>1e-14?totalRes/(rawLoad+rawFriction):0;
      this.loadTorque=rawLoad*factor;this.frictionTorque=rawFriction*factor;
      if(this.testDrive!=null){this.loadTorque=Math.sign(this.testDrive)*r.load;
        this.frictionTorque=Math.sign(this.testDrive)*(r.coulomb+r.windage)+r.viscous*this.testDrive;
        const ext=this.frictionTorque+this.loadTorque+scTorque-torque-starter;
        this.totals.driveTorque=ext;this.totals.driveWork+=ext*delta;nextOmega=this.testDrive;}
      this.omega=nextOmega;this.rpm=nextOmega*60/TAU;this.angle=nextAngle;this.time+=dt;
      this.torque=torque;this.starterTorque=starter;this.brakeTorque=torque-this.frictionTorque-scTorque;
      const t=this.totals;t.volumeWork+=volumeWork;t.ambientPistonWork+=ambientWork;t.gasWork+=gasWork;
      t.frictionWork+=this.frictionTorque*delta;t.loadWork+=this.loadTorque*delta;t.starterWork+=starter*delta;
      t.shaftWork+=this.brakeTorque*delta;this._cycleWork+=this.brakeTorque*delta;this._cycleAngle+=delta;this._cycleTime+=dt;
      const cycle=Math.floor(nextAngle/this.cycleRadians);
      if(cycle>this._lastCycle&&this._cycleAngle>.5*this.cycleRadians){this.meanTorque=this._cycleWork/this._cycleAngle;
        this.power=this._cycleWork/this._cycleTime;this.cycleReady=true;this._cycleWork=this._cycleAngle=this._cycleTime=0;this._lastCycle=cycle;}
      const oldGeoms=this._geoms;this._geoms=this._nexts;this._nexts=oldGeoms;this._geom=this._geoms[0];
      if(publish){this._openings(this._geoms,this.angle);
        for(const z of this.cyl)z.spark=!this.diesel&&this.time-z.lastSparkTime<=.002;}
      this._observeMechanics(dt,oldGeoms,oldOmega);
      if(this.charge){const b=this.boost;
        if(c.boost==='supercharger'){b.omega=this.omega*c.superchargerRatio;b.angle=this.angle*c.superchargerRatio;}
        b.rpm=b.omega*60/TAU;if(publish){b.compressorFlow=this.flows.compressor;b.turbineFlow=this.flows.turbine;
        b.wastegateFlow=this.flows.wastegate;b.bypassFlow=this.flows.bypass;
        b.compressorPower=this._turboBranches?b.units[0].compressorPower+b.units[1].compressorPower:this._compressorWork/dt;
        b.turbinePower=this._turboBranches?b.units[0].turbinePower+b.units[1].turbinePower:this._turbineWork/dt;b.shaftPower=scWork/dt;
        b.chargePressure=this.charge.p;b.chargeTemperature=this.charge.T;b.boostPressure=this.intake.p-c.ambientP;
        b.compressorPressureRise=this.charge.p-c.ambientP;
        b.warning=c.boost==='turbo'&&b.rpm>1.5*c.turboDesignRpm?'Lader außerhalb des Kennfeldbereichs':null;}
      }
      if(publish&&this._turboBranches)this._publishTurboUnits();
      if(publish){
      const s=this.signal,ex=this.tailpipe||this.exhaust;
      s.exhaustFlow=0;s.intakeFlow=0;s.injection=0;
      for(let i=0;i<this.count;i++){s.exhaustFlow+=this.flows.exhaust[i];s.intakeFlow+=this.flows.intake[i];s.injection+=this.cyl[i].injectionRate;}
      s.exhaustPressure=ex.p;s.intakePressure=this.intake.p;s.exhaustTemp=ex.T;s.intakeTemp=this.intake.T;
      s.manifoldPressure=this.exhaust.p;s.manifoldTemp=this.exhaust.T;s.manifoldFlow=s.exhaustFlow;
      s.combustion=this._pressureRise/1e9;s.structure=torque/100;s.valve=this._valveSignal;
      s.bearing=Math.abs(this.frictionTorque*this.omega)/1000;s.rpm=this.rpm;s.load=this.controls.load;s.throttle=this.idle.effectiveThrottle;
      s.boosterRpm=this.boost.rpm;s.turboRpm=c.boost==='turbo'?this.boost.rpm:0;s.superchargerRpm=c.boost==='supercharger'?this.boost.rpm:0;
      s.compressorFlow=this.flows.compressor;s.turbineFlow=this.flows.turbine;s.bypassFlow=this.flows.bypass;s.compressorPower=this.boost.compressorPower;
      s.turbinePower=this.boost.turbinePower;s.wastegateFlow=this.flows.wastegate;s.wastegateOpening=this.boost.wastegateOpening;
      s.time=this.time;s.angle=this.angle;s.dt=dt;s.boostAngle=this.boost.angle;s.boostRpm=this.boost.rpm;
      s.ambientPressure=c.ambientP;s.chargePressure=this.charge?.p||c.ambientP;s.compressorPressureRise=s.chargePressure-c.ambientP;s.bypassOpening=this.boost.bypassOpening;
      s.surgeFlow=this._turboBranches?s.turboUnits[0].surgeFlow+s.turboUnits[1].surgeFlow:
        this.boost.surgeActive?Math.min(0,this.boost.compressorFlowState):0;
      }
      this.numerics.steps++;if(this.numerics.steps%128===0)this._check();
    }
    _check(){
      for(const g of this.rooms)if(!(g.volume>0&&g.T>0&&g.m>0&&g.air>=0&&g.fuel>=0&&g.burned>=0)||!Number.isFinite(g.p)||!Number.isFinite(g.T)||!Number.isFinite(g.U)){
        this.warning='Ungültiger Gaszustand bei '+this.time.toFixed(6)+' s';throw new Error(this.warning);}
      if(!Number.isFinite(this.omega)||!Number.isFinite(this.angle)||Math.abs(this.omega)>5000||!(this.boost.energy>=0)||!(this.boost.compressorInertialEnergy>=0)||!Number.isFinite(this.boost.compressorFlowState)){
        this.warning='Numerischer Arbeitsbereich überschritten';throw new Error(this.warning);}
      if(this._turboBranches&&this.boost.units.some(b=>![b.omega,b.rpm,b.angle,b.energy,b.compressorInertialEnergy,b.compressorFlowState].every(Number.isFinite)||b.energy<0||b.omega<0||b.compressorInertialEnergy<0)){
        this.warning='Numerischer Arbeitsbereich eines Turboladers überschritten';throw new Error(this.warning);}
      const t=this.totals,U=this.rooms.reduce((s,g)=>s+g.U,0);
      const duct=this.boost.compressorInertialEnergy-this._initialDuctEnergy;
      this.numerics.energyResidual=U-this._initialU+duct-t.energyIn+t.energyOut-t.heat+t.wallHeat+t.volumeWork-t.compressorWork+t.turbineWork;
      this.numerics.massResidual=this.rooms.reduce((s,g)=>s+g.m,0)-this._initialMass-t.massIn+t.massOut;
      this.numerics.mechanicalResidual=.5*this.config.inertia*this.omega**2-this._initialK-t.gasWork-t.starterWork-t.driveWork-t.couplingWork+t.frictionWork+t.loadWork+t.compressorShaftWork;
      this.numerics.rotorResidual=this.config.boost==='turbo'?this.boost.energy-t.turbineWork+t.compressorWork+t.turboFrictionWork:0;
      this.numerics.compressorInertialResidual=duct-t.compressorKineticWork;
      let air=0,fuel=0,burned=0;for(const g of this.rooms){air+=g.air;fuel+=g.fuel;burned+=g.burned;}
      const species=this.numerics.speciesResidual;
      species.air=air-this._initialAir-t.airIn+t.airOut+this.afr*t.fuelConsumed;
      species.fuel=fuel-this._initialFuel-t.fuelInjected+t.fuelOut+t.fuelConsumed;
      species.burned=burned-this._initialBurned+t.burnedOut-(this.afr+1)*t.fuelConsumed;
      this.numerics.totalEnergyResidual=U-this._initialU+duct+.5*this.config.inertia*this.omega**2-this._initialK+this.boost.energy
        +(fuel-this._initialFuel-t.fuelInjected+t.fuelOut)*this.lhv-t.energyIn+t.energyOut+t.wallHeat+t.ambientPistonWork
        +t.frictionWork+t.loadWork+t.turboFrictionWork+t.superchargerLossWork+t.combustionLoss-t.starterWork-t.driveWork-t.couplingWork;
    }
    instantaneousFlows(){
      const f={air:0,fuel:this.diesel?this.flows.fuel:0,intake:Array(this.count).fill(0),exhaust:Array(this.count).fill(0),
        transfer:0,reed:0,reeds:Array(this.two?this.count:0).fill(0),transfers:Array(this.two?this.count:0).fill(0),tailpipe:0,compressor:0,bypass:0,turbine:0,wastegate:0,compressorLeak:0};
      for(const l of this._links){let q=l.kind==='compressor'?this._compressorFlow(this.omega,l.turboIndex===undefined?this.boost:this.boost.units[l.turboIndex]):flowRate(l.a,l.b,l.area,l.cd);
        if(l.kind==='reed'&&q<0)q=0;
        if(l.turboIndex!==undefined)f[l.name]+=q;else if(l.index>=0)f[l.name][l.index]=q;else f[l.name]=q;
        if(!this.diesel&&this.controls.fuel&&!this.revCut&&q>0&&((this.two&&l===this.throttleLink)||(!this.two&&l.name==='intake'))){
          const air=l.a===this.ambient?1:l.a.air/l.a.m,fuel=l.a===this.ambient?0:l.a.fuel/l.a.m;
          f.fuel+=q*Math.max(0,air/(this.afr*this.controls.lambdaTarget)-fuel);}
      }
      if(this.two)for(let i=0;i<this.count;i++){f.intake[i]=f.reeds[i];f.reed+=f.reeds[i];f.transfer+=f.transfers[i];}return f;
    }
    sample(){return{time:this.time,angle:this.angle,rpm:this.rpm,torque:this.torque,cyl:this.cyl.map(z=>({p:z.p,volume:z.volume,phase:z.phase}))};}
    snapshot(){
      const flows=this.instantaneousFlows();return{
        config:{...this.config},controls:{...this.controls,cylinders:this.controls.cylinders.slice()},rpmEnvelope:rpmEnvelope(this.config),
        time:this.time,angle:this.angle,omega:this.omega,rpm:this.rpm,torque:this.torque,brakeTorque:this.brakeTorque,
        meanTorque:this.meanTorque,power:this.power,frictionTorque:this.frictionTorque,starterTorque:this.starterTorque,
        loadTorque:this.loadTorque,superchargerTorque:this.superchargerTorque,cycleReady:this.cycleReady,
        revCut:this.revCut,idle:{...this.idle},camPhaser:{...this.camPhaser},firingOffsets:this.offsets.slice(),cycleDegrees:this.cycleDegrees,chamberCount:this.count,displacement:displacement(this.config),fuelProperties:{...this.fuel},
        rotary:this.rotary?{rotors:Array.from({length:this.config.rotorCount},(_,i)=>{const eccentricAngle=this.angle-i*TAU/this.config.rotorCount+PI/2;return {rotorIndex:i,rotorAngle:eccentricAngle/3,eccentricAngle,omega:this.omega/3,center:{x:this.config.eccentricity*Math.cos(eccentricAngle),y:this.config.eccentricity*Math.sin(eccentricAngle)}};})}:null,
        cyl:this.cyl.map((z,i)=>({...copyGas(z),x:z.x,velocity:this.rotary?null:this._geoms[i].dx*this.omega,phase:z.phase,mechanicalAngle:z.mechanicalAngle,dV:this._geoms[i].dV,rotorIndex:z.rotorIndex,faceIndex:z.faceIndex,
          liftIn:z.liftIn,liftEx:z.liftEx,areaIn:z.areaIn,areaEx:z.areaEx,fresh:(z.air+z.fuel)/z.m,residual:z.burned/z.m,
          lambda:z.fuel>1e-14?z.air/(this.afr*z.fuel):null,burn:z.burn,burning:z.burning,spark:z.spark,events:z.events,heatTotal:z.heatTotal,
          lastSparkTime:z.lastSparkTime,lastSparkAngle:z.lastSparkAngle,lastBurnTime:z.lastBurnTime,sparkOpportunities:z.sparkOpportunities,
          injection:z.injection,injectionRate:z.injectionRate,lastInjectionTime:z.lastInjectionTime,lastInjectionAngle:z.lastInjectionAngle,
          injectionEvents:z.injectionEvents,ignitionDelay:z.lastIgnitionDelay})),
        intake:copyGas(this.intake),exhaust:copyGas(this.exhaust),crankcase:this.crankcase?copyGas(this.crankcase):null,
        crankcases:this.crankcases.map(copyGas),reedOpenings:this.reedOpenings.slice(),portsByCylinder:this.portsByCylinder.map(p=>({...p})),
        charge:this.charge?copyGas(this.charge):null,tailpipe:this.tailpipe?copyGas(this.tailpipe):null,
        boost:{...this.boost,compressorFlow:flows.compressor,turbineFlow:flows.turbine,wastegateFlow:flows.wastegate,bypassFlow:flows.bypass,
          ...(this._turboBranches?{units:this.boost.units.map((unit,i)=>{const links=this._turboBranches[i];return {...unit,
            compressorFlow:unit.compressorFlowState,turbineFlow:flowRate(this.exhaust,this.tailpipe,links.turbine.area,links.turbine.cd),
            wastegateFlow:flowRate(this.exhaust,this.tailpipe,links.wastegate.area,links.wastegate.cd),
            bypassFlow:flowRate(this.charge,this.ambient,links.bypass.area,links.bypass.cd)};})}:{})},
        flows,ports:{...this.ports},reedOpening:this.reedOpening,signal:{...this.signal,mechanics:{...this.signal.mechanics},
          ...(this.signal.drivetrain?{drivetrain:{...this.signal.drivetrain}}:{}),
          exhaustFlows:this.signal.exhaustFlows.slice(),intakeFlows:this.signal.intakeFlows.slice(),heatReleaseRates:this.signal.heatReleaseRates.slice(),heatPressureRates:this.signal.heatPressureRates.slice(),valveImpulses:this.signal.valveImpulses.slice(),
          exhaustMomentumFluxes:this.signal.exhaustMomentumFluxes.slice(),
          ...(this._turboBranches?{turboUnits:this.signal.turboUnits.map(unit=>({...unit}))}:{})},totals:{...this.totals},numerics:{...this.numerics},
        totalGasEnergy:this.rooms.reduce((s,g)=>s+g.U,0),warning:this.warning,events:this.events.map(e=>({...e}))
      };
    }
    serialize(){const out={};const omit=new Set(['ambient','rooms','_links','throttleLink','reedLink','transferLink','reedLinks','transferLinks','intakeLinks','exhaustLinks','tailLink','compressorLink','bypassLink','leakLink','turbineLink','wastegateLink']);
      for(const key of Object.keys(this))if(!omit.has(key))out[key]=this[key];return JSON.parse(JSON.stringify(out));}
    restore(state){
      if(!state||!state.config||state.config.kind!==this.config.kind||chamberCount(state.config)!==this.count||state.config.boost!==this.config.boost||state.config.combustion!==this.config.combustion)throw new Error('Zustand passt nicht zum Aufbau.');
      state=JSON.parse(JSON.stringify(state));
      const checked=validate(state.config);
      if(!checked.ok)throw new Error('Gesicherte Geometrie ungültig.');
      if((checked.config.firingOrder||'')!==(this.config.firingOrder||'')||Object.keys(this.config).some(k=>k!=='firingOrder'&&checked.config[k]!==this.config[k]))
        throw new Error('Gesicherter Gaszustand benötigt genau dieselbe Motorkonfiguration; geänderte Bauteile müssen neu initialisiert werden.');
      const expectedOffsets=firingOffsets(checked.config);
      if(!Array.isArray(state.offsets)||state.offsets.length!==expectedOffsets.length||state.offsets.some((value,index)=>value!==expectedOffsets[index]))
        throw new Error('Gesicherte Zylinderphasen passen nicht zur Zündfolge. Zylinderzustände werden nicht stillschweigend umgeordnet.');
      state.config=checked.config;
      const legacyAcoustics=state.acousticState===undefined;
      if(legacyAcoustics)state.acousticState=acousticState(this.config,this.count);
      const acoustic=state.acousticState,contacts=this.rotary?0:this.count;
      if(!acoustic||acoustic.version!==1||!Number.isFinite(acoustic.springEnergy)||acoustic.springEnergy<0||
        !Array.isArray(acoustic.pistonPosition)||acoustic.pistonPosition.length!==contacts||
        !Array.isArray(acoustic.pistonVelocity)||acoustic.pistonVelocity.length!==contacts||
        acoustic.pistonPosition.some(x=>!Number.isFinite(x)||Math.abs(x)>this.config.pistonClearance+1e-12)||
        acoustic.pistonVelocity.some(x=>!Number.isFinite(x)))throw new Error('Gesicherter mechanischer Akustikzustand ungültig.');
      const savedMechanics=state.signal?.mechanics;
      if(savedMechanics){
        const template=mechanicsSignal(this.config);
        if(typeof savedMechanics!=='object'||Object.keys(template).some(key=>key==='timingChain'?
          savedMechanics[key]!==template[key]:!Number.isFinite(savedMechanics[key]))||
          savedMechanics.timingTeeth!==this.config.timingCrankTeeth||savedMechanics.pistonContactImpulse<0||
          savedMechanics.pistonContactEnergy<0||savedMechanics.frictionPower<0)
          throw new Error('Gesichertes mechanisches Akustiksignal ungültig.');
      }
      const savedMomentum=state.signal?.exhaustMomentumFluxes,savedMomentumTotal=state.signal?.exhaustMomentumFlux;
      const legacyMomentum=savedMomentum===undefined&&savedMomentumTotal===undefined;
      if(!legacyMomentum){
        if(!Array.isArray(savedMomentum)||savedMomentum.length!==this.count||savedMomentum.some(x=>!Number.isFinite(x))||
          !Number.isFinite(savedMomentumTotal))throw new Error('Gesichertes Auslass-Impulsstromsignal ungültig.');
        let total=0,magnitude=0;for(const value of savedMomentum){total+=value;magnitude+=Math.abs(value);}
        if(!Number.isFinite(total)||!Number.isFinite(magnitude)||Math.abs(total-savedMomentumTotal)>Math.max(1e-10,magnitude*1e-12))
          throw new Error('Gesicherter Auslass-Impulsstrom passt nicht zu seinen Kammern.');
      }
      // Preserve key order for deterministic JSON handoffs. Old saves receive
      // neutral defaults, never the targets of a previously used instance.
      state.controls={...state.controls};
      for(const [key,value] of [['boostTarget',checked.config.boostTarget],['intakeCamAdvance',0],['exhaustCamAdvance',0]])
        if(!Object.prototype.hasOwnProperty.call(state.controls,key))state.controls[key]=value;
      state.camPhaser={intakeAdvance:0,exhaustAdvance:0,...state.camPhaser};
      if(!Object.values(state.camPhaser).every(Number.isFinite)||Math.abs(state.camPhaser.intakeAdvance)>40||Math.abs(state.camPhaser.exhaustAdvance)>40)
        throw new Error('Gesicherte Nockenstellung ungültig.');
      const phasing=validateCamTargets(checked.config,{intakeCamAdvance:state.controls.intakeCamAdvance,exhaustCamAdvance:state.controls.exhaustCamAdvance});
      const currentPhasing=validateCamTargets(checked.config,{intakeCamAdvance:state.camPhaser.intakeAdvance,exhaustCamAdvance:state.camPhaser.exhaustAdvance});
      if(!phasing.ok||!currentPhasing.ok)throw new Error([...phasing.errors,...currentPhasing.errors].join('\n'));
      if(!this._turboBranches&&(state.boost?.units!==undefined||state.signal?.turboUnits!==undefined))
        throw new Error('Twin-Turbo-Zustände benötigen eine aktive Konfiguration mit zwei Ladern.');
      if(this._turboBranches){const units=state.boost?.units,signals=state.signal?.turboUnits;
        if(!Array.isArray(units)||units.length!==2||!Array.isArray(signals)||signals.length!==2)
          throw new Error('Twin-Turbo-Spielstand benötigt beide Wellen- und Signalzustände.');
        const template=this.boost.units[0],numeric=Object.keys(template).filter(key=>typeof template[key]==='number');
        const signalNumeric=Object.keys(this.signal.turboUnits[0]);
        for(let i=0;i<2;i++){const b=units[i],s=signals[i];
          if(!b||b.kind!=='turbo'||!numeric.every(key=>Number.isFinite(b[key]))||typeof b.surgeActive!=='boolean'||
            b.energy<0||b.omega<0||b.rpm<0||b.compressorInertialEnergy<0||!Number.isInteger(b.surgeEvents)||b.surgeEvents<0||
            b.wastegateOpening<0||b.wastegateOpening>1||b.bypassOpening<0||b.bypassOpening>1||
            !s||!signalNumeric.every(key=>Number.isFinite(s[key])))throw new Error('Gesicherter Turboladerzustand ungültig.');
          const rotor=.5*checked.config.turboInertia*b.omega*b.omega,duct=.5*this._compressorInertance*b.compressorFlowState*b.compressorFlowState;
          if(Math.abs(b.energy-rotor)>Math.max(1e-10,rotor*1e-12)||Math.abs(b.compressorInertialEnergy-duct)>Math.max(1e-10,duct*1e-12)||
            Math.abs(b.rpm-b.omega*60/TAU)>Math.max(1e-8,b.rpm*1e-12))throw new Error('Gesicherte Turboenergie passt nicht zu Drehzahl oder Kanalströmung.');
        }
      }
      // Legacy saves have no duct momentum. Its new energy store starts at
      // rest; every pre-existing gas, crank and turbo-rotor energy is retained.
      state.boost={...this.boost,...state.boost};state.totals={...this.totals,...state.totals};
      state.signal={...this.signal,...state.signal,mechanics:savedMechanics?{...savedMechanics}:mechanicsSignal(this.config),
        exhaustMomentumFluxes:legacyMomentum?Array(this.count).fill(0):savedMomentum.slice(),exhaustMomentumFlux:legacyMomentum?0:savedMomentumTotal};
      // VehicleCore owns shaft/contact observables. An engine-only restore
      // cannot keep a vehicle's last gearbox/chain load alive indefinitely.
      // A full VehicleCore.restore reattaches its own validated source copy.
      delete state.signal.drivetrain;
      const roomKeys=['intake','exhaust','crankcase','charge','tailpipe'];
      for(const[key,value]of Object.entries(state))if(!roomKeys.includes(key)&&key!=='cyl'&&key!=='crankcases'&&key!=='_compiled'&&key!=='_derivedCache')this[key]=value;
      if(!this.config.revLimiterEnabled)this.revCut=false;
      this._compiled=compileEngine(this.config,this.offsets);
      this._derivedCache.dt=NaN;this._derivedCache.throttle=NaN;
      if(this._turboBranches)this._sumTurboUnits();
      for(const k of roomKeys)if(this[k])Object.assign(this[k],state[k]);
      for(let i=0;i<this.crankcases.length;i++)Object.assign(this.crankcases[i],state.crankcases?.[i]||state.crankcase);
      for(let i=0;i<this.count;i++)Object.assign(this.cyl[i],state.cyl[i]);
      this.crankcase=this.crankcases[0]||null;this.ports=this.portsByCylinder[0]||this.ports;
      if(this.two){this.flows.reeds??=[this.flows.reed];this.flows.transfers??=[this.flows.transfer];}
      this._bindSignals();
      this.signal.turbinePower=this.boost.turbinePower;this.signal.wastegateFlow=this.flows.wastegate;this.signal.wastegateOpening=this.boost.wastegateOpening;
      this._geom=this._geoms[0];
      if(!savedMechanics){
        const m=this.signal.mechanics;m.crankAngle=this.angle;m.crankOmega=this.omega;
        if(!this.two&&!this.rotary){m.timingAngle=this.angle;m.timingOmega=this.omega;}
      }
      if(legacyAcoustics){
        this.signal.manifoldPressure=this.exhaust.p;this.signal.manifoldTemp=this.exhaust.T;
        this.signal.manifoldFlow=this.signal.exhaustFlow;
      }
      // Link objects belong to the new instance and are deliberately not
      // serialized. Rebuild their areas before a paused snapshot can be read.
      // Preserve the stored machine-valve state, whose RPM controller is
      // evaluated within the regular integration sequence.
      const wastegate=this.boost.wastegateOpening,bypass=this.boost.bypassOpening;
      const unitValves=this._turboBranches?this.boost.units.map(b=>[b.wastegateOpening,b.bypassOpening]):null;
      this._openings(this._geoms,this.angle);
      if(legacyAcoustics)this.acousticState.springEnergy=this._valveSpringEnergy();
      if(this.charge){this.boost.wastegateOpening=wastegate;this.boost.bypassOpening=bypass;
        if(this._turboBranches){for(let i=0;i<2;i++){const b=this.boost.units[i],links=this._turboBranches[i];
          b.wastegateOpening=unitValves[i][0];b.bypassOpening=unitValves[i][1];
          links.wastegate.area=this.config.wastegateArea*b.wastegateOpening;links.bypass.area=this.config.bypassArea*b.bypassOpening;
        }}else{if(this.wastegateLink)this.wastegateLink.area=this.config.wastegateArea*wastegate;
          this.bypassLink.area=this.config.bypassArea*bypass;}}
      this._check();
    }
  }
  return {Engine,defaults,familyDefaults,sizeForDisplacement,rpmEnvelope,rpmSettings,geometryMargins,validate,validateCamTargets,geometry,motionCheck,valveLifts,portAreas,rotaryPortAreas,rotaryGeometry,layoutGeometry,layoutInfo,layoutCounts,flowRate,firingOffsets,cycleDegrees,chamberCount,displacement,chamberLabel,layoutLabel,fuelProperties,fuels:FUELS,parameterLimits,
    constants:{R,CV,CP,GAMMA,AFR,LHV,DT,DEG,TAU},mod};
})();


/* Fahrzeuglabor: straight-line vehicle, dry clutch and synchronized manual gearbox.
   All state advances in simulated time. SI units; clutch pedal 1 means open.
   The engine receives only balanced shaft impulses, never a prescribed RPM. */
const VehicleCore = (() => {
  'use strict';
  const Math=globalThis.Math,Number=globalThis.Number;
  const DT = 1 / 24000, G = 9.80665, DEG = Math.PI / 180, MAX_GEARS = 12;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const copy = x => JSON.parse(JSON.stringify(x));
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const DRIVER_KEYS = new Set(['clutch', 'brake', 'parking', 'reverseUnlock', 'gearRequest']);
  const controlDefaults = () => ({clutch: 1, brake: 0, parking: true, reverseUnlock: false});
  function drivetrainSignal(c){return {inputAngle:0,inputOmega:0,wheelAngle:0,wheelOmega:0,outputOmega:0,
    meshLoad:0,gearLossPower:0,clutchSlipPower:0,synchPower:0,engageImpulse:0,gear:0,
    meshTeeth:c.meshTeeth,finalChain:c.finalDriveType==='chain',chainAngle:0,chainOmega:0,
    chainLoad:0,chainTeeth:c.chainDriveTeeth};}

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
      finalDriveType:'chain',chainDriveTeeth:11,
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

  // Gearbox selections reuse the documented ratios, not an entire vehicle.
  // Engine, clutch, tyre, mass, speed governor and shift mechanics stay owned
  // by the caller's configuration. These are manual-ratio reference sets.
  function transmissionProfiles() {
    const names={bestia50:'Bestia SM 50 / AM6-Referenz',hellcat:'Hellcat / Tremec TR-6060',
      'bmw-m3-e46-2002-us':'BMW M3 E46 / Getrag Type D','bmw-330i-e46-2001-us':'BMW 330i E46 / ZF Type C',
      'bmw-m5-e39-2003-us':'BMW M5 E39','ford-mustang-boss302-1969':'Ford Mustang Boss 302',
      'chevrolet-camaro-z28-1969':'Chevrolet Camaro Z/28 / Muncie M20',renesis:'Mazda RX-8 Sport',f1v12:'F1-V12 / Streckenmodell'};
    return Object.entries(names).map(([modelId,label])=>{
      const p=VEHICLE_PROFILES[modelId];
      return {id:'model:'+modelId,modelId,label,gearCount:p.gears.length,
        description:modelId==='bestia50'?'Dokumentierte AM6-Referenzpaare, Primärstufe 3,55 und Modellritzel 62/11. Kein Nachweis der vollständigen Bestia-Serienabstufung.':
          modelId==='f1v12'?'Deklarierte Streckenübersetzungen des F1-V12-Modells; keine belegten Ferrari-Zähnezahlen.':
          'Übersetzungen der vorhandenen dokumentierten Fahrzeugvorlage. Motor, Kupplung und Fahrzeugdaten werden nicht übernommen.',
        drivetrain:{gears:p.gears.slice(),primaryDrive:p.primaryDrive,finalDrive:p.finalDrive,
          reverseRatio:p.reverseRatio,reverseEnabled:p.reverseEnabled}};
    });
  }

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
      // Explicit acoustic geometry. These effective contact counts do not
      // alter ratios and are not claims about manufacturer gear tooth counts.
      finalDriveType:'shaft',meshTeeth:24,chainDriveTeeth:14,
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
    rollingResistance:[0,.15],dragArea:[0,30],brakeForce:[0,1e6],parkingForce:[0,1e6],slope:[-45,45],
    meshTeeth:[6,100],chainDriveTeeth:[6,100]
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
    if(!['shaft','chain','belt'].includes(d.finalDriveType))errors.push('Sekundärantrieb: shaft, chain oder belt erforderlich.');
    for(const key of ['meshTeeth','chainDriveTeeth'])if(!Number.isInteger(d[key]))errors.push(key+': ganzzahlige effektive Kontaktzahl erforderlich.');
    if (!Array.isArray(d.gears) || d.gears.length < 1 || d.gears.length > MAX_GEARS ||
        d.gears.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < ranges.gears[0] || v > ranges.gears[1]))
      errors.push('Gangübersetzungen: ein bis '+MAX_GEARS+' Zahlen zwischen '+ranges.gears[0]+' und '+ranges.gears[1]+' erforderlich.');
    else {
      if(d.gears.some((v,i)=>i>0&&v>=d.gears[i-1]))errors.push('Gangübersetzungen müssen vom ersten zum letzten Gang abnehmen.');
      d.gears = d.gears.slice();
    }
    return {ok: errors.length === 0, errors, config: {engine: e.config, drivetrain: d}};
  }

  function gearInfo(configuration,options={}) {
    const c=configuration.drivetrain,e=configuration.engine;
    const primaryDrive=c.primaryDrive===undefined?1:c.primaryDrive;
    const wheelCircumference=2*Math.PI*c.wheelRadius,redlineRpm=e.redlineRpm;
    const limits=EngineCore.rpmSettings?EngineCore.rpmSettings(e):{redlineEnabled:e.redlineEnabled!==false,revLimiterEnabled:e.revLimiterEnabled!==false,limitRpm:e.revLimitRpm>0?e.revLimitRpm:redlineRpm};
    const requestedRpm=options.referenceRpm===undefined?(limits.revLimiterEnabled?limits.limitRpm:redlineRpm):options.referenceRpm;
    if(options.referenceRpm!==undefined&&(!Number.isFinite(requestedRpm)||requestedRpm<=0))throw new Error('Getriebeübersicht benötigt eine positive Referenzdrehzahl.');
    const referenceRpm=Number.isFinite(requestedRpm)&&requestedRpm>0?requestedRpm:null;
    return {gearCount:c.gears.length,maxGears:MAX_GEARS,primaryDrive,finalDrive:c.finalDrive,wheelCircumference,
      redlineRpm,referenceRpm,redlineEnabled:limits.redlineEnabled,revLimiterEnabled:limits.revLimiterEnabled,limitRpm:limits.limitRpm,
      reverseEnabled:c.reverseEnabled!==false,speedLimit:c.speedLimit||0,
      gears:c.gears.map((ratio,i)=>{
        const totalRatio=primaryDrive*ratio*c.finalDrive;
        const kmhPer1000Rpm=wheelCircumference*60/totalRatio;
        return {gear:i+1,ratio,totalRatio,kmhPer1000Rpm,
          speedAtRedlineKmh:kmhPer1000Rpm*redlineRpm/1000,
          nextGearRpmAtRedline:i+1<c.gears.length?redlineRpm*c.gears[i+1]/ratio:null,
          speedAtReferenceKmh:referenceRpm===null?null:kmhPer1000Rpm*referenceRpm/1000,
          nextGearRpmAtReference:referenceRpm!==null&&i+1<c.gears.length?referenceRpm*c.gears[i+1]/ratio:null};
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
      this.acousticState={version:1,inputAngle:0};
      // The mechanical interface also supports an injected inertial engine
      // with no sound API. Keep observers owned by the vehicle and attach
      // them only when the engine supplies a signal object.
      Object.defineProperty(this,'_driveAcoustics',{value:drivetrainSignal(dc),writable:true});
      this._bindAcousticSignal();
      this._acousticSynchImpulse=0;this._acousticEngageImpulse=0;
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
        this._acousticSynchImpulse+=impulse;
        this.inputOmega -= impulse / c.gearboxInertia;
        d.v += n * impulse / jv * c.wheelRadius;
        this._totals.synchHeat += Math.max(0, impulse * relative - .5 * impulse * impulse * inverse);
      }
      const synced = !n || Math.abs(this.inputOmega - n * d.v / c.wheelRadius) < 1e-7;
      if (s.elapsed >= c.shiftTime && synced) {
        if (s.target === -1 && (Math.abs(d.v) >= .35 || !this._driver.reverseUnlock)) {
          d.message = Math.abs(d.v) >= .35 ? 'R nur bei Stillstand' : 'R-Sperre freigeben';
        } else if (s.target > 0 && d.v <= -.35) d.message = 'Vorwärts nur bei Stillstand';
        else { d.gear = s.target; d.ratio = n; d.message = '';
          this._acousticEngageImpulse=Math.abs(this._acousticSynchImpulse); }
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
      const beforeGearLoss=this._totals.gearboxLoss,beforeClutchHeat=this._totals.clutchHeat,beforeSynchHeat=this._totals.synchHeat;
      this._acousticSynchImpulse=0;this._acousticEngageImpulse=0;
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
      this.acousticState.inputAngle+=.5*(beforeInputOmega+this.inputOmega)*dt;
      this._observeDrivetrain(dt,beforeGearLoss,beforeClutchHeat,beforeSynchHeat);
    }

    _bindAcousticSignal(){
      const signal=this.engine.signal;
      if(signal&&typeof signal==='object'&&!Array.isArray(signal))signal.drivetrain=this._driveAcoustics;
    }

    _observeDrivetrain(dt,beforeGearLoss,beforeClutchHeat,beforeSynchHeat){
      const d=this.drive,c=this.config.drivetrain,s=this._driveAcoustics,t=this._totals;
      s.inputAngle=this.acousticState.inputAngle;s.inputOmega=this.inputOmega;
      s.wheelAngle=d.distance/c.wheelRadius;s.wheelOmega=d.v/c.wheelRadius;
      s.outputOmega=s.wheelOmega*c.finalDrive;s.gear=d.gear;
      // Ideal ratios have no resolved tooth deflection/transmission error.
      // These passive torque/phase observables drive the declared effective
      // acoustic contact model, never an extra vehicle force or an RPM loop.
      s.meshLoad=d.ratio?d.clutchTorque-this._gearLossTorque-c.gearboxInertia*(d.inputAcceleration||0):this._gearLossTorque;
      s.gearLossPower=Math.max(0,t.gearboxLoss-beforeGearLoss)/dt;
      s.clutchSlipPower=Math.max(0,t.clutchHeat-beforeClutchHeat)/dt;
      s.synchPower=Math.max(0,t.synchHeat-beforeSynchHeat)/dt;
      s.engageImpulse=this._acousticEngageImpulse;
      s.chainAngle=s.finalChain?s.wheelAngle*c.finalDrive:0;
      s.chainOmega=s.finalChain?s.outputOmega:0;
      s.chainLoad=s.finalChain&&d.ratio?d.tractiveForce*c.wheelRadius/c.finalDrive:0;
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
      const acoustic=this._driveAcoustics;
      if(acoustic){
        acoustic.gear=d.gear;acoustic.inputAngle=this.acousticState.inputAngle;acoustic.inputOmega=this.inputOmega;
        acoustic.wheelAngle=d.distance/c.wheelRadius;acoustic.wheelOmega=d.v/c.wheelRadius;
        acoustic.outputOmega=acoustic.wheelOmega*c.finalDrive;
        acoustic.chainAngle=acoustic.finalChain?acoustic.wheelAngle*c.finalDrive:0;
        acoustic.chainOmega=acoustic.finalChain?acoustic.outputOmega:0;
        if(!d.ratio){acoustic.meshLoad=this._gearLossTorque;acoustic.chainLoad=0;}
      }
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
        acousticState:{...this.acousticState},
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
      if(state.acousticState!==undefined&&(!state.acousticState||state.acousticState.version!==1||
        !Number.isFinite(state.acousticState.inputAngle)))throw new Error('Gesicherte akustische Wellenphase ungültig.');
      const acousticSignal=state.engine.signal?.drivetrain,template=drivetrainSignal(this.config.drivetrain);
      if(acousticSignal&&Object.keys(template).some(key=>key==='finalChain'?acousticSignal[key]!==template[key]:
        !Number.isFinite(acousticSignal[key])))throw new Error('Gesichertes Antriebsakustiksignal ungültig.');
      if(acousticSignal&&(acousticSignal.meshTeeth!==template.meshTeeth||acousticSignal.chainTeeth!==template.chainTeeth||
        !Number.isInteger(acousticSignal.gear)||acousticSignal.gear!==state.drive.gear||
        acousticSignal.gearLossPower<0||acousticSignal.clutchSlipPower<0||acousticSignal.synchPower<0||acousticSignal.engageImpulse<0))
        throw new Error('Gesichertes Antriebsakustiksignal passt nicht zur Konfiguration.');
      this.engine.restore(copy(state.engine));
      this.acousticState=state.acousticState?{...state.acousticState}:{version:1,inputAngle:0};
      this._driveAcoustics=acousticSignal?{...acousticSignal}:template;
      this._bindAcousticSignal();
      this._acousticSynchImpulse=0;this._acousticEngageImpulse=0;
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
      if(!acousticSignal)this._observeDrivetrain(this.dt,this._totals.gearboxLoss,this._totals.clutchHeat,this._totals.synchHeat);
      return this;
    }
  }
  return {Simulation, defaults, validate, gearInfo, transmissionProfiles, parameterLimits, MAX_GEARS, constants: {DT, G}, driverKeys: Array.from(DRIVER_KEYS)};
})();


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


export {MotorLab, EngineCore, VehicleCore, SimulationDriver};
export default MotorLab;
