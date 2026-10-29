import {normalizeLobbyCode} from './multiplayer.js';
const $=id=>document.getElementById(id);

export class LobbyPanel{
 constructor(session,{onLeave,onResume,onProfile,onLayout}={}){
  this.session=session;this.onLayout=onLayout;this.onProfile=onProfile;this.renderKey='';this.busy=false;this.localError='';this.localIssue=null;
  const summary=$('lobby-modal')?.querySelector('summary');if(summary){summary.id='network-options-toggle';summary.setAttribute('aria-label','Connection options');}
  for(const id of ['lobby-name','lobby-code','network-host','network-path','network-turn','network-user','network-password'])$(id)?.setAttribute('aria-description','Confirm opens the controller keyboard. You can also type with a keyboard.');
  $('lobby-create').addEventListener('click',()=>this.connect(true));$('lobby-join').addEventListener('click',()=>this.connect(false));
  $('lobby-ready').addEventListener('click',()=>{const state=session.getState(),me=state.players.find(p=>p.id===state.id);session.setReady(!me?.ready);this.render();});
  $('lobby-start').addEventListener('click',()=>{session.start();this.render();});$('lobby-leave').addEventListener('click',()=>onLeave?.());$('lobby-resume').addEventListener('click',()=>onResume?.());
  $('lobby-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(session.getState().code);$('lobby-copy').textContent='COPIED';}catch{$('lobby-status').textContent='Share the eight-character code shown below.';}});
  $('lobby-copy-error')?.addEventListener('click',()=>this.copyIssue());
  for(const id of ['max','traffic','police','damage','collisions','time','weather'])$('lobby-rule-'+id).addEventListener('change',()=>{session.setRules(this.readRules());this.render();});
  $('lobby-code').addEventListener('input',()=>{$('lobby-code').value=normalizeLobbyCode($('lobby-code').value).slice(0,8);this.localError='';this.render();});
  $('lobby-code').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();this.connect(false);}});
  $('lobby-keypad-toggle').addEventListener('click',()=>{const hidden=$('lobby-keypad').classList.toggle('hidden');$('lobby-keypad-toggle').setAttribute('aria-expanded',String(!hidden));onLayout?.();if(!hidden)$('lobby-keypad').querySelector('button')?.focus();});
  for(const value of [...'ABCDEFGHJKLMNPQRSTUVWXYZ23456789','DELETE','CLEAR']){const b=document.createElement('button');b.type='button';b.textContent=value;b.setAttribute('aria-label',value==='DELETE'?'Delete last character':value==='CLEAR'?'Clear lobby code':value);b.addEventListener('click',()=>{const input=$('lobby-code');input.value=value==='CLEAR'?'':value==='DELETE'?input.value.slice(0,-1):input.value.length<8?input.value+value:input.value;this.localError='';this.render();});$('lobby-keypad').append(b);}
 }
 readRules(){return{maxPlayers:Number($('lobby-rule-max').value),traffic:$('lobby-rule-traffic').value,police:$('lobby-rule-police').checked,damage:$('lobby-rule-damage').checked,collisions:$('lobby-rule-collisions').value,time:$('lobby-rule-time').value,weather:$('lobby-rule-weather').value};}
 config(){
  const host=$('network-host').value.trim(),path=$('network-path').value.trim(),url=$('network-turn').value.trim();
  const config={};if(host){config.host=host;config.port=443;if(path)config.path=path;}
  if(url)config.iceServers=[{urls:url,username:$('network-user').value,credential:$('network-password').value}];return config;
 }
 async connect(host){
  if(this.busy)return;this.localError='';this.localIssue=null;this.session.clearIssue();this.busy=true;this.render();
  try{const options={name:$('lobby-name').value||'DRIVER 09',...this.profile,rules:this.readRules(),config:this.config()};this.onProfile?.(options.name);if(host)await this.session.host(options);else await this.session.join($('lobby-code').value,options);}
  catch(error){this.localError=error?.message||'Could not connect. Try again.';}
  finally{this.busy=false;this.renderKey='';this.render();}
 }
 setProfile({name,build,color}){this.profile={build,color};if(name)$('lobby-name').value=name;}
 showIssue(issue){this.localIssue=issue?{...issue}:null;this.renderKey='';this.render();}
 issueText(){
  const issue=this.localIssue||this.session.getState().lastIssue;if(!issue)return '';
  // Deliberately exclude lobby codes, peer IDs and signaling/TURN configuration.
  return ['SIDEWAYS multiplayer',`Code: ${issue.code}`,`Stage: ${issue.stage}`,`Role: ${issue.role}`,'Transport: binary',issue.message,issue.detail?`Details: ${issue.detail}`:''].filter(Boolean).join('\n');
 }
 async copyIssue(){
  const details=this.issueText();if(!details)return false;
  try{await navigator.clipboard.writeText(details);if($('lobby-copy-error'))$('lobby-copy-error').textContent='COPIED';return true;}
  catch{if($('lobby-copy-error'))$('lobby-copy-error').textContent='SELECT DETAILS TO COPY';return false;}
 }
 render(){
  const state=this.session.getState(),issue=this.localIssue||state.lastIssue,key=JSON.stringify([state.status,state.players,state.rules,state.error,issue,this.busy,this.localError]);if(key===this.renderKey)return;this.renderKey=key;
  const issuePanel=$('lobby-error');if(issuePanel){issuePanel.classList.toggle('hidden',!issue);issuePanel.hidden=!issue;}
  if($('lobby-error-message'))$('lobby-error-message').textContent=issue?.message||'';
  if($('lobby-error-code'))$('lobby-error-code').textContent=issue?.code||'';
  if($('lobby-error-detail'))$('lobby-error-detail').textContent=issue?[`Stage: ${issue.stage}`,issue.detail].filter(Boolean).join('\n'):'';
  if($('lobby-copy-error'))$('lobby-copy-error').textContent='COPY DETAILS';
  const connected=['lobby','playing'].includes(state.status),playing=state.status==='playing';$('lobby-entry').classList.toggle('hidden',connected);$('lobby-connected').classList.toggle('hidden',!connected);
  $('lobby-create').disabled=$('lobby-join').disabled=this.busy||state.status==='connecting';
  if(state.error||this.localError)$('lobby-status').textContent=this.localError||state.error;else $('lobby-status').textContent=state.status==='connecting'?'Connecting...':playing?'The city is open.':connected?'Share the code. Ready up when everyone is here.':'Create a lobby, then share its code.';
  if(connected){
   $('lobby-share-code').textContent=state.code.slice(0,4)+' '+state.code.slice(4);$('lobby-copy').textContent='COPY CODE';
   $('lobby-players').replaceChildren();for(const player of state.players){const row=document.createElement('div');row.className='lobby-player';const mark=document.createElement('i');mark.style.background=player.color;const name=document.createElement('strong');name.textContent=player.name+(player.id===state.id?' (YOU)':'');const status=document.createElement('span');status.textContent=player.id===state.hostId?'HOST':playing?'IN SESSION':player.ready?'READY':'NOT READY';status.classList.toggle('ready',player.ready);row.append(mark,name,status);$('lobby-players').append(row);}
   for(const [id,key]of [['max','maxPlayers'],['traffic','traffic'],['police','police'],['damage','damage'],['collisions','collisions'],['time','time'],['weather','weather']]){const input=$('lobby-rule-'+id);if(input.type==='checkbox')input.checked=state.rules[key];else input.value=state.rules[key];input.disabled=!state.isHost||playing;}
   const me=state.players.find(p=>p.id===state.id);$('lobby-ready').textContent=me?.ready?'NOT READY':'READY';$('lobby-ready').classList.toggle('hidden',state.isHost||playing);$('lobby-start').classList.toggle('hidden',!state.isHost||playing);$('lobby-start').disabled=state.players.some(p=>!p.ready);$('lobby-resume').classList.toggle('hidden',!playing);
   $('lobby-rule-note').textContent=playing?'Rules are fixed for this drive.':state.isHost?'Changing a rule asks everyone to ready up again.':'The host sets the rules.';
  }
  this.onLayout?.();
 }
}
