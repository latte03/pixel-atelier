'use strict';
/* Guided production follows the local 3D Maker Studio pattern, with pixel-specific rules. */
const AT={tab:'create',step:0,kind:'greatsword',action:'idle',reference:null,job:null,projects:[],started:false,edited:false,submitting:false,hydrating:false,timer:null,lastStatus:''};
const AT_STEPS=[['角色','确定你的主角','参考图与人物特征，构成后续动作的母版。'],['画风','统一像素的表现','确定头身比例、轮廓、原生画布和配色方向。'],['装备','让装备跟着身体动','写清武器结构、握持点和允许的形变。'],['动作','拆清这一次的动作','先写过程，再考虑帧数；完整姿势不拆关节。'],['制作稿','审阅真正要提交的要求','这里的文字将直接提交，不会再附加巨剑或法师的旧要求。'],['制作','把设计交给生成通道','完成后先核对排版，再切帧、校准和交付。']];
const AT_KINDS={greatsword:{label:'重装战士',weapon:'双手持巨剑。刀身长度、宽度、笔直剑柄、护手和握持点保持一致；不弯曲刀身。肩肘腕与髋腿共同发力。',attack:'巨剑攻击：屈膝预备、举剑蓄势、蹬地转髋带动肩臂下砸、触地短暂停顿、缓冲回收。保留重量与惯性。'},bow:{label:'弓箭手',weapon:'一把木质长弓、箭杆和箭袋。弓握把与箭杆尺寸保持一致；弓臂允许在拉弦时合理弯曲；弓弦连接弓梢并随拉弦手变化。持弓手和拉弦手分工清楚，箭尾扣弦，不添加剑或法杖。',attack:'射箭：持弓预备、取箭、搭箭、抬弓拉弦、满弓瞄准、松弦释放、手臂缓冲、回到预备。身体和弓的尺寸稳定，肩肘腕连续，弓弦和箭尾位置合理。'},staff:{label:'法杖术士',weapon:'一根木质法杖和杖顶晶体，长度、直杆结构、晶体大小、握持点固定。骨手或人手自然握持，法杖随躯干略有滞后，不出现刀剑。',attack:'施法：屈膝预备、收杖聚能、转身前指、杖尖释放紧凑魔法光团、余辉消散、收杖恢复平衡。特效不遮挡脸、手与法杖。'},custom:{label:'自由角色',weapon:'保持参考图装备的结构、尺寸和握持关系；没有武器时不添加武器。按实际装备描述允许的活动与形变。',attack:'请描述：预备、发力、主要动作、接触或释放、惯性、收势。保持完整人物连续，不拉伸身体。'}};
const AT_IDS=['atelierSeed','atelierIdentity','atelierStyle','atelierStyleNote','atelierSize','atelierColors','atelierWeapon','atelierKeep','atelierMotion','atelierOutput','atelierFrames','atelierTask'];
const AT_DEFAULTS=Object.fromEntries(AT_IDS.map(id=>[id,$(id).value]));
function atDraft(){
  return {
    version:1,projectId:AT.projectId||null,tab:AT.tab,step:AT.step,kind:AT.kind,action:AT.action,
    started:AT.started,edited:AT.edited,reference:AT.reference,job:AT.job,follow:!!AT.follow,
    fields:Object.fromEntries(AT_IDS.map(id=>[id,$(id).value])),
  };
}
async function atWriteDraft(){
  clearTimeout(AT.timer);
  if(!C.db)C.db=await dbOpen();
  const draft=atDraft();
  await new Promise((resolve,reject)=>{
    const tx=C.db.transaction('drafts','readwrite');
    const store=tx.objectStore('drafts');
    store.put(draft,'atelier');
    if(draft.projectId)store.put(draft,'atelier:'+draft.projectId);
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error);
  });
  $('atelierDraftStatus').textContent='设计草稿已保存到本机';
}
function atSave(){
  if(AT.hydrating)return;
  clearTimeout(AT.timer);
  AT.timer=setTimeout(()=>{
    atWriteDraft().catch(()=>$('atelierDraftStatus').textContent='草稿保存失败，请下载制作稿备份');
  },350);
}
async function atReadDraft(key){
  if(!C.db)C.db=await dbOpen();
  return new Promise((resolve,reject)=>{
    const req=C.db.transaction('drafts').objectStore('drafts').get(key);
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
function atOwnsProject(){
  return !!C.project&&AT.projectId===C.project.id;
}
function atProjectLabel(){
  const project=C.project;
  const idle=atIdleAction();
  $('roleWorkflow').hidden=!project;
  $('roleWorkflowTitle').textContent=project?.name||'';
  $('roleWorkflowStatus').textContent=!idle?'先制作一段待机，确定角色的外观。':!project.masterBasis?'待机已入库。检查并修改后，选一帧定为母版。':Object.keys(project.actions).length+' 个动作 · 已确定角色母版';
  const step=!idle?1:!project.masterBasis?2:3;
  [...$('roleWorkflow').querySelectorAll('li')].forEach((item,i)=>item.setAttribute('aria-current',i===step?'step':'false'));
  $('roleMakeIdle').hidden=!!idle;
  $('roleMakeIdle').textContent=atOwnsProject()&&AT.job&&AT.action==='idle'?'继续待机制作':'制作待机';
  $('roleOpenIdle').hidden=!idle||AT.tab==='editor'&&roleIsIdle(C.bound?.id);
  $('roleNextAction').hidden=!project?.masterBasis;
  $('atelierResume').hidden=!S.source;
  $('roleSkipReference').hidden=!atTextIdle()||!!AT.reference;
  $('atelierFollowHint').hidden=!AT.follow||!AT.reference;
  $('atelierFollowHint').textContent=AT.follow&&AT.reference?'已选参考 · '+AT.reference.name+'。选择这次要生成的动作。':'';
  $('atelierNewRole').textContent=atOwnsProject()&&!Object.keys(C.project.actions).length?'将参考图设为当前工程的母版':'从母版建立独立工程';
  const templateDriven=!!project?.template;
  $('roleTemplateActions').hidden=!templateDriven;
  if(templateDriven){
    $('roleTemplateActions').innerHTML=Object.entries(project.actions).map(([id,a],index)=>{
      const status=a.draft?'待制作':a.recipe.count+' 帧';
      return `<button type="button" class="role-template-action ${C.bound?.id===id?'selected':''}" data-role-action="${esc(id)}"><span>${String(index+1).padStart(2,'0')}</span><strong>${esc(a.label||actionName(id))}</strong><small>${status}</small></button>`;
    }).join('');
    $$('[data-role-action]').forEach(b=>b.onclick=()=>openCharacterAction(b.dataset.roleAction));
  }else $('roleTemplateActions').innerHTML='';
}
function atKind(kind,reset=true){AT.kind=AT_KINDS[kind]?kind:'custom';$$('[data-atelier-kind]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.atelierKind===AT.kind)));if(reset){$('atelierWeapon').value=AT_KINDS[AT.kind].weapon;atMotion();}atConcept();atSave();}
const AT_MOTIONS={
  idle:'原地待机循环，保持自然呼吸、稳定重心与支撑脚，衣摆轻微起伏，装备随身体自然联动，首尾衔接。',
  run:'原地奔跑循环，左右腿交替支撑与摆腿，髋膝踝自然联动，装备随躯干轻微滞后，保留正常腾空。游戏位移由代码实现。',
  dash:'原地闪身，压低重心、后脚蹬地、前倾爆发、刹停回收；横向位移交给游戏代码。',
  heavy:'先稳住支撑脚、压低重心蓄力，再从下肢带动躯干和手臂释放招式，最后缓冲并收势。沿用角色原有装备。',
  jump:'屈膝、蹬地、腾空收腿、下落、落地屈膝缓冲、恢复站稳。保持人物比例，世界位移由游戏代码控制。',
  hurt:'短促受击，胸肩受力后仰，膝盖缓冲，装备随手臂滞后，回收重心恢复站姿，避免身体拉伸。',
  knockdown:'短促失衡后屈膝侧倒，髋和肩依次着地，装备随身体自然落下，最后保持倒地姿势。',
};
function atMotion(){
  const labels={idle:'待机',run:'奔跑',attack:AT.kind==='bow'?'射箭':AT.kind==='staff'?'施法':'主攻击',hurt:'受击'};
  if(AT.follow){
    delete labels.idle;
    Object.assign(labels,{dash:'闪身',heavy:'蓄力攻击',jump:'跳跃',knockdown:'倒地'});
    if(atOwnsProject())for(const [id,a]of Object.entries(C.project.actions))if(!isPresetAction(id)&&!roleIsIdle(id))labels[id]=a.label||actionName(id);
  }
  if(atOwnsProject()&&!C.project.masterBasis&&!AT.follow){for(const id of Object.keys(labels))if(id!=='idle')delete labels[id];}
  if(!labels[AT.action])AT.action=AT.follow?'run':'idle';
  const custom=C.project?.actions[AT.action];
  const presetFallback=AT.action==='attack'?AT_KINDS[AT.kind].attack:AT_MOTIONS[AT.action];
  const fallback=custom?.draft?custom.prompt:custom&&!isPresetAction(AT.action)?custom.prompt||'请描述这个自定义动作的预备、发力、主要姿势、释放或收势。':presetFallback;
  $('atelierMotion').value=AT.follow&&!custom?.draft&&isPresetAction(AT.action)&&['bow','staff'].includes(AT.kind)&&C.project?.spec.profile===AT.kind
    ?roleActionPrompt(AT.action==='attack'?'light':AT.action,fallback):fallback;
  $('atelierActions').innerHTML=Object.entries(labels).map(([id,label])=>
    '<button data-at-action="'+id+'" aria-pressed="'+(id===AT.action)+'">'+esc(label)+'</button>'
  ).join('');
  $$('[data-at-action]').forEach(b=>b.onclick=()=>{
    AT.action=b.dataset.atAction;
    if(!S.jobs.some(j=>j.id===AT.job&&['queued','running'].includes(j.status)))AT.job=null;
    atMotion();
    AT.edited=false;
    atConcept();
    atSave();
  });
}
function atBuild(){const n=number('atelierFrames'),style={chibi:'二至三头身Q版像素，清晰硬边、深色轮廓、小块分级明暗，避免平滑插画。',classic:'约三头身经典RPG像素，清晰轮廓、有限色阶，避免写实和模糊。',custom:'按下方自定义规则绘制像素角色。'}[$('atelierStyle').value];return `【角色与目标】\n${$('atelierSeed').value.trim()||AT_KINDS[AT.kind].label}\n人物特征：${$('atelierIdentity').value.trim()||(AT.reference?'严格沿用参考图的脸部、发型、服装与识别点。':'按上面的文字设计一个可辨认的原创角色。')}\n\n【美术规则】\n${style}\n${$('atelierStyleNote').value.trim()}\n目标原生画布 ${number('atelierSize')}×${number('atelierSize')}，配色目标 ${number('atelierColors')} 色；后续切帧统一采样，禁止逐帧独立缩放。${isPresetAction(AT.action)?'全身三分之四侧视，面向右侧。':'视角与人物朝向以动作描述为准。'}\n\n【装备与必须保留项】\n${$('atelierWeapon').value.trim()}\n${$('atelierKeep').value.trim()}\n\n【动作过程】\n${$('atelierMotion').value.trim()}\n完整人物逐帧，肩肘腕髋膝踝活动合理；不拆部件、不加多余肢体。\n\n【输出要求】\n${$('atelierOutput').value==='pose'?'一张完整角色就绪姿势，居中保留装备与四周余量。':`规则4列×${n/4}行动作图表，共${n}个连续关键姿势，按从左到右、从上到下排列，每格等尺寸，保持同一人物尺度与逻辑根节点，完整容纳人物、装备与特效。`}\n真实透明Alpha背景，不画底板、地面、投影、棋盘格、文字或网格线。清晰像素硬边，不抗锯齿、不模糊。角色运动位移交给游戏代码，姿势本身保留必要重心变化。` .trim();}
function atStep(step){
  const first=AT.follow?3:0;
  AT.step=Math.max(first,Math.min(5,step));
  AT.started=true;
  $('atelierCreate').classList.add('designing');
  $('atelierDesign').classList.toggle('follow-design',!!AT.follow);
  $('atelierSeedSummary').textContent=$('atelierSeed').value.trim()||AT_KINDS[AT.kind].label;
  $('atelierDesign').hidden=false;
  $$('[data-atelier-step]').forEach(el=>el.hidden=Number(el.dataset.atelierStep)!==AT.step);
  const steps=AT_STEPS.slice(first);
  $('atelierSteps').innerHTML=steps.map((item,i)=>
    '<button data-at-step="'+(i+first)+'" aria-current="'+(AT.step===i+first?'step':'false')+'"><span>'+
    String(i+1).padStart(2,'0')+'</span>'+item[0]+'</button>'
  ).join('');
  $$('[data-at-step]').forEach(b=>b.onclick=()=>atStep(Number(b.dataset.atStep)));
  const current=AT.step-first+1;
  $('atelierStepNo').textContent='STEP '+String(current).padStart(2,'0')+' / '+String(steps.length).padStart(2,'0');
  $('atelierStepTitle').textContent=AT_STEPS[AT.step][1];
  $('atelierStepHint').textContent=AT_STEPS[AT.step][2];
  $('atelierPrev').disabled=AT.step===first;
  $('atelierNext').hidden=AT.step===5;
  $('atelierNext').textContent=AT.step===3?'查看制作稿 →':AT.step===4?'前往生成 →':'下一步 →';
  $('atelierFree').hidden=AT.follow||AT.step>=4;
  $('atelierStepStatus').textContent=current+' / '+steps.length+' · '+AT_STEPS[AT.step][0];
  if(AT.step>=4&&!AT.edited)$('atelierTask').value=atBuild();
  $('atelierTaskNote').textContent=AT.edited?'正在使用手动编辑稿。重新整理会覆盖本段文字，请先下载备份。':'由当前设计选项整理，可直接编辑。';
  atConcept();
  atSyncJob();
  atSave();
}
function atConcept(){atProjectLabel();const title=$('atelierSeed').value.trim();$('atelierConceptName').textContent=title?title.slice(0,35):'你的下一个游戏角色';$('atelierConceptDesc').textContent=$('atelierIdentity').value.trim()||'选角色、定画风，再安排动作。';$('atelierConceptKind').textContent=AT_KINDS[AT.kind].label;$('atelierNewRole').disabled=!AT.reference;const art=$('atelierConceptArt');if(AT.reference){if(art.querySelector('img')?.src!==AT.reference.url)art.innerHTML=`<img src="${esc(AT.reference.url)}" alt="本次角色参考图">`;}else art.innerHTML='<span>选定参考后<br>在这里查看角色</span>';$('atelierConceptFacts').innerHTML=[['画风',$('atelierStyle').selectedOptions[0].textContent],['装备',AT_KINDS[AT.kind].label],['输出',$('atelierOutput').value==='pose'?'单张姿势':number('atelierFrames')+' 个关键姿势'],['目标画布',number('atelierSize')+' × '+number('atelierSize')+' px'],['透明背景','真实 Alpha']].map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');}
async function atReference(r){
  const epoch=AT.epoch;
  const url=await dataURL(r.url);
  if(epoch!==AT.epoch)return;
  AT.reference={url,name:r.name||'角色参考'};
  atConcept();
  atSave();
  toast('已选为本次设计的参考图');
}
async function atReadReference(f){if(!f)return;const epoch=AT.epoch;try{if(!['image/png','image/jpeg'].includes(f.type)||f.size>12*1024*1024)throw Error('请选择12MB以内的PNG或JPG');const url=await readFile(f),im=await loadImage(url);if(im.width*im.height>16000000)throw Error('图片请不超过1600万像素');if(epoch===AT.epoch)await atReference({url,name:f.name});}catch(e){toast(e.message);}}
function atTab(tab){if(tab!=='delivery')deliveryStop();AT.tab=tab;$('atelierUtilities').open=false;atProjectLabel();window.productionFlow?.sync();document.body.classList.toggle('atelier-editing',tab==='editor');document.body.classList.toggle('atelier-shell',true);for(const [key,id]of Object.entries({create:'atelierCreate',works:'atelierWorks',references:'atelierReferences',delivery:'atelierDelivery',editor:'atelierEditorPanel'}))$(id).hidden=key!==tab;$$('[data-atelier-tab]').forEach(b=>b.setAttribute('aria-current',b.dataset.atelierTab===tab?'page':'false'));if(tab==='editor'){S.easy=true;view('animate');window.simpleEditor?.enter();}else if(tab==='references'){atRenderReferences();}else if(tab==='works'||tab==='create')atRenderWorks();else if(tab==='delivery')atRenderDelivery();atSave();}
async function atRenderWorks(){try{AT.projects=await api('/projects');const q=$('atelierWorkSearch').value.toLowerCase(),rows=AT.projects.filter(p=>p.name.toLowerCase().includes(q));const cards=rows.map(p=>`<article class="atelier-project-card"><span class="atelier-small-label">${p.frozen?'已冻结规格':'设计中'} · ${p.actions} 个动作</span><h3>${esc(p.name)}</h3><p>修订 ${p.revision}${p.parent_id?' · 独立副本':''}</p><div><button data-at-project="${p.id}">打开工程 ↗</button><button data-at-clone="${p.id}">复制</button></div></article>`).join('');$('atelierWorksList').innerHTML=cards||'<p class="atelier-empty">还没有匹配的角色工程。可以导入已有图表，再从当前动作新建。</p>';$('atelierRecentList').innerHTML=rows.slice(0,3).map(p=>`<button data-at-project="${p.id}" class="atelier-recent-item"><strong>${esc(p.name)}</strong><span>${p.actions} 个动作 · 修订 ${p.revision}　↗</span></button>`).join('')||'<p class="atelier-empty">你的角色工程会出现在这里。可以先导入图表，或从参考图开始设计。</p>';$$('[data-at-project]').forEach(b=>b.onclick=()=>atOpenProject(b.dataset.atProject));$$('[data-at-clone]').forEach(b=>b.onclick=async()=>{await flushWorkspace();try{const p=await api('/projects/clone',{id:b.dataset.atClone});await useCharacter(p);atRenderWorks();toast('已复制独立工程，原作品保留');}catch(e){toast(e.message);}});$('atelierGeneratedList').innerHTML=S.jobs.filter(j=>j.status==='completed'&&(!q||(j.prompt||'').toLowerCase().includes(q))).map(j=>`<article><div><img src="${esc(j.image_url)}" alt="生成结果"></div><h3>${esc(actionName(j.action))} · ${j.kind==='sheet'?'动作图表':'角色姿势'}</h3><p>${esc(new Date(j.created_at*1000).toLocaleDateString())}</p><button data-at-result="${j.id}">打开并检查排版 ↗</button></article>`).join('')||'<p class="atelier-empty">还没有匹配的生成结果。</p>';$$('[data-at-result]').forEach(b=>b.onclick=async()=>{const j=S.jobs.find(j=>j.id===b.dataset.atResult);if(j.character_context?.id!==C.project?.id)await atDetach();await openLayout(j.image_url,'生成结果 · '+actionName(j.action),j);atTab('editor');});}catch(e){toast(e.message);}}
function atRenderReferences(){const mount=$('atelierReferencesMount');mount.innerHTML=[...S.refs.map(r=>({...r,type:'收藏参考'})),...S.jobs.filter(j=>j.status==='completed').map(j=>({...j,name:actionName(j.action)+' · 生成版本',type:'生成结果'}))].map(r=>`<article class="atelier-ref-card"><div><img src="${esc(r.image_url)}" alt="${esc(r.name)}"></div><span>${esc(r.type)}</span><h3>${esc(r.name)}</h3><button data-at-reference="${r.image_url}" data-name="${esc(r.name)}">用作本次参考 ↗</button></article>`).join('')||'<p class="atelier-empty">还没有角色参考，可以先导入一张完整角色图。</p>';$$('[data-at-reference]').forEach(b=>b.onclick=async()=>{await atReference({url:b.dataset.atReference,name:b.dataset.name});atTab('create');atStep(0);});}
function atTextIdle(){
  return atOwnsProject()&&AT.action==='idle'&&$('atelierOutput').value==='sheet'&&!!$('atelierSeed').value.trim();
}
async function atSubmit(){
  if(AT.submitting)return;
  const epoch=AT.epoch;
  AT.error='';
  try{
    const extending=AT.follow&&atOwnsProject()&&AT.action!=='idle';
    const reference=extending?C.project.master:AT.reference?.url;
    if(extending&&!C.project.masterBasis)throw Error('请先定稿待机母版');
    const fromText=!reference&&atTextIdle();
    if(!reference&&!fromText)throw Error('先选一张角色参考图，或填写角色想法制作待机');
    const prompt=$('atelierTask').value.trim();
    if(!prompt||prompt.length>6000)throw Error('制作稿需要1至6000字');
    AT.submitting=true;
    atSyncJob();
    const count=number('atelierFrames'),kind=extending?'sheet':$('atelierOutput').value;
    const job=await api('/jobs',{
      prompt,reference,from_text:fromText,kind,
      action:AT.action==='attack'?'light':AT.action,
      layout:kind==='sheet'?{cols:4,rows:count/4,count}:null,
      character_context:atOwnsProject()?window.characterProject.context():null,
    });
    S.jobs.unshift(job);
    if(epoch===AT.epoch){AT.job=job.id;AT.lastStatus='';atSave();}
    refresh();
  }catch(e){
    if(epoch===AT.epoch){AT.error=e.message;toast(e.message);}
  }finally{
    if(epoch===AT.epoch){AT.submitting=false;atSyncJob();}
  }
}
function atSyncJob(){const j=S.jobs.find(j=>j.id===AT.job),canSubmit=AT.reference||atTextIdle(),busy=S.jobs.some(j=>['running','queued'].includes(j.status));$('atelierSubmit').disabled=AT.submitting||busy||!canSubmit;$('atelierSubmit').hidden=!!j;$('atelierOpenResult').hidden=j?.status!=='completed';$('atelierRetry').hidden=j?.status!=='failed';if(!j){$('atelierProductionBadge').textContent=canSubmit?'准备就绪':'缺少角色描述或参考图';$('atelierProductionTitle').textContent='检查完要求，再开始制作。';if(AT.error)$('atelierProductionText').textContent=AT.error;else if(canSubmit&&!AT.submitting)$('atelierProductionText').textContent='使用已配置的生图 API 生成透明 PNG。通常需要几分钟，一次只处理一个任务。';if(!canSubmit&&!AT.error)$('atelierProductionText').textContent='返回角色步骤，选择参考图，或在角色工程中用文字制作第一段待机。';return;}if(AT.lastStatus===j.status)return;AT.lastStatus=j.status;const labels={queued:'等待制作',running:'正在生成',completed:'图表已完成',failed:'制作未完成'};$('atelierProductionBadge').textContent=labels[j.status]||j.status;$('atelierProductionTitle').textContent=j.status==='completed'?'先检查排版，再看动作。':j.status==='failed'?'保留设计稿，修正后重试。':'角色动作正在制作。';$('atelierProductionText').textContent=j.status==='completed'?'生成完成仅代表透明PNG已返回。确认实际排版，检查角色和装备，再进入时间轴。':j.status==='failed'?j.error||'查看任务记录了解原因。':'正在通过生图 API 处理，不显示推测进度。通常需要几分钟。';}
async function atRoleExport(){try{await flushWorkspace();if(C.conflict)throw Error('工程保存冲突，请先下载工程备份并重新打开');if(!C.project)throw Error('先打开角色工程');$('atelierDeliveryMessage').textContent='正在检查并打包全部动作…';$('atelierExportRole').disabled=true;const r=await api('/projects/export',{id:C.project.id});$('atelierRoleDownload').href=r.zip_url;$('atelierRoleDownload').hidden=false;$('atelierDeliveryMessage').textContent=`已准备 ${r.actions} 个动作的资源包。视觉与实机审核仍由你确认。`;}catch(e){$('atelierDeliveryMessage').textContent=e.message;}finally{$('atelierExportRole').disabled=!C.project;}}
async function atCatalog(){try{const items=await api('/catalog');for(const item of items){const el=document.querySelector('[data-atelier-kind="'+item.id+'"]');if(!el||el.querySelector('img'))continue;const art=document.createElement('img');art.src=item.image_url;art.alt=AT_KINDS[item.id].label+'造型参考';art.className='atelier-category-art';el.prepend(art);}}catch(e){/* Optional local samples; upload remains available. */}}
function atApplyDraft(d,project=null){
  const draft=d?.version===1?d:null;
  const freshKind=project?(project.spec.profile||'custom'):'greatsword';
  Object.assign(AT,{
    step:draft?.step||0,action:draft?.action&&(draft.action==='attack'||Object.hasOwn(AT_MOTIONS,draft.action)||window.characterProject?.hasAction(draft.action))?draft.action:'idle',
    follow:!!draft?.follow&&!!project?.masterBasis,
    reference:draft?.reference||null,job:draft?.job||null,started:!!draft?.started,edited:!!draft?.edited,
    projectId:project?.id||null,lastStatus:'',error:'',submitting:false,epoch:(AT.epoch||0)+1,
  });
  for(const id of AT_IDS)$(id).value=draft?.fields?.[id]??AT_DEFAULTS[id];
  if(project&&!draft){
    $('atelierSize').value=project.spec.frameSize;
    $('atelierColors').value=project.spec.paletteLimit||64;
  }
  $('atelierReferenceFile').value='';
  const motion=$('atelierMotion').value;
  atKind(draft?.kind||freshKind,!draft);
  if(project&&!draft){
    $('atelierIdentity').value=project.spec.identity||'';
    $('atelierWeapon').value=project.spec.weapon||'';
  }
  if(draft){
    atMotion();
    $('atelierMotion').value=motion;
  }
  if(AT.started)atStep(AT.step);
  else{
    $('atelierDesign').hidden=true;
    $('atelierSeedSummary').textContent='';
    $('atelierCreate').classList.remove('designing');
  }
  atConcept();
  atSyncJob();
}
async function atRestore(){
  AT.hydrating=true;
  const requested=new URLSearchParams(location.search).get('character');
  try{
    await C.ready;
    if(requested&&/^[a-f0-9]{32}$/.test(requested)&&requested!==C.project?.id){
      await atOpenProject(requested,true);
      return;
    }
    const last=await atReadDraft('atelier');
    const project=C.project;
    const blank=project&&!Object.keys(project.actions).length;
    const owned=project&&last?.projectId===project.id;
    const design=owned?last:blank?await atReadDraft('atelier:'+project.id):last?.projectId?null:last;
    atApplyDraft(design,owned||blank?project:null);
    if(blank&&requested)atTab('create');
    else if(requested)atTab(design?.tab||'editor');
    else atTab(design?.tab||'create');
    if(requested&&AT.tab==='editor'&&project&&!C.bound&&!S.source&&Object.keys(project.actions).length){
      await openCharacterAction(atIdleAction()||Object.entries(project.actions).find(([,a])=>!a.draft)?.[0]);
    }
  }catch(e){
    $('atelierDraftStatus').textContent='草稿未恢复，可重新开始或导入项目。';
  }finally{
    AT.hydrating=false;
    atSave();
  }
}
function atResetWorkspace(project){
  C.undo=null;
  Object.assign(G,{choice:null,pending:null,step:1,action:'light',error:'',submitting:false,layoutEpoch:G.layoutEpoch+1});
  $('guideNote').value='';
  $('guideDetail').value='16';
  for(const id of ['guideRefImage','guideSummaryImage','guideJobImage'])$(id).removeAttribute('src');
  clearWorkingMedia(project);
  view('start');
}
function atClearProjectLink(){
  const url=new URL(location.href);
  url.searchParams.delete('character');
  history.replaceState(history.state,'',url);
}
async function atActivateProject(project,design){
  clearTimeout(C.timer);
  clearTimeout(AT.timer);
  C.suspend=true;
  const hydrating=AT.hydrating;
  AT.hydrating=true;
  try{
    await useCharacter(project);
    atResetWorkspace(project);
    const blank=!Object.keys(project.actions).length;
    atApplyDraft(design,project);
    atTab('create');
  }finally{
    C.suspend=false;
    AT.hydrating=hydrating;
  }
  if($('characterDialog').open)$('characterDialog').close();
  const first=atIdleAction()||Object.entries(project.actions).find(([,a])=>!a.draft)?.[0];
  if(first&&!window.productionFlow)await openCharacterAction(first);
  await flushWorkspace(false);
  await atWriteDraft();
}
async function atOpenProject(id,preserveLink=false){
  if(AT.switching||AT.creating)return;
  AT.switching=true;
  try{
    if(C.project?.id===id&&atOwnsProject()&&!Object.keys(C.project.actions).length){
      atTab('create');
      if($('characterDialog').open)$('characterDialog').close();
      return;
    }
    await flushWorkspace();
    if(!AT.hydrating)await atWriteDraft();
    const [project,design]=await Promise.all([api('/project/'+id),atReadDraft('atelier:'+id)]);
    if(!preserveLink)atClearProjectLink();
    await atActivateProject(project,design);
  }catch(e){toast(e.message);}
  finally{AT.switching=false;}
}
async function atDetach(){
  await flushWorkspace();
  if(atOwnsProject()){
    await atWriteDraft();
    AT.projectId=null;
  }
  C.project=null;C.bound=null;C.conflict=false;C.savedFingerprint=null;
  atProjectLabel();
  renderCharacter();
}
async function atCreateRole(){
  if(AT.creating)return;
  if(!AT.reference)return toast('先选一张母版参考图');
  const attach=atOwnsProject()&&!Object.keys(C.project.actions).length;
  AT.creating=true;
  $$('[data-atelier-tab]').forEach(b=>b.disabled=true);
  $('atelierNewRole').disabled=true;
  try{
    const size=number('atelierSize'),colors=number('atelierColors');
    const im=await loadImage(AT.reference.url);
    const extent=bounds(im,{x:0,y:0,w:im.width,h:im.height});
    if(!extent)throw Error('参考图中没有可见角色');
    if(!attach)await atDetach();
    const [left,top,right,bottom]=extent;
    const scale=Math.min(8,(size-28)/Math.max(right-left,bottom-top));
    const pivot=[size/2,size-16];
    C.suspend=true;
    try{
      await source(AT.reference.url,AT.reference.name);
      setReference(AT.reference);
      selectPreset('idle');
      $('projectName').value=attach?C.project.name:($('atelierSeed').value.trim()||'我的角色').slice(0,80);
      S.easy=true;
      slice({cols:1,rows:1,count:1,frameSize:size,scale,
        baseOffset:[Math.round(size/2-(left+right)/2*scale),Math.round(size-16-bottom*scale)],
        pivot,offsets:[[0,0]],durations:[100],colors,previewScale:4,loop:true});
    }finally{C.suspend=false;}
    if(!S.frames.length)throw Error('未能建立待机母版');
    if(attach){
      C.project.master=S.sourceData;
      Object.assign(C.project.spec,{frameSize:size,pivot});
      C.project.actions.idle=currentAction('待机母版 · 单帧');
      C.bound={id:'idle',epoch:S.sourceEpoch};
    }else await createCharacter();
    if(C.bound?.epoch!==S.sourceEpoch)throw Error('角色工程未能保存');
    Object.assign(C.project.spec,{
      identity:$('atelierIdentity').value.trim()||$('atelierSeed').value.trim(),
      weapon:$('atelierWeapon').value.trim(),profile:AT.kind,paletteLimit:colors,
      style:$('atelierStyle').selectedOptions[0].textContent+'；'+$('atelierStyleNote').value,
    });
    C.project.actions.idle.label='待机母版 · 单帧';
    C.project.actions.idle.prompt=roleActionPrompt('idle','原地待机，保持母版人物与装备。');
    $('prompt').value=C.project.actions.idle.prompt;
    C.project.spec.version++;
    await flushWorkspace();
    if(C.conflict)throw Error('当前工程未能保存，请先检查工程修订');
    await freezeCharacter();
    renderCharacter();
    atTab('editor');
    toast('待机母版已保存到角色工程');
  }catch(e){toast(e.message);}
  finally{
    AT.creating=false;
    $$('[data-atelier-tab]').forEach(b=>b.disabled=false);
    atConcept();
  }
}
function atNewProjectPayload(name){
  return {
    format:'pixel-atelier-character/1',name,master:null,
    spec:{
      frameSize:224,pivot:[112,208],paletteLimit:64,palette:[],frozen:false,version:0,
      profile:'custom',identity:'',weapon:'',
      style:'2.5至3头身Q版硬边像素（Chibi Pixel Art），清晰1px深黑像素外轮廓，简化面部（斗笠或刘海遮眼、只露简洁下颌，不画写实五官），大块干净复古像素色阶（32-64色，无细碎写实纹理、无平滑抗锯齿、严禁写实八头身比例），真实透明Alpha背景',
    },
    actions:{},
  };
}
function bindNewRole(){
  const dialog=$('newRoleDialog'),form=$('newRoleForm'),name=$('newRoleName');
  const submit=$('newRoleSubmit'),status=$('newRoleStatus');
  let busy=false;
  function update(){
    submit.disabled=busy||!name.value.trim();
    submit.textContent=busy?'正在创建…':'创建空白工程';
    for(const control of [name,$('newRoleCancel'),$('newRoleClose'),$('newRoleArcher')])control.disabled=busy;
  }
  function open(){
    form.reset();
    status.textContent='';
    update();
    dialog.showModal();
    name.focus();
  }
  $('newRoleTop').onclick=$('newRoleWorks').onclick=open;
  $('newRoleClose').onclick=$('newRoleCancel').onclick=()=>dialog.close();
  dialog.oncancel=e=>{if(busy)e.preventDefault();};
  name.addEventListener('input',update);
  async function createProject(endpoint,payload,message){
    if(busy||C.restoring||AT.hydrating||AT.switching||AT.creating)return;
    busy=true;
    status.textContent='';
    update();
    let saved;
    try{
      await flushWorkspace();
      await atWriteDraft();
      saved=await api(endpoint,payload);
      atClearProjectLink();
      await atActivateProject(saved,null);
      dialog.close();
      $('productionGenerate').focus();
      toast(message);
    }catch(e){
      if(saved){
        dialog.close();
        atTab('works');
        toast('工程已保存，请从作品列表打开。');
      }else status.textContent=e.message;
    }finally{
      busy=false;
      update();
    }
  }
  form.onsubmit=e=>{
    e.preventDefault();
    if(!submit.disabled)createProject('/projects',atNewProjectPayload(name.value.trim()),'已创建空白角色工程');
  };
  $('newRoleArcher').onclick=()=>createProject('/projects/archer',{name:name.value.trim()},'已创建七方向弓箭手模板');
}
function roleIsIdle(id){
  return /^idle(?:_v[0-9]+)?$/.test(id||'');
}
function atIdleAction(){
  const project=C.project;
  if(!project)return null;
  return project.masterBasis?.action||Object.keys(project.actions).filter(id=>roleIsIdle(id)&&!project.actions[id].draft).at(-1)||null;
}
function atMakeIdle(reference=null){
  const project=C.project;
  if(!project)return $('newRoleTop').click();
  if(!atOwnsProject()){
    AT.projectId=project.id;
    atKind(project.spec.profile||'custom');
  }
  Object.assign(AT,{reference:reference||AT.reference,follow:false,action:'idle',job:null,edited:false,error:'',lastStatus:''});
  if(!$('atelierSeed').value.trim())$('atelierSeed').value=project.name;
  $('atelierOutput').value='sheet';
  $('atelierSize').value=project.spec.frameSize;
  $('atelierColors').value=project.spec.paletteLimit||64;
  atMotion();
  atTab('create');
  atStep(reference?3:0);
  $('atelierDesign').scrollIntoView({block:'start'});
}

async function atStartFollow(action='run'){
  const project=C.project;
  if(!project?.masterBasis||!project.master){
    toast('先打开待机，在时间轴选一帧并定稿');
    return;
  }
  if(!atOwnsProject()){
    AT.projectId=project.id;
    atKind(project.spec.profile||(mageProfile()?'staff':project.template_origin?'greatsword':'custom'));
  }
  const reference={url:project.master,name:project.name+' · 定稿待机母版'};
  Object.assign(AT,{reference,follow:true,action,job:null,edited:false,error:'',lastStatus:''});
  $('atelierOutput').value='sheet';
  $('atelierSize').value=project.spec.frameSize;
  $('atelierColors').value=project.spec.paletteLimit||64;
  if(!$('atelierSeed').value.trim())$('atelierSeed').value=project.name;
  atMotion();
  setReference(reference);
  atTab('create');
  atStep(3);
  $('atelierDesign').scrollIntoView({block:'start'});
  await atWriteDraft();
  await flushWorkspace();
}

async function atFinalizeIdle(){
  const project=C.project,id=C.bound?.id;
  if(!project||!roleIsIdle(id)||!S.frames.length||C.bound.epoch!==S.sourceEpoch)return;
  if(S.frames.length<2)throw Error('待机需要两帧或更多。请先导入待机 GIF 或生成连续待机。');
  const index=S.index;
  const frame=frameCanvas(index);
  if(!bounds(frame,{x:0,y:0,w:S.size,h:S.size}))throw Error('请选择有完整角色的帧');
  await flushWorkspace();
  if(C.conflict||C.project!==project)throw Error('工程当前无法保存，请重新打开工程后再试');
  project.master=frame.toDataURL('image/png');
  project.masterBasis={action:id,frame:index};
  const r=project.actions[id].recipe;
  Object.assign(project.spec,{
    frameSize:r.frameSize,pivot:r.pivot,version:project.spec.version+1,profile:atOwnsProject()?AT.kind:project.spec.profile||AT.kind,
    identity:$('atelierIdentity').value.trim()||project.spec.identity,
    weapon:$('atelierWeapon').value.trim()||project.spec.weapon,
  });
  await flushWorkspace();
  if(C.conflict)throw Error('母版未能保存，请检查工程修订');
  if(!project.spec.frozen)await freezeCharacter();
  atProjectLabel();
  window.simpleEditor?.sync();
  await atStartFollow();
  toast('待机已定稿，后续动作会沿用所选母版');
}

async function atOpenResult(){
  const job=S.jobs.find(j=>j.id===AT.job);
  if(job?.status!=='completed')return;
  if(!atOwnsProject())await atDetach();
  if(AT.reference)setReference(AT.reference);
  const title=window.characterProject?.actionLabel(job.action)||actionName(job.action);
  await openLayout(job.image_url,'新动作 · '+title,job);
  if(S.job?.id!==job.id)return;
  selectPreset(job.action||'idle');
  $('prompt').value=job.prompt||$('prompt').value;
  updatePrompt();
  S.pendingAtelierSize=number('atelierSize');
  $('frameSize').value=S.pendingAtelierSize;
  atTab('editor');
}

function sharpenGifThumbnail(image){
  const w=image.naturalWidth,h=image.naturalHeight;
  const extent=bounds(image,{x:0,y:0,w,h});
  if(!extent)return;
  const [left,top,right,bottom]=extent;
  const width=right-left,height=bottom-top;
  if(width===w&&height===h)return;
  const thumbnail=document.createElement('canvas');
  const zoom=100/Math.max(width,height);
  const rim=6;
  const innerWidth=Math.max(1,Math.round(width*zoom)),innerHeight=Math.max(1,Math.round(height*zoom));
  thumbnail.width=innerWidth+2*rim;
  thumbnail.height=innerHeight+2*rim;
  const ctx=thumbnail.getContext('2d');
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(image,left,top,width,height,rim,rim,innerWidth,innerHeight);
  image.src=thumbnail.toDataURL('image/png');
}
function bindGifReference(){
  const dialog=$('gifReferenceDialog'),input=$('gifReferenceFile');
  const list=$('gifReferenceFrames'),message=$('gifReferenceStatus'),confirm=$('gifReferenceConfirm');
  let token=0,selection=null,gif=null,applying=false;
  function open(){
    if(!C.project){$('newRoleTop').click();return;}
    ++token;
    input.value='';
    selection=null;
    gif=null;
    confirm.disabled=true;
    message.textContent='';
    list.replaceChildren();
    dialog.showModal();
  }
  $('atelierUseGif').onclick=$('atelierDesignGif').onclick=open;
  $('roleSkipReference').onclick=()=>atStep(3);
  $('roleMakeIdle').onclick=()=>{
    if(atOwnsProject()&&AT.job&&AT.action==='idle'){atTab('create');atStep(5);}
    else atMakeIdle();
  };
  $('roleOpenIdle').onclick=async()=>{
    try{
      await openCharacterAction(atIdleAction());
      atTab('editor');
    }catch(e){toast(e.message);}
  };
  $('roleNextAction').onclick=()=>{
    const active=S.jobs.find(j=>j.id===AT.job&&['queued','running'].includes(j.status));
    if(atOwnsProject()&&AT.follow&&active){atTab('create');atStep(5);return;}
    atStartFollow().catch(e=>toast(e.message));
  };
  dialog.addEventListener('close',()=>{token++;});
  dialog.addEventListener('cancel',e=>{if(applying)e.preventDefault();});
  input.onchange=async()=>{
    const request=++token,epoch=AT.epoch,selected=input.files[0];
    selection=null;
    confirm.disabled=true;
    list.replaceChildren();
    if(!selected){message.textContent='';return;}
    message.textContent='正在读出 GIF 的参考帧…';
    try{
      if(!/\.gif$/i.test(selected.name)||selected.size>12*1024*1024)throw Error('请选择 12 MB 以内的 GIF');
      const image=await readFile(selected);
      const result=await api('/references/gif-frames',{image});
      if(request!==token||epoch!==AT.epoch)return;
      gif=image;
      message.textContent='共 '+result.count+' 帧，可从下方 '+result.frames.length+' 张中选择。';
      for(const frame of result.frames){
        const b=document.createElement('button');
        const preview=document.createElement('img');
        const name='第 '+(frame.index+1)+' 帧';
        b.type='button';
        b.setAttribute('aria-pressed','false');
        preview.addEventListener('load',()=>sharpenGifThumbnail(preview),{once:true});
        preview.src=frame.image;
        preview.alt='';
        b.append(preview,name);
        b.onclick=()=>{
          for(const button of list.children)button.setAttribute('aria-pressed',String(button===b));
          selection=frame.index;
          confirm.disabled=false;
        };
        list.append(b);
      }
      list.firstElementChild?.click();
    }catch(e){if(request===token)message.textContent=e.message;}
  };
  confirm.onclick=async()=>{
    if(selection===null||!gif||applying)return;
    applying=true;
    confirm.disabled=input.disabled=true;
    const close=dialog.querySelector('[data-close]');
    close.disabled=true;
    message.textContent='正在保存完整待机及帧时长…';
    try{
      await flushWorkspace();
      if(C.conflict)throw Error('工程有保存冲突，请重新打开后再试');
      const result=await api('/projects/idle-gif',{
        image:gif,index:selection,id:C.project.id,expected_revision:C.project.revision,
      });
      const design=atDraft();
      await useCharacter(result.project);
      if(!atOwnsProject())atApplyDraft(design,result.project);
      await openCharacterAction(result.action);
      atTab('editor');
      selectFrame(result.reference_index);
      await flushWorkspace();
      dialog.close();
      toast('已保存完整待机。修改后，可将选中帧定为母版。');
    }catch(e){message.textContent=e.message;}
    finally{
      applying=false;
      confirm.disabled=input.disabled=close.disabled=false;
    }
  };
}

function bindAtelier(){bindNewRole();bindGifReference();document.body.classList.add('atelier-shell');$$('[data-atelier-tab]').forEach(b=>b.onclick=()=>atTab(b.dataset.atelierTab));$$('[data-atelier-kind]').forEach(b=>b.onclick=()=>atKind(b.dataset.atelierKind));$('atelierBegin').onclick=()=>{if(!$('atelierSeed').value.trim()){toast('先写一句角色想法，再开始设计');$('atelierSeed').focus();return;}if(!C.project){$('newRoleTop').click();return;}if(!$('atelierIdentity').value.trim())$('atelierIdentity').value=$('atelierSeed').value.trim();if(!C.project.masterBasis)atMakeIdle();else atStep(0);$('atelierDesign').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'start'});};AT_IDS.forEach(id=>$(id).addEventListener('input',()=>{if(id==='atelierTask')AT.edited=true;atConcept();atSave();}));$('atelierNext').onclick=()=>atStep(AT.step+1);$('atelierPrev').onclick=()=>atStep(AT.step-1);$('atelierFree').onclick=()=>atStep(4);$('atelierRebuild').onclick=()=>{AT.edited=false;$('atelierTask').value=atBuild();atStep(4);};$('atelierCopy').onclick=async()=>{try{await navigator.clipboard.writeText($('atelierTask').value);toast('制作稿已复制');}catch(e){toast('复制不可用，请下载制作稿');}};$('atelierDownload').onclick=()=>downloadBlob(new Blob([$('atelierTask').value],{type:'text/plain;charset=utf-8'}),'像素角色-制作稿.txt');$('atelierSubmit').onclick=atSubmit;$('atelierRetry').onclick=()=>{AT.job=null;AT.lastStatus='';atStep(4);};$('atelierOpenResult').onclick=atOpenResult;$('atelierShowTasks').onclick=()=>{atTab('editor');view('tasks');};$('atelierResume').onclick=()=>atTab('editor');$('atelierImport').onclick=()=>$('easyImportFile').click();$('atelierNewRole').onclick=atCreateRole;$('atelierEditIdea').onclick=()=>{$('atelierCreate').classList.remove('designing');$('atelierSeed').focus();};$('atelierBackDesign').onclick=()=>atTab('create');$('atelierAllWorks').onclick=()=>atTab('works');$('atelierProjectManager').onclick=()=>$('characterButton').click();$('atelierReferenceUpload').onclick=()=>$('libraryFile').click();$('atelierPickReference').onclick=()=>atTab('references');$('atelierReferenceFile').onchange=async e=>{await atReadReference(e.target.files[0]);e.target.value='';};$('atelierUpload').ondragover=e=>e.preventDefault();$('atelierUpload').ondrop=async e=>{e.preventDefault();await atReadReference(e.dataTransfer.files[0]);};$('atelierUseCurrent').onclick=()=>{const r=C.project?.master?{url:C.project.master,name:C.project.name}:S.reference;if(!r)return toast('当前没有角色母版，请上传');atReference(r);};$('atelierClearRef').onclick=()=>{AT.reference=null;atConcept();atSave();};$('atelierWorkSearch').oninput=atRenderWorks;$('atelierExportOne').onclick=()=>{openExport();};$('atelierExportRole').onclick=atRoleExport;$('atelierBackupRole').onclick=downloadCharacter;$('atelierExamplesMount').append($('showcaseMoves'));$('atelierPractice').onclick=async()=>{await practiceSample();atTab('editor');};$('quickHome').onclick=()=>atTab('create');window.atelierStudio={sync:()=>{window.simpleEditor?.sync();atSyncJob();if(AT.tab==='works')atRenderWorks();},editor:()=>atTab('editor')};const rawView=view;view=function(name){rawView(name);if(name==='animate'&&!C.restoring&&!C.suspend&&!AT.creating&&S.source&&!AT.hydrating&&AT.tab!=='editor'){atTab('editor');}if(AT.tab==='editor')document.body.classList.add('atelier-editing');};atCatalog();atRestore();}
bindAtelier();
