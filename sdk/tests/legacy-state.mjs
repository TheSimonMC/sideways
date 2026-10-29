// Release 13 adds passive acoustic observers. They never feed forces, gas
// transport or drivetrain work back into the pre-existing state. The separate
// mechanical source suite compares every remaining field with immutable v12.
// List every addition explicitly; unknown changes must still fail comparison.
export function release12State(value) {
  const state=release13State(value);
  const config=c=>{
    if(c)for(const key of ['timingDrive','timingCrankTeeth'])delete c[key];
  };
  const engine=s=>{
    if(!s)return;
    config(s.config);
    delete s.acousticState;
    if(s.signal)for(const key of ['manifoldPressure','manifoldTemp','manifoldFlow','mechanics','drivetrain'])delete s.signal[key];
  };
  if(state.engine&&state.configuration){
    config(state.configuration.engine);
    if(state.configuration.drivetrain)for(const key of ['finalDriveType','meshTeeth','chainDriveTeeth'])delete state.configuration.drivetrain[key];
    delete state.acousticState;
    engine(state.engine);
  }else engine(state);
  return state;
}

// Release 11 separates the visible redline and the optional fuel/ignition cut.
// Only the neutral defaults are equivalent to release 10. A disabled or
// independently configured limiter must never be hidden by this projection.
export function release10State(value) {
  const state=release12State(value);
  const config=c=>{
    if(!c)return;
    for(const [key,neutral] of [['redlineEnabled',true],['revLimiterEnabled',true],['revLimitRpm',0]]){
      if(c[key]!==undefined&&c[key]!==neutral)throw new Error('Only default RPM settings can be compared with release 10: '+key);
      delete c[key];
    }
  };
  if(state.engine&&state.configuration){config(state.configuration.engine);config(state.engine.config);}
  else config(state.config);
  return state;
}
// Release 10 adds the explicit hardware count. Parallel twin states have no
// release-9 counterpart and must never silently pass a single-turbo comparison.
export function release9State(value) {
  const state=release10State(value);
  const config=c=>{
    if(!c)return;
    if(c.turboCount!==undefined&&c.turboCount!==1)throw new Error('Only single-turbo configurations can be compared with release 9.');
    delete c.turboCount;
  };
  if(state.engine&&state.configuration){config(state.configuration.engine);config(state.engine.config);}
  else config(state.config);
  return state;
}
// Release 9 adds these explicit fields. Every pre-existing state value remains
// part of compatibility comparisons against the immutable release-8 core.
// Do not recursively drop unknown keys: an unintended state change must fail.
export function release8State(value) {
  const state=release9State(value);
  const controls=u=>{if(u)for(const key of ['boostTarget','intakeCamAdvance','exhaustCamAdvance'])delete u[key];};
  const engine=s=>{
    if(s.config)delete s.config.camPhaserRate;
    controls(s.controls);
    delete s.camPhaser;
    if(s.signal)for(const key of ['turbinePower','wastegateFlow','wastegateOpening'])delete s.signal[key];
    return s;
  };
  if(state.engine&&state.configuration){
    delete state.configuration.engine.camPhaserRate;
    controls(state.controls);
    engine(state.engine);
    return state;
  }
  return engine(state);
}
// Release 14 can author an explicit cylinder firing sequence. A nonempty
// sequence changes actual chamber phases and must never be hidden by a legacy
// projection. Missing or explicitly empty keeps the original phase schedule.
export function release13State(value) {
  const state=release14State(value);
  const config=c=>{
    if(!c||!Object.prototype.hasOwnProperty.call(c,'firingOrder'))return;
    if(c.firingOrder!=='')throw new Error('Only the unchanged legacy firing sequence can be compared with release 13.');
    delete c.firingOrder;
  };
  if(state.engine&&state.configuration){config(state.configuration.engine);config(state.engine.config);}
  else config(state.config);
  return state;
}

// The load-response correction adds only these two passive observations.
// Preserve every earlier field and every unknown field in exact comparisons.
export function release14State(value) {
  const state=JSON.parse(JSON.stringify(value));
  const engine=s=>{if(s?.signal){delete s.signal.exhaustMomentumFluxes;delete s.signal.exhaustMomentumFlux;}};
  if(state.engine&&state.configuration)engine(state.engine);else engine(state);
  return state;
}

