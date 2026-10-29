const formatTime=value=>{
 const time=Math.max(0,Number(value)||0),minutes=Math.floor(time/60),seconds=Math.floor(time%60);
 return String(minutes).padStart(2,'0')+':'+String(seconds).padStart(2,'0')+'.'+String(Math.floor(time%1*1000)).padStart(3,'0');
};
const ordinal=value=>{const n=Math.max(1,Math.round(value)||1),last=n%100;return n+(last>=11&&last<=13?'TH':({1:'ST',2:'ND',3:'RD'}[n%10]||'TH'));};

/** Small retained DOM leaderboard. Names are text, including imported profiles. */
export class RaceUI{
 constructor(doc=globalThis.document){this.doc=doc;this.tables=new WeakMap();}
 element(id){return this.doc.getElementById(id);}
 standings(container,entries=[],{retired=false,results=false}={}){
  let table=this.tables.get(container);if(!table){table={rows:new Map(),order:''};this.tables.set(container,table);}
  const order=entries.map(entry=>entry.id).join('|'),nodes=[];
  for(const [index,entry]of entries.entries()){
   let row=table.rows.get(entry.id);
   if(!row){
    const node=this.doc.createElement('div'),rank=this.doc.createElement('b'),name=this.doc.createElement('strong'),gap=this.doc.createElement('small');
    node.className='race-row';node.append(rank,name,gap);row={node,rank,name,gap};table.rows.set(entry.id,row);
   }
   const isPlayer=entry.isPlayer||entry.id==='player';row.node.classList.toggle('player',!!isPlayer);
   row.rank.textContent=String(entry.position||index+1);row.name.textContent=String(entry.name||'DRIVER');
   row.name.title=row.name.textContent;
   row.gap.textContent=retired&&isPlayer?'DNF':entry.finished?formatTime(entry.finishTime):results?'LAP '+Math.max(1,entry.lap||1):index===0?'LEADER':Number.isFinite(entry.gapSeconds)?'+'+Math.max(0,entry.gapSeconds).toFixed(1)+'s':Number.isFinite(entry.gapMetres)?'+'+Math.round(Math.max(0,entry.gapMetres))+'m':'';
   nodes.push(row.node);
  }
  if(order!==table.order){container.replaceChildren(...nodes);table.order=order;}
 }
 render(state,{visible=true,recovery=0}={}){
  const panel=this.element('race-panel');panel.classList.toggle('hidden',!state||!visible);if(!state)return;
  const entries=state.entries||[],position=state.playerPosition||entries.length||1;
  this.element('race-position').textContent=ordinal(position);
  this.element('race-field').textContent='/ '+entries.length;
  this.element('race-lap').textContent='LAP '+Math.min(state.laps||3,Math.max(1,state.playerLap||1))+' / '+(state.laps||3);
  this.standings(this.element('race-standings'),entries);
  const warning=recovery>0?'RECOVERY · '+Math.ceil(recovery)+'s':state.wrongWay?'WRONG WAY':state.checkpointMissed?'MISSED SECTOR · RESET TO TRACK':'';
  this.element('race-warning').textContent=warning;this.element('race-warning').classList.toggle('hidden',!warning);
 }
 results(state,{retired=false,reward=0}={}){
  this.element('race-results').classList.toggle('hidden',!state);if(!state)return;
  this.standings(this.element('race-result-rows'),state.entries||[],{results:true,retired});
  this.element('race-prize').textContent=retired?'NO FINISH AWARD':'FINISH AWARD +'+Math.round(reward).toLocaleString('en-GB')+' PTS';
 }
}
export {ordinal};
