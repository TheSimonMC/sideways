// Adapter for the bundled MotorLab 1.6.3 Session. Its public controls have no
// blower-belt input. These coefficients are read directly by the native gas/
// shaft solver, not cached in its compiled geometry. Apply them only around
// the existing update/PCM step, then restore the hardware configuration.
// No SDK files, chamber state, shaft speed, clock or accumulated work change
// outside the native solver. A new SDK version must revalidate this contract.
export function advanceInduction(engine,condition,advance){
 if(!condition?.charged)return advance();
 const core=engine._model,c=core?.config;
 if(engine.kind!=='engine'||!c||!['turbo','supercharger'].includes(c.boost))throw new Error('MotorLab induction adapter does not match this engine.');
 const original={intercoolerEfficiency:c.intercoolerEfficiency};
 c.intercoolerEfficiency*=condition.coolerHealth;
 if(condition.active){
  for(const key of ['superchargerRatio','superchargerDisplacement','superchargerFriction','compressorEfficiency'])original[key]=c[key];
  c.superchargerRatio*=condition.drive;c.superchargerDisplacement*=condition.flow;c.superchargerFriction*=condition.friction;c.compressorEfficiency*=condition.efficiency;
 }
 let state;
 try{state=advance();}finally{Object.assign(c,original);}
 // update() returns a copied snapshot taken during the step. Publish the
 // installed hardware values alongside the actual resulting gas/shaft data.
 if(state?.config)Object.assign(state.config,original);
 return state;
}
