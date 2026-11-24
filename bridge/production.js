'use strict';

const PF={id:null,state:null,step:null,choice:null,mode:null,busy:false,editing:null,preview:'',draw:null,paused:false,request:0,selectNew:true,advanced:false};

async function pfCommand(op,data={}){
  return api('/production',{id:PF.id,op,...data});
}
function pfNotice(message=''){
  $('productionError').textContent=message;
}
function pfRefInfo(){
  if(!PF.id)return null;
  if(PF.localRef?.pid===PF.id&&PF.localRef.url)return PF.localRef;
  try{
    const cached=JSON.parse(localStorage.getItem('pixel-prod-ref-'+PF.id)||'null');
    if(cached?.url){PF.localRef={pid:PF.id,...cached};return PF.localRef;}
  }catch(e){}
  if(C.project?.id===PF.id&&C.project.master)return {pid:PF.id,url:C.project.master,name:C.project.name+' · 定稿母版'};
  return null;
}
function pfSaveLocalRef(pid,url,name){
  PF.localRef={pid,url,name:name||'角色参考图'};
  try{localStorage.setItem('pixel-prod-ref-'+pid,JSON.stringify({url,name:PF.localRef.name}));}catch(e){}
}
async function pfOnReferenceChange(){
  const input=$('productionReference'),f=input.files[0];
  if(!f||!PF.id||PF.busy)return;
  PF.busy=true;
  pfNotice();
  pfRender();
  try{
    if(f.size>12*1024*1024)throw Error('请选择 12 MB 以内的 PNG 或 JPG');
    const reference=await readFile(f);
    await loadImage(reference);
    pfSaveLocalRef(PF.id,reference,f.name);
    const state=await pfCommand('reference',{reference});
    input.value='';
    pfAdopt(state);
    toast('参考图已载入！确认左侧预览后，点「开始托管」或「生成待机」启动');
  }catch(error){
    pfNotice(error.message);
    toast(error.message);
  }finally{
    PF.busy=false;
    pfRender();
  }
}
function pfOption(){
  return $('productionVersions').value||null;
}
function pfVersionData(value){
  const [type,...name]=(value||'').split(':');
  return type?{[type]:name.join(':')}:{};
}
function pfAdopt(state){
  const old=PF.state?.active;
  PF.state=state;
  if(!PF.step||PF.selectNew&&state.active!==old){
    PF.step=state.active||'knockdown';
    PF.choice=null;
  }
  pfRender();
}

async function pfReconcile(state){
  if(!C.project||C.project.id!==state.id||C.bound||PF.editing||C.conflict||C.project.revision>=state.revision)return;
  if(C.savedFingerprint!==null&&fingerprint(C.project)!==C.savedFingerprint)return;
  const original=C.project;
  const project=await api('/project/'+state.id);
  if(C.project!==original||C.bound||PF.editing||C.conflict)return;
  C.project=project;
  C.savedFingerprint=fingerprint(project);
  renderCharacter();
  await flushWorkspace(false);
}
async function pfReturnHome(){
  if(PF.busy)return;
  if(PF.state?.running){
    try{await pfCommand('pause');}catch(e){}
  }
  C.project=null;
  C.bound=null;
  C.conflict=false;
  C.savedFingerprint=null;
  AT.projectId=null;
  PF.advanced=false;
  atClearProjectLink();
  atProjectLabel();
  renderCharacter();
  atTab('create');
  pfSync();
  await flushWorkspace(false);
  await atWriteDraft();
}
async function pfPoll(){
  if(!PF.id||PF.busy)return;
  const id=PF.id;
  const request=++PF.request;
  try{
    const state=await api('/production/'+id);
    if(request===PF.request&&id===PF.id&&!PF.busy){pfAdopt(state);await pfReconcile(state);}
  }catch(error){
    if(id===PF.id){
      if(error.message&&error.message.includes('不存在')){
        await pfReturnHome();
      }else pfNotice(error.message);
    }
  }
}
function pfSync(){
  const id=C.project?.id||null;
  if(id!==PF.id){
    ++PF.request;
    Object.assign(PF,{id,state:null,step:null,choice:null,mode:null,selectNew:true,editing:null,preview:'',draw:null,advanced:false});
    $('productionNote').value=$('productionReference').value='';
    pfNotice();
    try{
      const edit=JSON.parse(sessionStorage.getItem('pixel-production-edit')||'null');
      if(edit?.pid===id&&S.label===edit.title&&S.frames.length){
        PF.editing=edit;
        pfEditorLabels();
      }
    }catch(error){/* Browser storage is optional. */}
  }
  const templateDriven=!!C.project?.template;
  const home=AT.tab==='create'&&!PF.advanced&&!templateDriven;
  $('productionPanel').hidden=!home;
  document.body.classList.toggle('production-home',home);
  document.body.classList.toggle('production-editing',AT.tab==='editor'&&!!PF.editing);
  $('productionEditorBar').hidden=AT.tab!=='editor'||!PF.editing;
  if(home){
    $('atelierCreate').classList.remove('designing');
    pfRender();
    pfPoll();
  }
}
function pfSelect(action){
  PF.step=action;
  PF.selectNew=action===PF.state.active;
  PF.choice=null;
  $('productionNote').value='';
  pfNotice();
  pfRender();
}
function pfRender(){
  const state=PF.state;
  const panel=$('productionPanel');
  if(panel.hidden)return;
  $('productionEmpty').hidden=!!PF.id;
  $('productionBody').hidden=!state;
  if($('productionHomeBtn'))$('productionHomeBtn').hidden=!PF.id;
  $('productionTitle').textContent=C.project?.name||'角色动作制作';
  const mode=PF.mode||state?.mode||'guided';
  $('productionGuided').setAttribute('aria-pressed',String(mode==='guided'));
  $('productionManaged').setAttribute('aria-pressed',String(mode==='managed'));
  $('productionGuided').disabled=!!state?.running||PF.busy;
  $('productionManaged').disabled=PF.busy;
  $('productionQuickReference').hidden=mode!=='managed';
  $('productionQuickFile').disabled=PF.busy;
  $('productionNew').hidden=mode==='managed';
  if($('productionTrySample'))$('productionTrySample').hidden=mode==='managed';
  if(!state){
    $('productionStatus').textContent=PF.id?'正在读取动作进度…':'按顺序制作：待机 → 奔跑 → 闪身 → 连段 → 蓄力 → 跳跃 → 受击 → 倒地';
    return;
  }
  const ready=Object.keys(state.accepted).length;
  const current=state.steps.find(s=>s.id===state.active);
  $('productionStatus').textContent=state.export?'8 / 8 · 完整素材包已生成':state.running
    ?ready+' / 8 · 托管中'+(current?' · '+current.label:' · 正在打包')+(state.review_in!==null?' · '+state.review_in+' 秒后采用当前结果':'')
    :ready+' / 8 已采用'+(current?' · 下一步 '+current.label:' · 可以打包');
  const stepKey=JSON.stringify([state.steps,PF.step,state.active,state.accepted]);
  if($('productionSteps').dataset.key!==stepKey){
    $('productionSteps').dataset.key=stepKey;
    $('productionSteps').replaceChildren(...state.steps.map((step,i)=>{
    const button=document.createElement('button');
    const name=document.createElement('strong');
    const label=document.createElement('small');
    const latest=step.versions.at(-1);
    const statusKind=state.accepted[step.id]?'accepted':latest?.status==='completed'?'review'
      :latest?.status==='failed'?'failed':latest?'running':step.id===state.active?'next':'pending';
    name.textContent=String(i+1).padStart(2,'0')+' '+step.label;
    label.textContent=state.accepted[step.id]?'已采用':latest?.status==='completed'?'待确认'
      :latest?.status==='failed'?'可重试':latest?'生成中':step.id===state.active?'下一步':'待制作';
    button.dataset.status=statusKind;
    button.append(name,label);
    button.setAttribute('aria-current',step.id===PF.step?'step':'false');
    button.onclick=()=>pfSelect(step.id);
    return button;
  }));
  }
  const step=state.steps.find(s=>s.id===PF.step)||current||state.steps[7];
  PF.step=step.id;
  $('productionActionTitle').textContent=step.label;
  $('productionMotion').textContent=step.motion;
  if(state.error&&!$('productionError').textContent)pfNotice(state.error);
  const completed=step.versions.filter(v=>v.status==='completed');
  const approved=state.accepted[step.id];
  const options=step.existing.map(id=>({value:'existing:'+id,label:id===step.id&&approved?'工程采用版':'工程版本 · '+id}));
  completed.forEach(v=>options.push({value:'job:'+v.id,label:'生成版本 '+(step.versions.indexOf(v)+1)}));
  const picker=$('productionVersions');
  const optionKey=JSON.stringify(options);
  if(picker.dataset.key!==optionKey){
    picker.dataset.key=optionKey;
    picker.replaceChildren(...options.map(o=>new Option(o.label,o.value)));
  }
  const fallback=approved&&step.existing.includes(step.id)?'existing:'+step.id:options.at(-1)?.value;
  picker.value=options.some(o=>o.value===PF.choice)?PF.choice:fallback||'';
  const allowed=step.id===state.active||!!approved;
  const inProgress=state.steps.some(s=>s.versions.some(v=>v.status==='queued'||v.status==='running'));
  const reference=$('productionReference');
  const canUpload=state.active==='idle'&&!state.running;
  const tipEl=$('productionBeginnerTip');
  if(tipEl){
    if(state.running){
      tipEl.textContent='💡 托管模式运行中：系统会自动按顺序生成并采用 8 个动作，你可以随时点「完成本张后暂停」介入微调。';
    }else if(!allowed){
      tipEl.textContent='🔒 请先完成并采用前面的动作（特别是第 01 步「待机」母版），才能解锁当前动作，确保角色长相一致。';
    }else if(step.id==='idle'&&!picker.value){
      tipEl.textContent='💡 第 1 步最关键：上传一张角色图（或在下方直接用文字描述外观），生成「待机」动作。定稿后它会作为角色母版，保证后面 7 个动作不走样。';
    }else if(step.id==='idle'&&picker.value&&!approved){
      tipEl.textContent='✨ 待机已生成！点「采用并设为角色母版」去选一张最清楚的帧定稿，后面所有动作都会沿用这个造型。';
    }else if(!picker.value){
      tipEl.textContent='💡 角色母版已锁定！直接点下方「生成'+step.label+'」，或补充一句本动作的细节要求再生成。';
    }else if(!approved){
      tipEl.textContent='✨ 动作已生成！先看左侧动画预览，不满意可「打开微调」调快慢或重写要求重新生成；满意就点「采用此版本并继续」。';
    }else{
      tipEl.textContent='✅ 当前动作已采用。你可以随时切换版本、打开微调，或补充修改要求重新生成一版。';
    }
  }
  $('productionVersionLabel').hidden=!options.length;
  $('productionReviewButtons').hidden=!picker.value;
  $('productionEdit').disabled=PF.busy;
  $('productionEdit').textContent=state.running?'暂停托管并微调':'打开微调 ↗';
  $('productionAccept').hidden=!allowed;
  $('productionAccept').disabled=PF.busy||state.running;
  $('productionAccept').textContent=step.id==='idle'?'采用并设为角色母版':'采用此版本并继续';
  $('productionReferenceLabel').hidden=!canUpload;
  reference.disabled=PF.busy;
  const refInfo=pfRefInfo();
  const refCard=$('productionRefCard');
  if(refCard){
    refCard.hidden=!refInfo||(!canUpload&&step.id!=='idle');
    if(refInfo){
      $('productionRefThumb').src=refInfo.url;
      $('productionRefName').textContent=refInfo.name||'角色参考图已就绪';
      $('productionRefStatus').textContent=state.running?'正在使用此参考图托管生成中…':'参考图已载入 · 确认无误后点击下方「开始托管」或「生成待机」';
    }
  }
  $('productionNoteLabel').hidden=state.running||!allowed;
  $('productionNote').placeholder=canUpload&&!state.has_art?'没有参考图时，可在这里描述角色外观和装备':'如：上挑幅度更大，右手单手持剑';
  $('productionGenerate').hidden=state.running||!allowed||mode==='managed'&&!step.versions.length;
  $('productionGenerate').disabled=PF.busy||inProgress;
  $('productionGenerate').textContent=step.versions.length?'重新生成一版':'生成'+step.label;
  $('productionStart').hidden=mode!=='managed'||state.running||!!state.export;
  $('productionStart').disabled=PF.busy;
  $('productionStart').textContent=state.mode==='managed'?'继续托管':'开始托管';
  $('productionPause').hidden=!state.running;
  $('productionPause').disabled=PF.busy;
  $('productionIdleImport').hidden=!canUpload||step.id!=='idle';
  $('productionIdleImport').disabled=PF.busy||inProgress;
  $('productionExport').hidden=!!state.active||!!state.export;
  $('productionExport').disabled=PF.busy||state.running;
  $('productionDownload').hidden=!state.export;
  if(state.export)$('productionDownload').href=state.export;
  const latest=step.versions.at(-1);
  const hint=latest?.status==='failed'?latest.error:inProgress&&['queued','running'].includes(latest?.status)?'正在生成'+step.label+'…':null;
  pfPreview(step,picker.value,hint);
}

function pfPreview(step,value,hint=null){
  const data=pfVersionData(value);
  const ref=pfRefInfo();
  const key=JSON.stringify([PF.id,step.id,value,data.existing?PF.state.revision:null,hint,value?null:ref?.url?.slice(-48)]);
  if(key===PF.preview)return;
  PF.preview=key;
  PF.draw=null;
  const canvas=$('productionCanvas'),image=$('productionImage'),empty=$('productionPreviewEmpty');
  canvas.hidden=image.hidden=$('productionPlay').hidden=true;
  empty.hidden=false;
  if(!value){
    if(ref?.url){
      image.src=ref.url;
      image.hidden=false;
      empty.textContent=hint||'参考图已就绪 · 点击右侧「开始托管」或「生成'+step.label+'」开始制作';
    }else{
      empty.textContent=hint||'制作完成后在这里播放预览。';
    }
    return;
  }
  PF.paused=false;
  pfCommand('preview',{action:step.id,...data}).then(async ({clip})=>{
    const src=await loadImage(clip.source);
    const replacements=Object.fromEntries(await Promise.all(Object.entries(clip.overrides||{}).map(async ([i,url])=>[i,await loadImage(url)])));
    if(PF.preview!==key)return;
    const r=clip.recipe, ctx=canvas.getContext('2d');
    canvas.width=canvas.height=r.frameSize;
    ctx.imageSmoothingEnabled=false;
    let index=0,last=performance.now();
    const draw=()=>{
      ctx.clearRect(0,0,canvas.width,canvas.height);
      const [ox,oy]=r.offsets[index];
      if(replacements[index]){
        ctx.drawImage(replacements[index],ox,oy);
        return;
      }
      const x=Math.round(index%r.cols*src.width/r.cols), y=Math.round(Math.floor(index/r.cols)*src.height/r.rows);
      const w=Math.round((index%r.cols+1)*src.width/r.cols)-x, h=Math.round((Math.floor(index/r.cols)+1)*src.height/r.rows)-y;
      ctx.drawImage(src,x,y,w,h,r.baseOffset[0]+ox,r.baseOffset[1]+oy,Math.round(w*r.scale),Math.round(h*r.scale));
    };
    PF.draw=t=>{
      if(PF.paused||document.hidden||$('productionPanel').hidden){last=t;return;}
      if(t-last>=r.durations[index]){
        last=t;
        index=(index+1)%r.count;
        draw();
      }
    };
    draw();
    empty.hidden=true;
    canvas.hidden=false;
    $('productionPlay').hidden=r.count<2;
    $('productionPlay').textContent='暂停预览';
  }).catch(error=>{
    if(PF.preview!==key)return;
    const raw=step.versions.find(v=>v.id===data.job);
    empty.textContent=error.message;
    if(raw?.image_url){image.src=raw.image_url;image.hidden=false;}
  });
}

async function pfMutate(op,data={}){
  if(!PF.id||PF.busy)return;
  PF.busy=true;
  pfNotice();
  pfRender();
  try{
    const state=await pfCommand(op,data);
    pfAdopt(state);
    await pfReconcile(state);
  }catch(error){pfNotice(error.message);}
  finally{PF.busy=false;pfRender();}
}
async function pfReference(){
  const f=$('productionReference').files[0];
  if(!f)return null;
  if(f.size>12*1024*1024)throw Error('请选择 12 MB 以内的 PNG 或 JPG');
  return readFile(f);
}
async function pfGenerate(){
  try{
    const reference=await pfReference();
    if(reference){
      await pfCommand('reference',{reference});
      $('productionReference').value='';
    }
    PF.selectNew=true;
    PF.choice=null;
    await pfMutate('generate',{action:PF.step,note:$('productionNote').value});
  }catch(error){pfNotice(error.message);}
}
async function pfStart(){
  try{
    const reference=await pfReference();
    PF.selectNew=true;
    await pfMutate('start',{reference});
    $('productionReference').value='';
  }catch(error){pfNotice(error.message);}
}

async function pfOpenEditor(){
  const existing=pfOption();
  if(!existing||PF.busy)return;
  PF.busy=true;
  pfNotice();
  pfRender();
  try{
    await flushWorkspace();
    const action=PF.step;
    const {clip,state}=await pfCommand('edit',{action,...pfVersionData(existing)});
    const project=await api('/project/'+PF.id);
    if(C.conflict)throw Error('当前本机草稿需先处理保存冲突');
    if(C.project.revision!==project.revision)await useCharacter(project);
    const title=clip.label+' · 制作流程微调';
    await source(clip.source,title);
    selectPreset(action);
    $('prompt').value=clip.prompt||$('prompt').value;
    slice(clip.recipe);
    for(const [i,value] of Object.entries(clip.overrides||{})){
      S.frames[i].override=value;
      S.frames[i].overrideImage=await loadImage(value);
    }
    renderTimeline();
    draw();
    PF.editing={pid:PF.id,action,title,revision:state.revision,...pfVersionData(existing)};
    try{sessionStorage.setItem('pixel-production-edit',JSON.stringify(PF.editing));}catch(error){}
    pfEditorLabels();
    atTab('editor');
    pfSync();
    await flushWorkspace(false);
  }catch(error){pfNotice(error.message);toast(error.message);}
  finally{PF.busy=false;pfRender();}
}
function pfEditorLabels(){
  const action=PF.editing.action;
  $('productionEditingTitle').textContent='微调'+actionName(action);
  $('productionEditHint').textContent=action==='idle'?'选一个清楚的帧作为角色母版。':'调整速度与位置，满意后采用这一版。';
}
function pfExitEdit(){
  PF.editing=null;
  try{sessionStorage.removeItem('pixel-production-edit');}catch(error){}
  atTab('create');
}
async function pfSaveEdit(){
  const edit=PF.editing,button=$('productionSaveEdit');
  if(!edit||button.disabled||!S.frames.length)return;
  button.disabled=true;
  try{
    const clip=currentAction(actionName(edit.action));
    PF.selectNew=true;
    pfAdopt(await pfCommand('accept',{
      ...edit,clip,frame:edit.action==='idle'?S.index:0,
    }));
    const project=await api('/project/'+PF.id);
    await useCharacter(project);
    pfExitEdit();
    await flushWorkspace(false);
  }catch(error){toast(error.message);}
  finally{button.disabled=false;}
}
async function pfAccept(){
  if(!pfOption())return;
  if(PF.step==='idle')return pfOpenEditor();
  PF.selectNew=true;
  await pfMutate('accept',{action:PF.step,revision:PF.state.revision,...pfVersionData(pfOption()),frame:0});
}

async function pfQuickStart(){
  const input=$('productionQuickFile'),file=input.files[0];
  if(!file||PF.busy||C.project)return;
  PF.busy=true;
  pfRender();
  let project;
  try{
    if(file.size>12*1024*1024)throw Error('请选择 12 MB 以内的 PNG 或 JPG');
    const reference=await readFile(file);
    await loadImage(reference);
    const existingHun=(AT.projects||[]).find(p=>p.name==='魂大人'&&!p.actions);
    if(existingHun){
      project=await api('/project/'+existingHun.id);
    }else{
      const name=file.name.replace(/\.[^.]+$/,'').trim().slice(0,80)||'我的角色';
      const payload=atNewProjectPayload(name);
      payload.spec.style='2.5至3头身Q版硬边像素（Chibi Pixel Art），1px清晰深色像素外轮廓，斗笠或头发遮眼只露简洁下颌、不画写实五官，大块复古像素色阶（32-64色），严禁保留写实高精比例与平滑笔触';
      project=await api('/projects',payload);
    }
    pfSaveLocalRef(project.id,reference,file.name);
    await api('/production',{id:project.id,op:'reference',reference});
    atClearProjectLink();
    await atActivateProject(project,null);
    PF.mode='managed';
    toast('参考图已上传！请确认左侧预览后，点击「开始托管」启动');
  }catch(error){
    if(project)await atActivateProject(project,null);
    toast(error.message);
  }finally{
    input.value='';
    PF.busy=false;
    pfRender();
    pfPoll();
  }
}
async function pfTrySample(){
  if(PF.busy)return;
  const btn=$('productionTrySample');
  if(btn)btn.disabled=true;
  try{
    await flushWorkspace();
    const project=await api('/projects/knight',{});
    atClearProjectLink();
    await atActivateProject(project,null);
    await openCharacterAction('idle');
    PF.step='idle';
    PF.selectNew=false;
    pfRender();
    toast('已载入女骑士完整样板，可随时预览、微调或导出');
  }catch(e){toast(e.message);}
  finally{if(btn)btn.disabled=false;}
}
function bindProduction(){
  window.productionFlow={sync:pfSync};
  $('productionQuickFile').onchange=pfQuickStart;
  $('productionReference').onchange=pfOnReferenceChange;
  $('productionNew').onclick=()=>$('newRoleTop').click();
  if($('productionTrySample'))$('productionTrySample').onclick=pfTrySample;
  if($('productionHomeBtn'))$('productionHomeBtn').onclick=pfReturnHome;
  const brand=document.querySelector('.brand');
  if(brand)brand.addEventListener('click',e=>{e.preventDefault();pfReturnHome();});
  $('productionAdvanced').onclick=()=>{PF.advanced=true;atTab('create');};
  $('productionVersions').onchange=()=>{
    PF.choice=$('productionVersions').value;
    pfRender();
  };
  $('productionGenerate').onclick=pfGenerate;
  $('productionStart').onclick=pfStart;
  $('productionPause').onclick=()=>pfMutate('pause');
  $('productionManaged').onclick=()=>{PF.mode='managed';pfRender();};
  $('productionGuided').onclick=()=>{PF.mode='guided';if(PF.id)pfMutate('guided');else pfRender();};
  $('productionEdit').onclick=pfOpenEditor;
  $('productionAccept').onclick=pfAccept;
  $('productionBack').onclick=pfExitEdit;
  document.querySelector('[data-atelier-tab=create]').addEventListener('click',()=>{PF.advanced=false;pfSync();});
  $('productionSaveEdit').onclick=pfSaveEdit;
  $('productionIdleImport').onclick=()=>$('atelierUseGif').click();
  $('productionExport').onclick=()=>pfMutate('export');
  $('productionPlay').onclick=()=>{
    PF.paused=!PF.paused;
    $('productionPlay').textContent=PF.paused?'播放预览':'暂停预览';
  };
  setInterval(()=>{if(!$('productionPanel').hidden)pfPoll();},2000);
  function animate(t){PF.draw?.(t);requestAnimationFrame(animate);}
  requestAnimationFrame(animate);
}
bindProduction();
