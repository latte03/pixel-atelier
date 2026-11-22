'use strict';
const SE={advanced:false,epoch:null,baseDurations:[],undo:null,tempo:'1',actionSignature:'',loading:false};
function seViewBox(){if(SE.advanced||!S.frames.length)return null;if(SE.box)return SE.box;let union=[S.size,S.size,0,0];for(let i=0;i<S.frames.length;i++){const b=bounds(frameCanvas(i),{x:0,y:0,w:S.size,h:S.size});if(b)union=[Math.min(union[0],b[0]),Math.min(union[1],b[1]),Math.max(union[2],b[2]),Math.max(union[3],b[3])];}if(union[2]<=union[0])return null;SE.box=[Math.max(0,union[0]-12),Math.max(0,union[1]-12),Math.min(S.size,union[2]+12),Math.min(S.size,union[3]+12)];return SE.box;}
function seEnter(){document.body.classList.toggle('easy-preview',!SE.advanced);if(!SE.advanced)$('playSpeed').value='1';document.body.classList.toggle('editor-simple',!SE.advanced);S.easy=!SE.advanced;$('seMode').textContent=SE.advanced?'返回简易编辑':'精细调整';$('seMode').setAttribute('aria-pressed',String(SE.advanced));$('seIntro').textContent=SE.advanced?'需要精确处理时，再调整切帧、位置、锚点和配色。':'先播放看看，调好快慢，满意后下载。';seSync();draw();}
function seSync(){if(!$('seAction'))return;if(SE.epoch!==S.sourceEpoch){SE.epoch=S.sourceEpoch;SE.box=null;SE.baseDurations=[];SE.undo=null;SE.tempo='1';}if(SE.baseDurations.length!==S.frames.length){SE.box=null;SE.baseDurations=S.frames.map(f=>f.duration);SE.undo=null;SE.tempo='1';}const n=S.frames.length,ms=S.frames.reduce((v,f)=>v+f.duration,0);$('sePrepare').hidden=n>1;$('seSummary').textContent=n>1?`这个动作有 ${n} 个姿势，共 ${(ms/1000).toFixed(2)} 秒。`:n===1?'当前只有一张姿势图，还没有形成连续动作。':'还没有可播放的动作，先导入图表或打开作品。';$('seSelected').textContent=n?`选中第 ${S.index+1} 张 · 停留 ${S.frames[S.index]?.duration||0} 毫秒`:'先选一个姿势';$('seEmpty').hidden=!!S.source;$('seExport').disabled=!S.source||SE.loading;$('seSave').disabled=!S.source;$$('[data-se-tempo],[data-se-hold],[data-se-nudge]').forEach(b=>b.disabled=!n||SE.loading);$$('[data-se-tempo]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.seTempo===SE.tempo)));$('seUndo').disabled=!SE.undo||SE.undo.epoch!==S.sourceEpoch;$('seGround').checked=S.ground;$('seExportHint').textContent=n===1?'单张姿势可导出为静态 GIF；连续动作需要多张姿势。':'修改会自动保存到本机，建议同时下载备份。';const sig=JSON.stringify([C.project?.id,C.bound?.id,Object.keys(C.project?.actions||{})]);if(sig!==SE.actionSignature){SE.actionSignature=sig;$('seAction').innerHTML=C.project?'<option value="">选择已保存的动作…</option>'+Object.entries(C.project.actions).map(([id,a])=>`<option value="${esc(id)}">${esc(a.label||actionName(id))}</option>`).join(''):'<option value="">当前导入的动作</option>';$('seAction').value=C.bound?.id||'';}$('seAction').disabled=!C.project||SE.loading;seSyncFollow();}
function seSnapshot(){SE.undo={epoch:S.sourceEpoch,frames:S.frames.map(f=>({duration:f.duration,offset:[...f.offset]})),tempo:SE.tempo};}
function seStop(){S.playing=false;$('play').textContent='▶';$('play').setAttribute('aria-label','播放动画');}
function seCommit(){changed();renderTimeline();syncFrame();draw();seSync();}
function seTempo(value){if(!S.frames.length)return;const durations=SE.baseDurations.map(d=>Math.max(10,Math.min(2000,Math.round(d*Number(value)/10)*10)));seSnapshot();S.frames.forEach((f,i)=>f.duration=durations[i]);SE.tempo=value;seStop();seCommit();toast('动作快慢已调整，下载的 GIF 也会使用这个节奏');}
function seHold(ms){if(!S.frames.length)return;seSnapshot();S.frames[S.index].duration=ms;SE.tempo='custom';seStop();seCommit();}
function seNudge(dx,dy){const f=S.frames[S.index];if(!f)return;const x=f.offset[0]+dx,y=f.offset[1]+dy;if(Math.abs(x)>300||Math.abs(y)>300)return toast('位置调整已到边界，请进入精细调整检查');seSnapshot();f.offset=[x,y];seStop();seCommit();}
function seUndo(){if(!SE.undo||SE.undo.epoch!==S.sourceEpoch)return;const u=SE.undo;u.frames.forEach((f,i)=>{if(S.frames[i]){S.frames[i].duration=f.duration;S.frames[i].offset=[...f.offset];}});SE.tempo=u.tempo;SE.undo=null;seStop();seCommit();toast('已撤销上一次快慢、停留或位置调整');}
async function seExport(){if(SE.loading)return;seStop();SE.loading=true;seSync();try{openExport();if($('exportDialog').open&&!S.export)await buildExport();}finally{SE.loading=false;seSync();}}
function seNewActionSlot(){
  const id=S.job?.action;
  if(!presets.some(p=>p[0]===id))return null;
  const label=window.characterProject?.actionLabel(id)||actionName(id);
  if(!C.project.actions[id])return {id,label};
  let revision=2;
  while(C.project.actions[id+'_v'+revision])revision++;
  return {id:id+'_v'+revision,label:label+' · v'+revision};
}
function seSyncFollow(){
  const idle=!!C.project&&roleIsIdle(C.bound?.id)&&C.bound.epoch===S.sourceEpoch;
  $('seFinalizeIdle').hidden=!idle||S.frames.length<2;
  $('seFinalizeIdle').textContent=C.project?.masterBasis?'用所选帧更新母版':'定稿待机并设为母版';
  $('seRefineIdle').hidden=!idle||!S.frames.length;
  $('seContinue').hidden=!C.project?.masterBasis||idle||!S.frames.length;
  $('seContinue').textContent='用已定稿母版做新动作';
  const savedHere=C.project&&S.job?.character_context?.id===C.project.id&&C.bound?.epoch===S.sourceEpoch;
  const slot=C.project&&S.frames.length&&S.job?.character_context?.id===C.project.id&&!savedHere?seNewActionSlot():null;
  $('seAddGenerated').hidden=!slot;
  if(slot)$('seAddGenerated').textContent='保存「'+slot.label+'」到角色';
}
async function seContinue(){
  seStop();
  try{await atStartFollow();}
  catch(e){toast(e.message);}
}
async function seFinalize(){
  const button=$('seFinalizeIdle');
  if(button.disabled)return;
  seStop();
  button.disabled=true;
  try{await atFinalizeIdle();}
  catch(e){toast(e.message);}
  finally{button.disabled=false;}
}
function seRefineIdle(){
  if(!S.frames.length)return;
  seStop();
  const index=S.index;
  atMakeIdle({url:frameCanvas(index).toDataURL('image/png'),name:'待机 · 第 '+(index+1)+' 帧'});
  $('atelierMotion').focus();
}
async function seSaveGenerated(){
  const slot=seNewActionSlot();
  const button=$('seAddGenerated');
  if(!slot||button.disabled||button.hidden)return;
  button.disabled=true;
  try{await addAction(slot.id,slot.label);atProjectLabel();}
  finally{button.disabled=false;}
}
function bindSimpleEditor(){$('seContinue').onclick=seContinue;$('seFinalizeIdle').onclick=seFinalize;$('seRefineIdle').onclick=seRefineIdle;$('seAddGenerated').onclick=seSaveGenerated;window.simpleEditor={enter:seEnter,sync:seSync,viewBox:seViewBox,invalidate:()=>{SE.box=null;}};$('seMode').onclick=()=>{SE.advanced=!SE.advanced;if(!SE.advanced){SE.baseDurations=S.frames.map(f=>f.duration);SE.tempo='1';SE.undo=null;}seEnter();};$$('[data-se-tempo]').forEach(b=>b.onclick=()=>seTempo(b.dataset.seTempo));$$('[data-se-hold]').forEach(b=>b.onclick=()=>seHold(Number(b.dataset.seHold)));$$('[data-se-nudge]').forEach(b=>b.onclick=()=>seNudge(...b.dataset.seNudge.split(',').map(Number)));$('seUndo').onclick=seUndo;$('seGround').onchange=()=>{S.ground=$('seGround').checked;$('groundToggle').setAttribute('aria-pressed',String(S.ground));draw();};$('seExport').onclick=seExport;$('seSave').onclick=()=>{if(C.project)downloadCharacter();else saveProject();};$('seAction').onchange=async()=>{const id=$('seAction').value;if(!id||!C.project?.actions[id])return;SE.loading=true;seSync();try{await openCharacterAction(id);atTab('editor');}catch(e){toast(e.message);}finally{SE.loading=false;seSync();}};$('seImport').onclick=()=>$('easyImportFile').click();$('sePrepare').onclick=()=>$('easyImportFile').click();$('seExample').onclick=async()=>{try{if(!G.examples.length)await loadExamples();await practiceSample();atTab('editor');}catch(e){toast(e.message);}};$('timelineSection').querySelector('strong').textContent='动作小图 · 点一张就能查看';if(AT.tab==='editor')seEnter();else seSync();}
bindSimpleEditor();
