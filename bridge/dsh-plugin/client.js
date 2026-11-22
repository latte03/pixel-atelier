window.__ModuleLoader__.load({id:'dsh-pixel-atelier',factory:(require)=>{
const React=require('react');
const inject=['slots'];
function apply(ctx){
  const id='pixel-atelier';
  function Workbench(){const host=window.location.hostname==='localhost'?'localhost':'127.0.0.1';return React.createElement('iframe',{title:'像素角色工作台',src:'http://'+host+':8898/',style:{display:'block',width:'100%',height:'100%',minHeight:'650px',border:0,background:'#f6f7f9'}});}
  ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:id},Workbench));
  ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id,order:450,label:'像素角色工作台'},()=>React.createElement('span',{style:{fontSize:18},'aria-hidden':true},'▦')));
}

return {inject,apply};
}});
