/* Review the same whole poses and timing used by the animation editor. */
const delivery={frames:[],index:0,elapsed:0,tick:0,last:null,loading:false};
const deliveryManualItems=[
  '人物、配色和武器与母版一致',
  '支撑脚、躯干和武器路线连贯',
  '发力、接触、惯性和收势清楚',
  '已在游戏中验证动作衔接与反馈',
];

function deliveryStop(){
  cancelAnimationFrame(delivery.tick);
  delivery.tick=0;
  delivery.last=null;
  $('deliveryPlay').textContent='播放';
}

function deliveryDraw(){
  const frame=delivery.frames[delivery.index];
  if(!frame)return;
  const canvas=$('deliveryCanvas'),ctx=canvas.getContext('2d');
  const scale=number('deliveryScale');
  const [px,py]=delivery.pivot;
  canvas.style.width=canvas.style.height=S.size*scale+'px';
  ctx.clearRect(0,0,S.size,S.size);
  ctx.imageSmoothingEnabled=false;
  if(delivery.validPivot){
    ctx.fillStyle=$('deliveryBackground').value==='dark'?'#8c9bb1':'#637086';
    ctx.fillRect(0,py,S.size,1);
    ctx.fillRect(px,py-5,1,11);
    ctx.fillRect(px-3,py-3,7,1);
  }
  ctx.drawImage(frame.image,0,0);
  $('deliveryPosition').textContent=(delivery.index+1)+' / '+delivery.frames.length+' · '+frame.start+' ms';
  for(const [i,button] of [...$('deliveryStrip').children].entries()){
    button.setAttribute('aria-current',String(i===delivery.index));
  }
  const marked=(S.events?.[delivery.eventType]||[]).includes(delivery.index);
  $('deliveryEvent').setAttribute('aria-pressed',String(marked));
  $('deliveryEvent').textContent=(marked?'取消':'标记')+delivery.eventLabel;
}

function deliverySelect(index,scroll=false){
  deliveryStop();
  delivery.index=(index+delivery.frames.length)%delivery.frames.length;
  delivery.elapsed=0;
  deliveryDraw();
  if(scroll)$('deliveryStrip').children[delivery.index]?.scrollIntoView({block:'nearest',inline:'nearest'});
}

function deliveryTick(time){
  const frame=delivery.frames[delivery.index];
  if(!frame)return deliveryStop();
  if(delivery.last!==null)delivery.elapsed+=Math.min(100,time-delivery.last)*number('deliverySpeed');
  delivery.last=time;
  const oldIndex=delivery.index;
  while(delivery.elapsed>=delivery.frames[delivery.index].duration){
    delivery.elapsed-=delivery.frames[delivery.index].duration;
    if(delivery.index===delivery.frames.length-1&&!$('loop').checked){
      if(oldIndex!==delivery.index)deliveryDraw();
      delivery.elapsed=0;
      return deliveryStop();
    }
    delivery.index=(delivery.index+1)%delivery.frames.length;
  }
  if(oldIndex!==delivery.index)deliveryDraw();
  delivery.tick=requestAnimationFrame(deliveryTick);
}

function deliveryPlay(){
  if(delivery.tick)return deliveryStop();
  if(!$('loop').checked&&delivery.index===delivery.frames.length-1)deliverySelect(0);
  $('deliveryPlay').textContent='暂停';
  delivery.tick=requestAnimationFrame(deliveryTick);
}

function deliveryEdit(index,calibrate=false){
  if(delivery.loading)return;
  atTab('editor');
  selectFrame(index);
  if(calibrate){
    if($('seMode').getAttribute('aria-pressed')==='false')$('seMode').click();
    $('pivotX').focus();
    return;
  }
  $('timeline').querySelectorAll('.frame-card')[index]?.scrollIntoView({block:'nearest',inline:'nearest'});
}

function deliverySettings(){
  $('deliveryStage').dataset.background=$('deliveryBackground').value;
  deliveryDraw();
  const stage=$('deliveryStage');
  stage.scrollLeft=Math.max(0,(stage.scrollWidth-stage.clientWidth)/2);
  stage.scrollTop=Math.max(0,delivery.pivot[1]*number('deliveryScale')-stage.clientHeight+36);
  try{
    localStorage.setItem('pixel-review-view-'+(C.project?.id||'clip'),JSON.stringify({
      scale:$('deliveryScale').value,background:$('deliveryBackground').value,
    }));
  }catch(e){/* Preview still works with storage disabled. */}
}

function deliveryKey(){
  const content=JSON.stringify({
    spec:C.project?.spec,master:C.project?.master||S.reference?.url,source:S.sourceData,
    recipe:recipe(),overrides:frameOverrides(),
  });
  let hash=2166136261;
  for(let i=0;i<content.length;i++)hash=Math.imul(hash^content.charCodeAt(i),16777619);
  return 'pixel-review-action-'+(C.project?.id||'clip')+'-'+(C.bound?.id||S.action)+'-'+(hash>>>0).toString(16);
}

function deliveryChecklist(){
  const key=deliveryKey();
  const container=$('atelierChecklist');
  let marks=[];
  try{marks=JSON.parse(localStorage.getItem(key)||'[]');}catch(e){}
  container.innerHTML=deliveryManualItems.map((item,i)=>
    '<label><input type="checkbox" '+(marks?.includes?.(i)?'checked':'')+'><span>'+item+'</span></label>'
  ).join('');
  function updateCount(){
    $('atelierReviewCount').textContent=container.querySelectorAll(':checked').length+' / '+deliveryManualItems.length;
  }
  container.onchange=()=>{
    updateCount();
    try{
      localStorage.setItem(key,JSON.stringify([...container.querySelectorAll('input')].flatMap((b,i)=>b.checked?[i]:[])));
    }catch(e){toast('检查状态无法保存到本机');}
  };
  updateCount();
}

function deliveryEvents(){
  const labels={strikes:'命中',releases:delivery.releaseLabel};
  const line=EVENT_TYPES.flatMap(type=>(S.events?.[type]||[]).map(i=>({
    index:i,label:labels[type],start:delivery.frames[i].start,
  }))).sort((a,b)=>a.index-b.index);
  const target=$('deliveryEvents');
  target.textContent=line.length?'已标记：':'在接触或释放那一帧添加标记，导出后可供游戏读取。';
  for(const event of line){
    const button=document.createElement('button');
    button.textContent=event.label+' · 第 '+(event.index+1)+' 帧 · '+event.start+' ms';
    button.onclick=()=>deliverySelect(event.index,true);
    target.append(button);
  }
  [...$('deliveryStrip').children].forEach((button,i)=>{
    button.classList.toggle('has-event',line.some(event=>event.index===i));
  });
}

function deliveryMark(){
  if(delivery.loading)return;
  deliveryStop();
  const values=S.events?.[delivery.eventType]||[];
  const index=delivery.index;
  const next=values.includes(index)?values.filter(i=>i!==index):[...values,index];
  S.events=readActionEvents({...S.events,[delivery.eventType]:next},S.frames.length);
  changed();
  deliveryDraw();
  deliveryEvents();
  deliveryChecklist();
  $('atelierRoleDownload').hidden=true;
  $('atelierDeliveryMessage').textContent='';
}

function deliveryScan(){
  const issues=[];
  const spec=window.characterProject?.spec();
  if(!delivery.validPivot)issues.push({text:'锚点须为画布内的整数',problem:true});
  if(spec&&C.bound?.epoch===S.sourceEpoch&&(spec.frameSize!==S.size||spec.pivot.some((v,i)=>v!==delivery.pivot[i]))){
    issues.push({text:'画布或锚点与冻结规格不一致，整套导出需先校准',problem:true});
  }
  let start=0;
  for(const [index,f] of S.frames.entries()){
    const image=frameCanvas(index);
    const extent=bounds(image,{x:0,y:0,w:S.size,h:S.size});
    const add=(text,problem=false)=>issues.push({index,text,problem});
    if(frameOverflow(f))add('主体超出原生画布',true);
    if(!extent)add('没有可见主体',true);
    else if(extent.some((v,i)=>i<2?v===0:v===S.size)){
      const data=image.getContext('2d').getImageData(0,0,S.size,S.size).data;
      let opaque=true;
      for(let i=3;i<data.length;i+=4)if(data[i]<220){opaque=false;break;}
      add(opaque?'整帧无透明背景':'主体贴原生画布边缘');
    }
    if(!f.overrideImage&&f.bounds?.some((v,i)=>i<2?v===0:v===(i===2?f.rect.w:f.rect.h)))add('源格贴边，复查是否裁掉人物、装备或特效');
    const validDuration=Number.isInteger(f.duration)&&f.duration>=10&&f.duration<=2000&&f.duration%10===0;
    if(!validDuration)add('帧时长须为 10–2000 ms，按 10 ms 递增',true);
    delivery.frames.push({image,extent,start,duration:validDuration?f.duration:100});
    start+=delivery.frames[index].duration;
  }
  return issues;
}

function deliveryFindings(issues){
  const target=$('deliveryFindings');
  target.replaceChildren();
  $('deliveryCheckSummary').textContent=issues.length?issues.length+' 项待处理或确认':'通过';
  $('deliveryCheckSummary').dataset.warning=String(issues.length>0);
  for(const issue of issues){
    const row=document.createElement('div');
    row.className='delivery-finding';
    const flag=document.createElement('span');
    flag.textContent=issue.problem?'需修正':'待复查';
    flag.dataset.problem=String(issue.problem);
    const label=document.createElement('span');
    label.textContent=issue.index===undefined?issue.text:'第 '+(issue.index+1)+' 帧 · '+issue.text;
    const edit=document.createElement('button');
    edit.textContent=issue.index===undefined?'去校准':'去编辑';
    edit.onclick=()=>deliveryEdit(issue.index??delivery.index,issue.index===undefined);
    row.append(flag,label,edit);
    target.append(row);
  }
}

function deliveryStrip(issues){
  const strip=$('deliveryStrip');
  const extents=delivery.frames.map(f=>f.extent).filter(Boolean);
  const left=Math.min(...extents.map(b=>b[0]));
  const top=Math.min(...extents.map(b=>b[1]));
  const width=Math.max(...extents.map(b=>b[2]))-left;
  const height=Math.max(...extents.map(b=>b[3]))-top;
  strip.replaceChildren();
  delivery.frames.forEach((f,index)=>{
    const b=document.createElement('button'),c=document.createElement('canvas'),label=document.createElement('span');
    c.width=64;c.height=54;
    if(extents.length){
      const ctx=c.getContext('2d'),scale=Math.min(60/width,48/height);
      ctx.imageSmoothingEnabled=false;
      ctx.drawImage(f.image,left,top,width,height,Math.round((64-width*scale)/2),Math.round((54-height*scale)/2),Math.round(width*scale),Math.round(height*scale));
    }
    const hasIssue=issues.some(issue=>issue.index===index);
    b.classList.toggle('has-issue',hasIssue);
    b.setAttribute('aria-label','第 '+(index+1)+' 帧，停留 '+f.duration+' 毫秒'+(hasIssue?'，待复查':''));
    label.textContent=String(index+1).padStart(2,'0')+' · '+f.duration+' ms';
    b.append(c,label);
    b.onclick=()=>deliverySelect(index);
    strip.append(b);
  });
}

async function deliveryOpenAction(id){
  if(delivery.loading||!id)return;
  deliveryStop();
  delivery.loading=true;
  $('deliveryReview').inert=true;
  $('deliveryChecks').inert=true;
  $('atelierExportOne').disabled=true;
  try{
    await openCharacterAction(id);
  }catch(e){toast(e.message);}
  finally{
    delivery.loading=false;
    $('deliveryReview').inert=false;
    $('deliveryChecks').inert=false;
    if(AT.tab==='delivery')atRenderDelivery();
  }
}

function atRenderDelivery(){
  if(delivery.loading)return;
  deliveryStop();
  S.playing=false;
  $('play').textContent='▶';
  const active=S.frames.length>0;
  const bound=C.bound?.epoch===S.sourceEpoch?C.bound.id:null;
  $('atelierDeliveryName').textContent=C.project?.name||S.label||'尚未打开作品';
  $('atelierDeliveryInfo').textContent=C.project?Object.keys(C.project.actions).length+' 个动作 · '+(C.project.spec.frozen?C.project.spec.palette.length+' 色冻结色板':'规格待冻结'):active?S.frames.length+' 帧 · '+S.size+' × '+S.size+' px':'先打开工程或导入动作图表。';
  $('atelierExportOne').disabled=!active;
  $('atelierExportRole').disabled=!C.project;
  $('atelierBackupRole').disabled=!C.project;
  $('atelierRoleDownload').hidden=true;
  $('atelierDeliveryMessage').textContent='';
  $('deliveryEmpty').hidden=active;
  $('deliveryReview').hidden=$('deliveryChecks').hidden=$('deliveryManual').hidden=!active;
  const actions=Object.entries(C.project?.actions||{});
  $('deliveryEmpty').textContent=actions.length?'先进入动作编辑，从当前工程选一个动作。':'先打开一个角色工程，或导入图表并建立时间轴。';
  if(!active)return;
  const picker=$('deliveryAction');
  picker.innerHTML=(bound?'':'<option value="">当前动作 · '+esc(S.label||actionName(S.action))+'</option>')+actions.map(([id,a])=>'<option value="'+esc(id)+'">'+esc(a.label||actionName(id))+'</option>').join('');
  picker.value=bound||'';
  picker.disabled=actions.length===0;
  picker.onchange=()=>deliveryOpenAction(picker.value);
  const profile=C.project?.spec.profile;
  delivery.eventType=profile==='bow'||profile==='staff'||mageProfile()?'releases':'strikes';
  delivery.releaseLabel=profile==='bow'?'箭离弦':profile==='staff'||mageProfile()?'法术释放':'释放';
  delivery.eventLabel=delivery.eventType==='strikes'?'命中':delivery.releaseLabel;
  $('deliveryEvent').hidden=!['light','heavy','dash'].includes(bound||S.action)
    &&!EVENT_TYPES.some(type=>S.events?.[type]?.length);
  delivery.pivot=[number('pivotX'),number('pivotY')];
  delivery.validPivot=delivery.pivot.every(v=>Number.isInteger(v)&&v>=0&&v<S.size);
  delivery.frames=[];
  const issues=deliveryScan();
  delivery.index=Math.min(S.index,S.frames.length-1);
  delivery.elapsed=0;
  const canvas=$('deliveryCanvas');
  canvas.width=canvas.height=S.size;
  const readSetting=(id,value,defaultValue)=>{
    $(id).value=[...$(id).options].some(o=>o.value===value)?value:defaultValue;
  };
  let settings;
  try{settings=JSON.parse(localStorage.getItem('pixel-review-view-'+(C.project?.id||'clip'))||'{}');}catch(e){}
  readSetting('deliveryScale',settings?.scale,'1');
  readSetting('deliveryBackground',settings?.background,'dark');
  $('deliveryPlay').disabled=$('deliveryPrev').disabled=$('deliveryNext').disabled=S.frames.length<2;
  $('deliveryPlay').onclick=deliveryPlay;
  $('deliveryPrev').onclick=()=>deliverySelect(delivery.index-1,true);
  $('deliveryNext').onclick=()=>deliverySelect(delivery.index+1,true);
  $('deliveryScale').onchange=$('deliveryBackground').onchange=deliverySettings;
  $('deliveryEdit').onclick=()=>deliveryEdit(delivery.index);
  $('deliveryEvent').onclick=deliveryMark;
  deliveryFindings(issues);
  deliveryStrip(issues);
  deliverySettings();
  deliveryEvents();
  deliveryChecklist();
}
