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

