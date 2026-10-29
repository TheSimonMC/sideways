const $=id=>document.getElementById(id),fmt=value=>Math.floor(value).toLocaleString('en-GB');

/** A small job feed. It only accepts, declines or tracks a job. */
export class PhonePanel{
 constructor({onAccept,onDecline,onTrack}={}){this.lastMessage=0;this.noticeTime=0;this.revision=-1;$('phone-accept').addEventListener('click',()=>onAccept?.());$('phone-pass').addEventListener('click',()=>onDecline?.());$('phone-track').addEventListener('click',()=>onTrack?.());}
 update(dt,career,{visible=true,state={},prompt='F'}={}){
  const panel=$('phone-panel');panel.classList.toggle('hidden',!visible);if(!visible)return;
  const active=career.active,offer=career.offer,item=active||offer;
  $('phone-status').textContent=active?'JOB ACTIVE':'NEW JOB';$('phone-time').textContent=active?.kind==='delivery'?Math.max(0,Math.ceil(active.duration-active.elapsed))+' SEC':'DISPATCH';
  $('phone-title').textContent=item?.title||'Between jobs';$('phone-message').textContent=item?.text||'Drive the city. New work will arrive here.';
  $('phone-reward').textContent=item?fmt(item.reward)+' PTS':'';
  $('phone-accept').classList.toggle('hidden',!!active||!offer);$('phone-pass').classList.toggle('hidden',!!active||!offer);$('phone-track').classList.toggle('hidden',!active||active.kind!=='delivery');
  $('phone-progress').classList.toggle('hidden',!active);$('phone-progress-fill').style.transform='scaleX('+(active?Math.max(0,Math.min(1,active.progress/active.goal)):0)+')';
  if(active){
   let text;
   if(active.kind==='delivery'){const target=active.stage==='pickup'?active.pickup:active.destination,distance=Math.hypot((state.x||0)-target.x,(state.z||0)-target.z);text=(active.stage==='pickup'?'PICKUP':'DELIVER')+' · '+Math.round(distance)+' M';$('phone-message').textContent=(active.stage==='pickup'?'Stop at ':'Take the crate to ')+target.name+'.';$('phone-progress-fill').style.transform='scaleX('+(active.stage==='pickup'?.12:.56)+')';if(active.stage!=='pickup')text+=' · CARGO '+Math.round(active.cargo*100)+'%';}
   else text=fmt(active.progress)+' / '+fmt(active.goal)+(active.kind==='distance'?' M':active.kind==='cleanRun'?' SEC':active.kind==='drift'?' PTS':'');
   $('phone-progress-label').textContent=text;
  }
  const message=career.message;if(message&&message.id!==this.lastMessage){this.lastMessage=message.id;this.noticeTime=8;panel.classList.remove('phone-arrival');void panel.offsetWidth;panel.classList.add('phone-arrival');$('phone-sender').textContent=message.sender;$('phone-notice-text').textContent=message.text;}
  this.noticeTime=Math.max(0,this.noticeTime-dt);$('phone-notice').classList.toggle('hidden',this.noticeTime<=0);
 }
}
