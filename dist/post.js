import * as THREE from './vendor/three.module.js';

export class ComicRenderer {
  constructor(renderer) {
    this.renderer=renderer;
    this.target=new THREE.WebGLRenderTarget(1,1,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,type:THREE.HalfFloatType,depthBuffer:true});
    this.target.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
    this.target.depthTexture.format=THREE.DepthFormat;
    this.previous=new THREE.Matrix4();this.current=new THREE.Matrix4();this.inverse=new THREE.Matrix4();this.first=true;
    this.clip=new THREE.Vector4();this.motionFocus=new THREE.Vector2(.5,.48);this.focusTarget=new THREE.Vector2(.5,.48);
    this.playerMatrix=new THREE.Matrix4();this.playerYaw=new THREE.Matrix4();this.playerEuler=new THREE.Euler();this.bodyBounds={width:2.03,length:4.42,height:1.31,rideHeight:0};
    this.scene=new THREE.Scene();this.camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    this.material=new THREE.ShaderMaterial({
      depthTest:false,depthWrite:false,
      uniforms:{
        tDiffuse:{value:this.target.texture},tDepth:{value:this.target.depthTexture},tBloom:{value:null},bloomAmount:{value:.45},
        inverseVP:{value:this.inverse},previousVP:{value:this.previous},
        resolution:{value:new THREE.Vector2(1,1)},nearFar:{value:new THREE.Vector2(.16,950)},
        amount:{value:.65},speed:{value:0},boost:{value:0},retro:{value:0},time:{value:0},exposureTime:{value:0},vignetteAmount:{value:.38},shadingAmount:{value:.6},heat:{value:0},
        motionActive:{value:0},cameraMode:{value:0},motionFocus:{value:this.motionFocus},
        playerPosition:{value:new THREE.Vector3()},playerDirection:{value:new THREE.Vector2(0,1)},playerInverseBasis:{value:new THREE.Matrix3()},playerHalfSize:{value:new THREE.Vector3(1.16,1.85,2.48)},playerGround:{value:0},
        playerScreenRect:{value:new THREE.Vector4(0,0,1,1)},playerEnabled:{value:0}
      },
      vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
      fragmentShader:`precision highp float;
        varying vec2 vUv;
        uniform sampler2D tDiffuse,tDepth,tBloom;
        uniform float bloomAmount;
        uniform mat4 inverseVP,previousVP;
        uniform vec2 resolution,nearFar,motionFocus,playerDirection;
        uniform vec3 playerPosition,playerHalfSize;
        uniform mat3 playerInverseBasis;
        uniform float playerGround;
        uniform vec4 playerScreenRect;
        uniform float amount,speed,boost,retro,time,exposureTime,motionActive,cameraMode,playerEnabled,vignetteAmount,shadingAmount,heat;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float viewDepth(float depth){return nearFar.x*nearFar.y/max(.00001,nearFar.y-depth*(nearFar.y-nearFar.x));}
        vec3 worldPosition(vec2 uv,float depth){
          vec4 p=inverseVP*vec4(uv*2.-1.,depth*2.-1.,1.);
          return p.xyz/(abs(p.w)>.000001?p.w:.000001);
        }
        bool insidePlayerScreen(vec2 uv){
          return playerEnabled>.5&&uv.x>=playerScreenRect.x&&uv.y>=playerScreenRect.y&&uv.x<=playerScreenRect.z&&uv.y<=playerScreenRect.w;
        }
        float playerMask(vec2 uv,vec3 world){
          if(!insidePlayerScreen(uv))return 0.;
          vec3 p=playerInverseBasis*(world-playerPosition);
          // Only pixels whose reconstructed depth lies on the car are protected.
          // Ground in its screen rectangle continues to carry full world motion.
          float footprint=max(abs(p.x)/playerHalfSize.x,abs(p.z)/playerHalfSize.z);
          float body=(1.-smoothstep(.98,1.035,footprint))*smoothstep(.045,.10,p.y)*(1.-smoothstep(playerHalfSize.y-.12,playerHalfSize.y,p.y))*smoothstep(playerGround+.025,playerGround+.06,world.y);
          return body;
        }
        void main(){
          vec2 uv=vUv;float depth=texture2D(tDepth,uv).r;
          vec3 world=worldPosition(uv,depth);
          vec4 prev=previousVP*vec4(world,1.);
          vec2 oldUV=prev.w>.0001?prev.xy/prev.w*.5+.5:uv;
          float player=playerMask(uv,world);
          float distanceToCamera=viewDepth(depth);
          float nearWorld=1.-smoothstep(140.,550.,distanceToCamera);
          vec2 centered=(uv-motionFocus)*vec2(resolution.x/resolution.y,1.);
          float periphery=smoothstep(.16,.78,length(centered));
          float focus=smoothstep(.04,.36,length((uv-vec2(.5,.48))*vec2(1.,1.2)));
          // Static-world reprojection contains real camera translation and rotation.
          // A short exposure in seconds keeps road speed consistent across frame rates.
          vec2 velocity=(uv-oldUV)*exposureTime*(.92+.74*periphery+boost*.34)*mix(.38,1.,nearWorld);
          // Chase and hood get a restrained forward streak around their true vanishing point.
          // Top-down uses only world flow, which also works while travelling sideways.
          if(cameraMode>.5)velocity+=(uv-motionFocus)*(speed*.0048+boost*.016)*periphery*nearWorld;
          velocity*=amount*motionActive*(1.-player);
          if(depth>.99998)velocity*=.12;
          float maxPixels=(28.+speed*35.+boost*40.)*resolution.y/900.;
          velocity*=min(1.,maxPixels/max(.0001,length(velocity*resolution)));
          vec3 color=texture2D(tDiffuse,uv).rgb;
          if(amount>.001&&motionActive>.001&&player<.985&&length(velocity*resolution)>.3){
            vec3 accumulated=vec3(0.);float weights=0.;
            for(int i=0;i<12;i++){
              float f=float(i)/11.-.5;float w=1.-abs(f)*.7;
              vec2 p=clamp(uv+velocity*f,vec2(.001),vec2(.999));
              float sampleDepth=texture2D(tDepth,p).r;
              float relativeDepth=abs(viewDepth(sampleDepth)-distanceToCamera)/max(2.,distanceToCamera);
              // Depth breaks keep a nearby wall from smearing through the skyline.
              w*=1.-smoothstep(.20,.65,relativeDepth);
              // A world tap must not pick up and streak the tracked player car.
              if(insidePlayerScreen(p))w*=1.-playerMask(p,worldPosition(p,sampleDepth));
              accumulated+=texture2D(tDiffuse,p).rgb*w;weights+=w;
            }
            if(weights>.001)color=accumulated/weights;
          }
          // Local depth contacts darken creases; small depth edges retain the ink style.
          // Large distant depth breaks are excluded from contact shading to avoid halos.
          if(shadingAmount>.001&&depth<.99995){
            float occlusion=0.;float edge=0.;vec2 pixel=1./resolution;
            for(int tap=0;tap<6;tap++){
              float angle=float(tap)*1.04719755;vec2 offset=vec2(cos(angle),sin(angle));
              float neighbor=texture2D(tDepth,clamp(uv+offset*pixel*2.8,.001,.999)).r;
              float delta=distanceToCamera-viewDepth(neighbor);
              occlusion+=smoothstep(.025,.16,delta)*(1.-smoothstep(.65,2.0,delta));
              edge=max(edge,smoothstep(.012,.050,abs(delta)/max(2.,distanceToCamera)));
            }
            color*=1.-min(.24,occlusion*.044)*shadingAmount;
            color=mix(color,vec3(.035,.045,.075),edge*.15*shadingAmount);
          }
          color+=texture2D(tBloom,uv).rgb*bloomAmount;
          // Preserve the original comic color, dither, vignette and halftone treatment.
          color*=1.12;
          color=clamp((color*(2.51*color+.03))/(color*(2.43*color+.59)+.14),0.,1.);
          color=pow(color,vec3(1./2.2));
          float aberration=(speed*.0006+boost*.0013)*amount*focus*motionActive*(1.-player);
          color.r=mix(color.r,texture2D(tDiffuse,clamp(uv+vec2(aberration,0.),.001,.999)).r,.24);
          color.b=mix(color.b,texture2D(tDiffuse,clamp(uv-vec2(aberration,0.),.001,.999)).b,.24);
          float luma=dot(color,vec3(.299,.587,.114));color=mix(vec3(luma),color,1.07);
          float dither=hash(floor(uv*resolution))-.5;
          color=floor(color*(90.-retro*65.)+dither*.65+.5)/(90.-retro*65.);
          float rim=smoothstep(.26,.83,length((uv-.5)*vec2(1.,.9)));
          float shade=1.-rim*vignetteAmount*.66;
          color*=shade;
          color+=vec3(.028,.006,.010)*rim*heat*vignetteAmount;
          float dotGrid=step(.82,fract(uv.x*resolution.x*.25))*step(.82,fract(uv.y*resolution.y*.25));
          color*=1.-dotGrid*(1.-smoothstep(.05,.38,luma))*(.08+retro*.07);
          // NOS lights the outside of the frame, while the road ahead and the
          // player's body remain readable. No full-screen flashing.
          float nosRim=smoothstep(.24,.78,length((uv-.5)*vec2(1.25,1.))) * boost * motionActive * amount * (1.-player);
          color+=vec3(.10,.55,.90)*nosRim*.42;
          gl_FragColor=vec4(max(color,0.),1.);
        }`
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.material));
    this.bloomA=new THREE.WebGLRenderTarget(1,1,{depthBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,type:THREE.HalfFloatType});
    this.bloomB=this.bloomA.clone();this.bloomScene=new THREE.Scene();
    this.brightMaterial=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{source:{value:this.target.texture}},vertexShader:this.material.vertexShader,fragmentShader:`precision highp float;varying vec2 vUv;uniform sampler2D source;void main(){vec3 c=texture2D(source,vUv).rgb;float peak=max(c.r,max(c.g,c.b));float soft=smoothstep(.64,1.08,peak);gl_FragColor=vec4(c*soft*.46,1.);}`});
    this.blurMaterial=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{source:{value:this.bloomA.texture},stepSize:{value:new THREE.Vector2()}},vertexShader:this.material.vertexShader,fragmentShader:`precision highp float;varying vec2 vUv;uniform sampler2D source;uniform vec2 stepSize;void main(){vec3 c=texture2D(source,vUv).rgb*.227027;c+=texture2D(source,vUv+stepSize*1.384615).rgb*.316216;c+=texture2D(source,vUv-stepSize*1.384615).rgb*.316216;c+=texture2D(source,vUv+stepSize*3.230769).rgb*.070270;c+=texture2D(source,vUv-stepSize*3.230769).rgb*.070270;gl_FragColor=vec4(c,1.);}`});
    this.bloomQuad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.brightMaterial);this.bloomScene.add(this.bloomQuad);this.material.uniforms.tBloom.value=this.bloomA.texture;

  }
  resize(w,h,ratio=1){
    const width=Math.max(1,Math.round(w*ratio)),height=Math.max(1,Math.round(h*ratio));
    this.target.setSize(width,height);this.bloomA.setSize(Math.max(1,Math.ceil(width/4)),Math.max(1,Math.ceil(height/4)));this.bloomB.setSize(this.bloomA.width,this.bloomA.height);this.material.uniforms.resolution.value.set(width,height);this.first=true;
  }
  reset(){this.first=true;}
  setCarBounds(bounds){this.bodyBounds={...this.bodyBounds,...bounds};this.reset();}
  updatePlayerMask(camera,state){
    const u=this.material.uniforms;
    const valid=Number.isFinite(state.x)&&Number.isFinite(state.z)&&Number.isFinite(state.heading);
    u.playerEnabled.value=valid?1:0;
    if(!valid)return;
    const sx=Math.sin(state.heading),cz=Math.cos(state.heading);
    const b=this.bodyBounds,baseY=(state.bodyHeight||0)+(b.rideHeight||0);
    u.playerPosition.value.set(state.x,baseY,state.z);u.playerDirection.value.set(sx,cz);u.playerHalfSize.value.set(b.width*.54,b.height+.17,b.length*.54);u.playerGround.value=state.maskGroundHeight??Math.max(state.groundHeight||0,...(state.suspension||[]).map(w=>w.groundHeight||0));
    this.playerEuler.set(state.bodyPitch||0,0,state.bodyRoll||0);this.playerMatrix.makeRotationFromEuler(this.playerEuler).premultiply(this.playerYaw.makeRotationY(state.heading));
    u.playerInverseBasis.value.setFromMatrix4(this.playerMatrix).invert();this.playerMatrix.setPosition(state.x,baseY,state.z);
    let minX=1,minY=1,maxX=0,maxY=0,nearClipped=false;
    for(const x of [-b.width*.56,b.width*.56])for(const y of [.015,b.height+.20])for(const z of [-b.length*.56,b.length*.56]){
      this.clip.set(x,y,z,1).applyMatrix4(this.playerMatrix).applyMatrix4(this.current);
      if(this.clip.w<=camera.near){nearClipped=true;continue;}
      const px=this.clip.x/this.clip.w*.5+.5,py=this.clip.y/this.clip.w*.5+.5;
      minX=Math.min(minX,px);minY=Math.min(minY,py);maxX=Math.max(maxX,px);maxY=Math.max(maxY,py);
    }
    // In hood view the camera lies inside the bounding volume. Depth still identifies
    // the exact hood, so using a broad reject rectangle does not protect nearby road.
    if(nearClipped)u.playerScreenRect.value.set(0,0,1,1);
    else{
      const paddingX=2/u.resolution.value.x,paddingY=2/u.resolution.value.y;
      u.playerScreenRect.value.set(Math.max(0,minX-paddingX),Math.max(0,minY-paddingY),Math.min(1,maxX+paddingX),Math.min(1,maxY+paddingY));
    }
  }
  render(scene,camera,state,dt,time,settings,motion={}){
    camera.updateMatrixWorld();this.current.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);this.inverse.copy(this.current).invert();
    const resetFrame=this.first;
    if(resetFrame){this.previous.copy(this.current);this.first=false;}
    const u=this.material.uniforms;
    const speedMps=Math.max(0,Number.isFinite(state.speed)?state.speed:0);
    const normalizedSpeed=Math.min(1,speedMps/55);
    const viewMode=motion.cameraMode??settings.camera??0;
    const active=motion.active??state.motionActive??speedMps>1;
    const movement=Math.max(0,Math.min(1,(speedMps-1.5)/5.5));
    u.amount.value=Math.max(0,Math.min(1,settings.blur));u.speed.value=normalizedSpeed;
    const boostTarget=active&&!resetFrame&&state.boosting?(state.nitrousIntensity??1):0;
    u.boost.value=resetFrame||!active?0:u.boost.value+(boostTarget-u.boost.value)*(1-Math.exp(-12*dt));
    u.retro.value=settings.quality==='psx'?1:0;u.time.value=time;u.nearFar.value.set(camera.near,camera.far);u.cameraMode.value=viewMode;
    u.vignetteAmount.value=Math.max(0,Math.min(1,settings.vignette??.38));u.shadingAmount.value=Math.max(0,Math.min(1,settings.shading??.6))*(settings.quality==='psx'?.6:1);u.heat.value=Math.max(0,Math.min(1,motion.heat??0));
    u.motionActive.value=active&&!resetFrame?movement*movement*(3-2*movement):0;
    const shutterSeconds=viewMode===0?.020+normalizedSpeed*.026+u.boost.value*.016:viewMode===1?.020+normalizedSpeed*.034+u.boost.value*.024:.012+normalizedSpeed*.020+u.boost.value*.015;
    u.exposureTime.value=Math.min(40,shutterSeconds/Math.max(.002,dt));
    this.updatePlayerMask(camera,state);
    if(viewMode>0&&speedMps>2&&Number.isFinite(state.vx)&&Number.isFinite(state.vz)){
      this.clip.set(state.vx,0,state.vz,0).applyMatrix4(this.current);
      const fx=this.clip.w>.0001?Math.max(.15,Math.min(.85,this.clip.x/this.clip.w*.5+.5)):.5;
      const fy=this.clip.w>.0001?Math.max(.15,Math.min(.85,this.clip.y/this.clip.w*.5+.5)):.48;
      this.motionFocus.lerp(this.focusTarget.set(fx,fy),resetFrame?1:1-Math.exp(-8*dt));
    }else this.motionFocus.set(.5,.48);
    this.renderer.info.reset();this.renderer.setRenderTarget(this.target);this.renderer.render(scene,camera);
    const bloom=Math.max(0,Math.min(1,settings.bloom??.45));u.bloomAmount.value=bloom;
    if(bloom>.001){
      this.bloomQuad.material=this.brightMaterial;this.renderer.setRenderTarget(this.bloomA);this.renderer.render(this.bloomScene,this.camera);
      this.bloomQuad.material=this.blurMaterial;this.blurMaterial.uniforms.source.value=this.bloomA.texture;this.blurMaterial.uniforms.stepSize.value.set(1.5/this.bloomA.width,0);this.renderer.setRenderTarget(this.bloomB);this.renderer.render(this.bloomScene,this.camera);
      this.blurMaterial.uniforms.source.value=this.bloomB.texture;this.blurMaterial.uniforms.stepSize.value.set(0,1.5/this.bloomB.height);this.renderer.setRenderTarget(this.bloomA);this.renderer.render(this.bloomScene,this.camera);
    }
    this.renderer.setRenderTarget(null);this.renderer.render(this.scene,this.camera);this.previous.copy(this.current);
  }
}
