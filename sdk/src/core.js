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
