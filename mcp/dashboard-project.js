// Project editing adapter for the existing dashboard. Polled documents are read
// models; local objects are short-lived gesture drafts, never a second song store.
(function(){
  var group=null,groupBase=null;
  function project(){ return Abx.state().project; }
  function track(slot){ var p=project(); return p&&p.tracks.find(function(t){return 'd'+t.slot===slot;}); }
  function clip(t){ var p=project(); return p&&t&&p.clips.find(function(c){return c.id===t.activeClipId;}); }
  function edit(edits,label,groupId,base){ if(!edits.length)return Promise.resolve({ok:true}); base=base||groupBase||project();return Abx.send({cmd:'project.edit',edits:edits,label:label,groupId:groupId||group||undefined,projectId:base.id,revision:base.revision}); }
  function setParam(slot,param,value){ var t=track(slot),c=clip(t); if(!t)return;
    if(param==='gain'||param==='pan') return edit([{type:'mixer.set',trackId:t.id,values:param==='gain'?{level:value}:{balance:value*2-1}}],'Channel '+param);
    if(!c||c.kind!=='steps'){ Abx.report({ok:false,error:'Effect editing requires a visual clip. Edit arbitrary Tidal in the console.'}); return; }
    return edit([{type:'parameter.set',clipId:c.id,parameter:param,value:value}],'Change '+param);
  }
  function value(slot,param,def){ var t=track(slot),c=clip(t); if(!t)return def;
    if(param==='gain')return t.mixer.level; if(param==='pan')return (t.mixer.balance+1)/2;
    return c&&c.kind==='steps'&&c.parameters[param]!=null?c.parameters[param]:def;
  }
  function scene(){ var p=project(),selected=Abx.state().workspace&&Abx.state().workspace.selectedSceneId; return p&&(p.scenes.find(function(s){return s.id===selected;})||p.scenes.find(function(s){return s.id===p.sceneOrder[0];})); }
  function asset(name){ var p=project(),parts=name.split(':'),sound=parts[0];
    if(!/^[a-zA-Z0-9_-]+$/.test(sound)||parts.length>2||parts[1]&&!/^\d+$/.test(parts[1]))throw new Error('Use a sample or synth name, optionally :index');
    var index=+(parts[1]||0),found=p.assets.find(function(a){return a.name===sound&&a.index===index;});
    return found||{id:crypto.randomUUID(),name:sound,reference:sound,index:index,kind:/^(super|default$)/.test(sound)?'synth':'sample'};
  }
  function newTrack(name){ var p=project(),s=scene(),slot=1,channel=0;
    while(p.tracks.some(function(t){return t.slot===slot;}))slot++;
    channel=slot-1;
    if(slot>12){Abx.report({ok:false,error:'No free managed channel (12 maximum)'});return Promise.resolve({ok:false});}
    var tid=crypto.randomUUID(),cid=crypto.randomUUID(),a=asset(name||'perc');
    var t={id:tid,name:name||'perc',slot:slot,channel:channel,activeClipId:cid,mixer:{level:1,balance:0,mute:false,solo:false}};
    var c={id:cid,trackId:tid,name:s.name,kind:'steps',assetId:a.id,steps:Array(16).fill(0),swing:0,parameters:{}};
    var refs=Object.assign({},s.clips); refs[tid]=cid;
    return edit([{type:'asset.put',asset:a},{type:'track.add',track:t},{type:'clip.put',clip:c},{type:'scene.put',scene:{id:s.id,name:s.name,clips:refs}}],'Add track');
  }
  function loadFiles(){ return fetch('/projects').then(function(r){return r.json();}).then(function(files){ var sel=document.getElementById('projectSelect'); if(!sel)return; var v=sel.value; sel.innerHTML='<option value="">— saved projects —</option>'+files.map(function(f){return '<option value="'+Abx.esc(f)+'">'+Abx.esc(f)+'</option>';}).join(''); sel.value=v; }); }
  function render(){ var st=Abx.state(),p=st.project;if(!p)return;
    var u=document.getElementById('undoBtn'),r=document.getElementById('redoBtn'); if(u)u.disabled=!st.history||!st.history.undo; if(r)r.disabled=!st.history||!st.history.redo;
    var label=document.getElementById('projectState'); if(label)label.textContent=p.name+' · r'+p.revision+(st.workspace&&st.workspace.recovered?' · recovered, stopped':'');
    var missing=(st.assets||[]).filter(function(a){return a.status==='missing';}),el=document.getElementById('missingAssets'); if(el)el.textContent=(missing.length?'Missing assets: '+missing.map(function(a){return a.reference;}).join(', '):'')+(st.workspace&&st.workspace.recoveryWarning?' '+st.workspace.recoveryWarning:'');
  }
  document.addEventListener('pointerdown',function(e){ if(e.target.type==='range'){group=crypto.randomUUID();var p=project();groupBase=p&&{id:p.id,revision:p.revision};} });
  function end(){ if(window.flushControls)window.flushControls(); group=null;groupBase=null; }
  document.addEventListener('pointerup',end); document.addEventListener('pointercancel',end);
  document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('button');if(!b)return;var action=b.dataset.project;
    if(!action)return;
    if(window.AbxSeq)AbxSeq.beforeStop();if(window.AbxCurves)AbxCurves.beforeStop();if(window.flushControls)window.flushControls();
    var c={cmd:'project.'+action}; if(action==='save')c.value=document.getElementById('projectName').value.trim();if(action==='load')c.value=document.getElementById('projectSelect').value;
    Abx.send(c).then(function(j){if(j.ok){loadFiles();Abx.poll();}});
  });
  document.addEventListener('keydown',function(e){ if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!/input|textarea/i.test(e.target.tagName)){e.preventDefault();if(window.AbxSeq)AbxSeq.beforeStop();if(window.AbxCurves)AbxCurves.beforeStop();end();Abx.send({cmd:e.shiftKey?'project.redo':'project.undo'});} });
  window.AbxProject={project:project,track:track,clip:clip,edit:edit,setParam:setParam,value:value,scene:scene,asset:asset,newTrack:newTrack,render:render,group:function(){return group;}};
  loadFiles().catch(function(){});
})();
