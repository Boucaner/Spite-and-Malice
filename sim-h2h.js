// Head-to-head AI benchmark (Node, no DOM) -- not part of the shipped app.
// Pits the current AI (game.js) against the pre-v1.0.33 greedy AI, pulled
// straight from git history, over identical seeded deals.
// Usage: node sim-h2h.js [deals=300] [players=2]
const fs=require('fs'),vm=require('vm'),path=require('path'),{execSync}=require('child_process');
const DIR=__dirname;
const OLD_AI_COMMIT='ad607e9'; // v1.0.32, last version with the greedy one-card-at-a-time AI
const OLD_NAMES=['baseExposureUrgency','DESPERATION_GAP','worstExposureUrgency','playUrgency','enablesOwnGoalFollowUp','setsUpImmediateWin','pickBestTarget','computeAiPlay'];
const oldGame=execSync(`git show ${OLD_AI_COMMIT}:game.js`,{cwd:DIR,encoding:'utf8'});
let oldSrc=oldGame.slice(oldGame.indexOf('// ── AI decision-making'),oldGame.indexOf('const SIDE_STACK_RANK_VALUE'));
for(const n of OLD_NAMES) oldSrc=oldSrc.replace(new RegExp('(^|[^A-Za-z0-9_$])'+n+'(?![A-Za-z0-9_$])','g'),'$1old_'+n);
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}}
const N=+process.argv[2]||500, NP=+process.argv[3]||2;
let res={newWins:0,oldWins:0,stalemate:0,unfinished:0},exp={new:[0,0],old:[0,0]},maxMs=0,totalMs=0,calls=0;
function run(seed,newSeats){
  const M=Object.create(Math);M.random=mulberry32(seed);
  const ctx=vm.createContext({console,Math:M});
  for(const f of ['cards.js','game.js']) vm.runInContext(fs.readFileSync(path.join(DIR,f),'utf8'),ctx);
  vm.runInContext(oldSrc,ctx);
  vm.runInContext(`newGame({numPlayers:${NP}})`,ctx);
  const st=vm.runInContext('state',ctx); let turns=0;
  const nextIdx=()=>(st.currentTurn+1)%NP;
  const exposedFor=i=>vm.runInContext(`(()=>{const g=topOf(state.players[${i}].goalPile);return !!g&&state.centerStacks.some(s=>matchesCenterPos(g,s.length));})()`,ctx);
  while(st.phase==='playing'&&turns++<3000){
    const cur=st.currentTurn, isNew=newSeats.includes(cur), nx=nextIdx();
    const before=exposedFor(nx);
    let g=0;
    while(g++<500){
      const t0=Date.now();
      const a=isNew?ctx.computeAiPlay(cur):ctx.old_computeAiPlay(cur);
      if(isNew){const dt=Date.now()-t0;maxMs=Math.max(maxMs,dt);totalMs+=dt;calls++;}
      if(!a)break; const r=ctx.playToCenter(cur,a.source,a.stackIdx); if(!r.ok) throw new Error('illegal '+JSON.stringify(a));
      if(st.phase!=='playing')break;
    }
    if(st.phase!=='playing')break;
    const d=ctx.computeAiDiscard(cur); if(d) ctx.discardToSideStack(cur,d.cardId,d.sideIdx);
    if(!before){const k=isNew?'new':'old';exp[k][1]++;if(exposedFor(nx))exp[k][0]++;}
    ctx.endTurn();
  }
  if(st.phase==='gameEnd'){ if(newSeats.includes(st.winner))res.newWins++; else res.oldWins++; }
  else if(st.phase==='stalemate')res.stalemate++; else res.unfinished++;
}
for(let i=0;i<N;i++){
  const seed=1000+i;
  if(NP===2){run(seed,[0]);run(seed,[1]);}
  else {run(seed,[i%NP]);} // one new AI among old AIs, rotating seat
}
console.log(`players=${NP}`,JSON.stringify(res));
if(NP===2) console.log('new win rate:',(100*res.newWins/(res.newWins+res.oldWins)).toFixed(1)+'%');
else console.log('new AI win rate:',(100*res.newWins/(res.newWins+res.oldWins)).toFixed(1)+'%  (fair share '+(100/NP).toFixed(1)+'%)');
console.log('turns ending with next player goal card freshly playable: new',(100*exp.new[0]/exp.new[1]).toFixed(1)+'%','old',(100*exp.old[0]/exp.old[1]).toFixed(1)+'%');
console.log('plan time per call: avg',(totalMs/calls).toFixed(2),'ms, max',maxMs,'ms');
