/* API settings dialog: custom image / LLM keys, models and connectivity test. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const dialog=$('apiSettingsDialog');
if(!dialog)return;
const KEEP='__KEEP__';

function status(message,ok){
  const el=$('apiSettingsStatus');
  el.textContent=message||'';
  el.classList.toggle('ok',!!ok);
  el.classList.toggle('err',!ok);
}

async function call(path,opts={}){
  const response=await fetch(path,{headers:{'Content-Type':'application/json'},...opts});
  let data={};
  try{data=await response.json();}catch(error){/* ignore */}
  if(!response.ok)throw new Error(data.error||('请求失败 '+response.status));
  return data;
}

function currentForm(){
  return {
    provider:$('providerSelect').value,
    image:{base_url:$('imgBaseUrl').value.trim(),model:$('imgModel').value.trim(),
      size:$('imgSize').value,response_format:$('imgFormat').value},
    llm:{base_url:$('llmBaseUrl').value.trim(),model:$('llmModel').value.trim(),
      polish_prompt:$('llmPolish').checked},
  };
}

async function load(){
  let cfg;
  try{cfg=await call('/config');}catch(error){status(error.message,false);throw error;}
  $('providerSelect').value=cfg.provider==='codex'?'codex':'custom';
  const image=cfg.image||{},llm=cfg.llm||{};
  $('imgBaseUrl').value=image.base_url||'';
  $('imgModel').value=image.model||'';
  $('imgSize').value=image.size||'1536x1024';
  $('imgFormat').value=image.response_format||'';
  $('imgKey').value='';
  $('imgKey').placeholder=image.has_key?`已保存（${image.api_key||'••••'}）· 留空保持不变`:'sk-...';
  $('llmBaseUrl').value=llm.base_url||'';
  $('llmModel').value=llm.model||'';
  $('llmPolish').checked=!!llm.polish_prompt;
  $('llmKey').value='';
  $('llmKey').placeholder=llm.has_key?`已保存（${llm.api_key||'••••'}）· 留空保持不变`:'sk-...';
  fillModels('imgModelList',[]);
  fillModels('llmModelList',[]);
  status('');
}

function fillModels(listId,models){
  const list=$(listId);
  list.innerHTML='';
  (models||[]).slice(0,200).forEach(name=>{
    const option=document.createElement('option');
    option.value=name;
    list.appendChild(option);
  });
}

async function probe(kind,listId,button){
  button.disabled=true;
  try{
    const form=currentForm();
    const body={target:kind,base_url:kind==='image'?form.image.base_url:form.llm.base_url};
    const typed=(kind==='image'?$('imgKey'):$('llmKey')).value.trim();
    if(typed)body.api_key=typed;
    const saved=await call('/config');
    if(!typed&&!(saved[kind]||{}).has_key)throw new Error('请先填写 API Key');
    const result=await call('/config/test',{method:'POST',body:JSON.stringify(body)});
    fillModels(listId,result.models);
    return result;
  }finally{button.disabled=false;}
}

async function fetchModels(kind,listId,button){
  try{
    const result=await probe(kind,listId,button);
    status(`${kind==='image'?'生图':'文本'}模型列表已更新，共 ${result.models.length} 个。`,true);
  }catch(error){status(error.message,false);}
}

async function test(kind,button){
  try{
    const result=await probe(kind,kind==='image'?'imgModelList':'llmModelList',button);
    status(result.message,true);
  }catch(error){status(error.message,false);}
}

async function save(event){
  event.preventDefault();
  const form=currentForm();
  const imageKey=$('imgKey').value.trim(),llmKey=$('llmKey').value.trim();
  const payload={provider:form.provider,
    image:{...form.image,api_key:imageKey||KEEP},
    llm:{...form.llm,api_key:llmKey||KEEP}};
  try{
    await call('/config',{method:'POST',body:JSON.stringify(payload)});
    status('设置已保存。',true);
    dialog.close();
    window.dispatchEvent(new CustomEvent('api-settings-saved'));
  }catch(error){status(error.message,false);}
}

$('apiSettingsButton').onclick=()=>{load().then(()=>dialog.showModal()).catch(()=>{});};
$('apiSettingsForm').onsubmit=save;
$('apiSettingsCancel').onclick=()=>dialog.close();
const close=dialog.querySelector('[data-close]');
if(close)close.onclick=()=>dialog.close();
$('imgFetchModels').onclick=event=>fetchModels('image','imgModelList',event.currentTarget);
$('llmFetchModels').onclick=event=>fetchModels('llm','llmModelList',event.currentTarget);
$('imgTest').onclick=event=>test('image',event.currentTarget);
$('llmTest').onclick=event=>test('llm',event.currentTarget);
})();
