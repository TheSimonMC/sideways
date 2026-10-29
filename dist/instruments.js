const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
export function gaugeState(state,redline){
 const critical=(state.engineHealth??1)<.28||(state.bodyHealth??1)<.24||state.wheelAttached?.includes(false);
 return {rpm:clamp((state.rpm||0)/Math.max(1,redline)),boost:clamp(state.boost||0),critical:!!critical,
  warning:critical?'CRITICAL DAMAGE':state.boosting?'NOS ACTIVE':state.rpm>redline?'OVER REV':state.drifting?'DRIFT':state.handbrake>.1?'HANDBRAKE':''};
}
/** The warning persists; the impact distortion is a single short transition. */
export class Instruments {
 constructor(doc=document){
  this.root=doc.querySelector('.speedometer');this.critical=false;
  const dial=doc.createElement('div');dial.className='round-dial';
  dial.innerHTML='<svg class="dial-art" viewBox="0 0 260 260" aria-hidden="true"><circle class="dial-face" cx="130" cy="130" r="98"/><circle class="dial-guide" cx="130" cy="130" r="111"/><path class="dial-track" pathLength="100" d="M 48 212 A 116 116 0 1 1 212 212"/><path id="dial-rpm" class="dial-rpm" pathLength="100" d="M 48 212 A 116 116 0 1 1 212 212"/><path class="dial-redline" d="M 221 58 A 116 116 0 0 1 242 161"/><path class="dial-nos-track" pathLength="100" d="M 63 197 A 95 95 0 0 1 35 130"/><path id="dial-nos" class="dial-nos" pathLength="100" d="M 63 197 A 95 95 0 0 1 35 130"/></svg><span class="dial-scale">RPM × 1000</span><span class="dial-zero">0</span><span class="dial-mid">4</span><span id="dial-max">8</span><div class="dial-readout"></div><span id="dial-event" class="dial-event" role="status"></span>';
  this.root.prepend(dial);dial.querySelector('.dial-readout').append(doc.querySelector('.speed-row'));
  this.rpm=doc.getElementById('dial-rpm');this.nos=doc.getElementById('dial-nos');this.event=doc.getElementById('dial-event');this.max=doc.getElementById('dial-max');
  this.reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false;
 }
 update(state,redline){
  const view=gaugeState(state,redline);this.rpm.style.strokeDasharray=`${view.rpm*100} 100`;this.nos.style.strokeDasharray=`${view.boost*100} 100`;this.max.textContent=String(Math.round(redline/1000));
  this.root.classList.toggle('critical-damage',view.critical);this.root.classList.toggle('nos-active',!!state.boosting);this.event.textContent=view.warning;
  if(view.critical&&!this.critical&&!this.reduced)this.root.querySelector('.round-dial').animate?.([{transform:'translateX(0)'},{transform:'translateX(-5px) skewX(-4deg)',filter:'contrast(1.6)'},{transform:'translateX(3px)'},{transform:'none',filter:'none'}],{duration:420,iterations:1});
  this.critical=view.critical;
 }
}

export function setupSettingsDetails(doc=document){
 const panel=doc.getElementById('settings-modal'),detail=doc.createElement('aside');detail.className='setting-detail';detail.innerHTML='<span class="eyebrow">SELECTED SETTING</span><h3></h3><p></p><small>Changes save automatically.</small>';panel.append(detail);
 const update=target=>{const row=target.closest?.('.setting-row'),control=target.closest?.('button');if(!row&&!control)return;const label=row?.querySelector('span');detail.querySelector('h3').textContent=label?.childNodes[0]?.textContent||control?.querySelector('span')?.textContent||control?.textContent||'SETTINGS';detail.querySelector('p').textContent=row?.querySelector('small')?.textContent||control?.querySelector('small')?.textContent||(control?.dataset.settingsTab?'Choose a setting below. Left and right change its value.':'Return to the previous screen.');};
 panel.addEventListener('focusin',e=>update(e.target));panel.addEventListener('pointerover',e=>{if(doc.body.dataset.inputKind==='keyboard')update(e.target);});
 update(panel.querySelector('.setting-row'));
}
