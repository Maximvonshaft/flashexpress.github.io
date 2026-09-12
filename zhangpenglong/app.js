(() => {
  'use strict';
  const DATA = Array.isArray(window.CSP_VERIFIED_100) ? window.CSP_VERIFIED_100 : [];
  const AREAS = {
    M:{name:'Manchester',color:'#e64052',center:[53.4808,-2.2426]},
    L:{name:'Liverpool',color:'#8c5bd6',center:[53.4084,-2.9916]},
    CH:{name:'Chester',color:'#2aa878',center:[53.1934,-2.8931]},
    HX:{name:'Halifax',color:'#d5a72b',center:[53.7210,-1.8575]},
    BD:{name:'Bradford',color:'#e28a3a',center:[53.7950,-1.7594]},
    SK:{name:'Stockport',color:'#3c8fe3',center:[53.4106,-2.1575]}
  };
  const STATUSES = ['Not contacted','Contacted','Interested','In progress','Not interested'];
  function readLocal(key){try{const value=JSON.parse(localStorage.getItem(key)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}}
  const state = {
    areas:new Set(Object.keys(AREAS)), priorities:new Set(['A','B']), statuses:new Set(STATUSES), type:'', q:'', sort:'priority', selected:null,
    edits: readLocal('jt-csp-edits-v1'), coords: readLocal('jt-csp-coords-v2')
  };
  let map=null, cluster=null, markers=new Map(), leafletReady=false;
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const norm=s=>String(s??'').toLowerCase().replace(/\s+/g,' ').trim();
  const countsBy=(arr,k)=>arr.reduce((m,x)=>(m[x[k]]=(m[x[k]]||0)+1,m),{});
  const areaCounts=countsBy(DATA,'area');

  function editedCompany(c){
    const e=state.edits[c.id]||{}; return {...c,outreachStatus:e.status||c.outreachStatus||'Not contacted',owner:e.owner??c.owner,notes:e.notes??c.notes};
  }
  function statusClass(s){return {'Contacted':'status-contacted','Interested':'status-interested','In progress':'status-progress','Not interested':'status-not-interested'}[s]||''}
  function initials(name){return name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase()}
  function fallbackCoord(c){return [...AREAS[c.area].center]}
  function validLocation(loc){return loc&&Array.isArray(loc.coord)&&loc.coord.length===2&&loc.coord.every(Number.isFinite)&&['postcode','outcode','area'].includes(loc.precision);}
  Object.keys(state.coords).forEach(id=>{if(!validLocation(state.coords[id]))delete state.coords[id]});
  function companyCoord(c){return state.coords[c.id]?.coord || fallbackCoord(c)}
  function notify(message){$('#saveNotice').textContent=message;}
  function download(filename,content,type){const u=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=u;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
  function backup(){download('csp-pipeline-backup-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({version:1,exportedAt:new Date().toISOString(),edits:state.edits},null,2),'application/json');notify('Pipeline backup downloaded. Keep it safe; it contains your notes.');}
  async function restore(file){
    if(!file)return;
    try{
      if(file.size>2000000)throw new Error('Backup is too large.');
      const data=JSON.parse(await file.text());
      if(data.version!==1||!data.edits||typeof data.edits!=='object'||Array.isArray(data.edits))throw new Error('Choose a CSP pipeline JSON backup.');
      const merged={...state.edits};let count=0;
      for(const [id,e] of Object.entries(data.edits)){
        if(!DATA.some(c=>String(c.id)===id)||!e||!STATUSES.includes(e.status)||typeof e.owner!=='string'||typeof e.notes!=='string'||e.owner.length>200||e.notes.length>20000)throw new Error('Backup contains an invalid company update.');
        merged[id]={status:e.status,owner:e.owner,notes:e.notes};count++;
      }
      if(!window.confirm('Restore '+count+' company updates? Matching local updates will be replaced. Export a backup first if needed.'))return;
      localStorage.setItem('jt-csp-edits-v1',JSON.stringify(merged));state.edits=merged;buildStatusFiltersOnly();render();notify(count+' company updates restored in this browser.');
    }catch(error){notify('Restore failed: '+error.message);}
    finally{$('#restoreInput').value='';}
  }

  function buildFilters(){
    $('#areaFilters').innerHTML=Object.entries(AREAS).map(([a,v])=>`<label class="check-row"><input type="checkbox" name="area" value="${a}" checked><span class="dot" style="background:${v.color}"></span><span>${a} · ${v.name}</span><strong>${areaCounts[a]||0}</strong></label>`).join('');
    const statusCounts=countsBy(DATA.map(editedCompany),'outreachStatus');
    $('#statusFilters').innerHTML=STATUSES.map(s=>`<label class="check-row"><input type="checkbox" name="status" value="${esc(s)}" checked><span class="status-dot ${statusClass(s)}"></span><span>${esc(s)}</span><strong>${statusCounts[s]||0}</strong></label>`).join('');
    const types=[...new Set(DATA.map(x=>x.candidateType).filter(Boolean))].sort();
    $('#typeFilter').innerHTML='<option value="">All capabilities</option>'+types.map(t=>`<option>${esc(t)}</option>`).join('');
    $('#mapLegend').innerHTML=Object.entries(AREAS).map(([a,v])=>`<span class="legend-item"><i style="background:${v.color}"></i><b>${a}</b> ${areaCounts[a]||0}</span>`).join('');
  }

  function getFiltered(){
    const q=norm(state.q);
    let arr=DATA.map(editedCompany).filter(c=>state.areas.has(c.area)&&state.priorities.has(c.priority)&&state.statuses.has(c.outreachStatus)&&(!state.type||c.candidateType===state.type));
    if(q) arr=arr.filter(c=>norm([c.company,c.base,c.postcode,c.outcode,c.phone,c.email,c.candidateType,c.capability,c.area].join(' ')).includes(q)||[c.postcode,c.outcode].some(p=>p&&norm(p).replace(/ /g,'').includes(q.replace(/ /g,''))));
    const statusRank=Object.fromEntries(STATUSES.map((s,i)=>[s,i]));
    arr.sort((a,b)=>{
      if(state.sort==='company')return a.company.localeCompare(b.company);
      if(state.sort==='area')return a.area.localeCompare(b.area)||a.company.localeCompare(b.company);
      if(state.sort==='status')return (statusRank[a.outreachStatus]??9)-(statusRank[b.outreachStatus]??9)||a.company.localeCompare(b.company);
      return a.priority.localeCompare(b.priority)||a.area.localeCompare(b.area)||a.company.localeCompare(b.company);
    });
    return arr;
  }

  function render(){
    const arr=getFiltered();
    $('#visibleCount').textContent=arr.length; $('#mobileCount').textContent=arr.length; $('#resultCount').textContent=arr.length;
    $('#companyList').innerHTML=arr.length?arr.map(c=>{
      const color=AREAS[c.area].color;return `<article role="button" tabindex="0" aria-label="Open ${esc(c.company)}" class="company-card ${state.selected===c.id?'active':''}" data-id="${c.id}">
        <div class="company-avatar" style="background:${color}">${esc(initials(c.company))}</div>
        <div class="company-main"><div class="company-name">${esc(c.company)}</div><div class="company-meta"><b>${c.area}</b><span>${esc(c.base)}</span></div><div class="company-contact">${esc(c.email)}</div></div>
        <div class="company-badges"><span class="badge ${c.priority==='A'?'badge-a':'badge-b'}">${c.priority}</span><span class="badge badge-status">${esc(c.outreachStatus)}</span></div>
      </article>`}).join(''):'<div class="empty">No companies match these filters.</div>';
    $$('.company-card').forEach(el=>{el.addEventListener('click',()=>selectCompany(+el.dataset.id,true));el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectCompany(+el.dataset.id,true)}})});
    refreshMarkers(arr);
  }

  function initMap(){
    if(!window.L||typeof L.markerClusterGroup!=='function'){$('#map').hidden=true;$('#mapFallback').hidden=false;$('#geocodeState').textContent='Interactive map library unavailable';return;}
    map=L.map('map',{zoomControl:true,preferCanvas:true}).setView([53.48,-2.25],8);
    const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'}).addTo(map);
    tiles.on('tileerror',()=>notify('Some map tiles could not load. Company contacts and filters remain available.'));
    cluster=L.markerClusterGroup({showCoverageOnHover:false,maxClusterRadius:48,spiderfyOnMaxZoom:true}); map.addLayer(cluster);leafletReady=true;
    refreshMarkers(getFiltered());
    setTimeout(()=>map.invalidateSize(),50);
    geocodeAll();
  }

  function markerIcon(c){const color=AREAS[c.area].color;return L.divIcon({className:'',html:`<div class="csp-marker" style="background:${color}"><span>${c.priority}</span></div>`,iconSize:[24,24],iconAnchor:[12,24],popupAnchor:[0,-22]})}
  function ensureMarker(c){
    if(!leafletReady)return null;
    let m=markers.get(c.id);const coord=companyCoord(c);
    if(!m){m=L.marker(coord,{icon:markerIcon(c),title:c.company,alt:c.company});m.on('click',()=>selectCompany(c.id,false));m.bindPopup(`<div class="pop-name">${esc(c.company)}</div><div class="pop-meta"><b>${c.area}</b> · ${esc(c.base)}<br>${esc(c.candidateType)}</div><button class="pop-link" onclick="window.__openCsp(${c.id})">View details →</button>`);markers.set(c.id,m)}else m.setLatLng(coord);
    return m;
  }
  function refreshMarkers(arr){
    if(!leafletReady)return; cluster.clearLayers();arr.forEach(c=>cluster.addLayer(ensureMarker(c)));
  }
  function fitVisible(){if(!leafletReady)return;const arr=getFiltered(),latlngs=arr.map(companyCoord);if(latlngs.length)map.fitBounds(L.latLngBounds(latlngs).pad(.16),{maxZoom:11})}

  async function geocodeOne(c){
    if(state.coords[c.id]&&state.coords[c.id].precision!=='area')return;
    let url='';
    if(c.postcode) url='https://api.postcodes.io/postcodes/'+encodeURIComponent(c.postcode.replace(/\s/g,''));
    else if(c.outcode) url='https://api.postcodes.io/outcodes/'+encodeURIComponent(c.outcode);
    if(!url){state.coords[c.id]={coord:fallbackCoord(c),precision:'area'};return;}
    try{
      const r=await fetch(url,{signal:AbortSignal.timeout(8000)}); if(!r.ok)throw new Error('geocode'); const j=await r.json(); const x=j.result; if(!x||!Number.isFinite(x.latitude)||!Number.isFinite(x.longitude))throw new Error('no result');
      state.coords[c.id]={coord:[x.latitude,x.longitude],precision:c.postcode?'postcode':'outcode'};
    }catch(e){state.coords[c.id]={coord:fallbackCoord(c),precision:'area'};}
    try{localStorage.setItem('jt-csp-coords-v2',JSON.stringify(state.coords));}catch{} const m=markers.get(c.id);if(m)m.setLatLng(companyCoord(c));
  }
  async function geocodeAll(){
    const pending=DATA.filter(c=>(c.postcode||c.outcode)&&(!state.coords[c.id]||state.coords[c.id].precision==='area'));let done=DATA.length-pending.length;
    $('#geocodeState').textContent=pending.length?`Locating companies ${done}/${DATA.length}`:'Locations ready';
    const queue=[...pending]; const workers=Array.from({length:5},async()=>{while(queue.length){const c=queue.shift();await geocodeOne(c);done++;$('#geocodeState').textContent=`Locating companies ${done}/${DATA.length}`;await new Promise(r=>setTimeout(r,50));}});
    await Promise.all(workers);const precise=DATA.filter(c=>state.coords[c.id]&&state.coords[c.id].precision!=='area').length;$('#geocodeState').textContent=precise+' postal locations · '+(DATA.length-precise)+' approximate area centres';refreshMarkers(getFiltered());setTimeout(()=>$('#geocodeState').style.opacity='.78',1000);
  }

  function selectCompany(id,pan=false){
    const raw=DATA.find(x=>x.id===id);if(!raw)return;const c=editedCompany(raw);state.selected=id;render();openDetail(c);if(pan&&leafletReady){mobileView('map');const marker=ensureMarker(c);map.setView(companyCoord(c),Math.max(map.getZoom(),11));cluster.zoomToShowLayer(marker,()=>marker.openPopup());}
  }
  window.__openCsp=id=>selectCompany(id,false);

  function openDetail(c){
    const loc=state.coords[c.id]||{precision:'area'}; const precision=loc.precision||'area';
    $('#detailContent').innerHTML=`
      <div class="detail-title"><h1>${esc(c.company)}</h1><div class="sub"><span class="badge badge-area" style="background:${AREAS[c.area].color}">${c.area} · ${AREAS[c.area].name}</span><span class="badge ${c.priority==='A'?'badge-a':'badge-b'}">${c.priority} priority</span><span class="badge badge-status">Verified contact · Potential CSP</span></div></div>
      <div class="action-row"><a class="primary" href="mailto:${esc(c.email)}">Email</a><a href="tel:${esc(c.phone.replace(/[^+\d]/g,''))}">Call</a><a href="${esc(c.website)}" target="_blank" rel="noopener">Website ↗</a></div>
      <div class="capability-box"><b>Why it may fit CSP</b>${esc(c.capability)}</div>
      <dl class="detail-grid">
        <div class="detail-row"><dt>Base / coverage</dt><dd>${esc(c.base)}</dd></div>
        <div class="detail-row"><dt>Phone</dt><dd><a href="tel:${esc(c.phone.replace(/[^+\d]/g,''))}">${esc(c.phone)}</a></dd></div>
        <div class="detail-row"><dt>Email</dt><dd><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></dd></div>
        <div class="detail-row"><dt>Candidate type</dt><dd>${esc(c.candidateType)}</dd></div>
        <div class="detail-row"><dt>Evidence</dt><dd><a href="${esc(c.source)}" target="_blank" rel="noopener">Official source ↗</a><br><small>${esc(c.sourceType)}</small></dd></div>
        <div class="detail-row"><dt>Map precision</dt><dd>${precision==='postcode'?'Full postcode centroid — not a building entrance':precision==='outcode'?'Outcode centroid — approximate':'Approximate area centre — not a business address'}</dd></div>
      </dl>
      <div class="pipeline-box"><label for="detailStatus">Recruitment status</label><select id="detailStatus">${STATUSES.map(s=>`<option ${s===c.outreachStatus?'selected':''}>${esc(s)}</option>`).join('')}</select><label for="detailOwner" style="margin-top:10px">Owner</label><input id="detailOwner" maxlength="200" value="${esc(c.owner||'')}" placeholder="e.g. Maxim"><label for="detailNotes" style="margin-top:10px">Working notes</label><textarea id="detailNotes" maxlength="20000" placeholder="Call result, capacity, depot, exclusivity, next action…">${esc(c.notes||'')}</textarea><div class="pipeline-actions"><small id="pipelineFeedback" role="status">Local to this browser · use Backup to transfer</small><button id="savePipeline">Save update</button></div></div>`;
    $('#detailPanel').hidden=false;$('#detailBackdrop').hidden=false;
    $('#detailClose').focus();
    $('#savePipeline').onclick=()=>{
      const update={status:$('#detailStatus').value,owner:$('#detailOwner').value.trim(),notes:$('#detailNotes').value.trim()};
      try{const edits={...state.edits,[c.id]:update};localStorage.setItem('jt-csp-edits-v1',JSON.stringify(edits));state.edits=edits;buildStatusFiltersOnly();render();$('#pipelineFeedback').textContent='Saved in this browser at '+new Date().toLocaleTimeString();}
      catch{$('#pipelineFeedback').textContent='Save failed. Your input is still here. Allow browser storage and retry.';}
    };

  }
  function closeDetail(){const id=state.selected;state.selected=null;$('#detailPanel').hidden=true;$('#detailBackdrop').hidden=true;render();const card=$$('.company-card').find(el=>+el.dataset.id===id);if(card)card.focus()}
  function buildStatusFiltersOnly(){
    const current=new Set(state.statuses);const statusCounts=countsBy(DATA.map(editedCompany),'outreachStatus');$('#statusFilters').innerHTML=STATUSES.map(s=>`<label class="check-row"><input type="checkbox" name="status" value="${esc(s)}" ${current.has(s)?'checked':''}><span class="status-dot ${statusClass(s)}"></span><span>${esc(s)}</span><strong>${statusCounts[s]||0}</strong></label>`).join('');bindFilterInputs();
  }

  function bindFilterInputs(){
    $$('input[name="area"]').forEach(x=>x.onchange=()=>{x.checked?state.areas.add(x.value):state.areas.delete(x.value);render()});
    $$('input[name="priority"]').forEach(x=>x.onchange=()=>{x.checked?state.priorities.add(x.value):state.priorities.delete(x.value);render()});
    $$('input[name="status"]').forEach(x=>x.onchange=()=>{x.checked?state.statuses.add(x.value):state.statuses.delete(x.value);render()});
  }
  function reset(){state.areas=new Set(Object.keys(AREAS));state.priorities=new Set(['A','B']);state.statuses=new Set(STATUSES);state.type='';state.q='';state.sort='priority';$('#searchInput').value='';$('#typeFilter').value='';$('#sortSelect').value='priority';buildFilters();bindFilterInputs();render();setTimeout(fitVisible,50)}
  function exportCSV(){
    const arr=getFiltered();const cols=['id','area','company','base','phone','email','website','candidateType','priority','outreachStatus','owner','notes','source'];const q=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,m=>"'"+m).replace(/"/g,'""')+'"';const csv='\ufeff'+[cols.join(','),...arr.map(r=>cols.map(k=>q(r[k])).join(','))].join('\n');const b=new Blob([csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`jt-csp-filtered-${arr.length}.csv`;a.click();URL.revokeObjectURL(a.href)
  }
  function mobileView(v){$$('.mobile-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.view===v));$$('.filters,.results,.map-shell').forEach(x=>x.classList.remove('mobile-active'));const el=v==='filters'?$('.filters'):v==='results'?$('.results'):$('.map-shell');el.classList.add('mobile-active');if(v==='map'&&leafletReady)setTimeout(()=>map.invalidateSize(),30)}

  $('#searchInput').addEventListener('input',e=>{state.q=e.target.value;render()});
  $('#typeFilter').addEventListener('change',e=>{state.type=e.target.value;render()});
  $('#sortSelect').addEventListener('change',e=>{state.sort=e.target.value;render()});
  $('#resetBtn').onclick=reset;$('#exportBtn').onclick=exportCSV;$('#fitBtn').onclick=fitVisible;$('#locateAreasBtn').onclick=()=>{if(leafletReady)map.fitBounds([[52.9,-3.65],[54.15,-1.45]])};$('#detailClose').onclick=closeDetail;$('#detailBackdrop').onclick=closeDetail;
  $$('.mobile-tabs button').forEach(b=>b.onclick=()=>mobileView(b.dataset.view));
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#detailPanel').hidden)closeDetail();if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();$('#searchInput').focus()}});

  $('#backupBtn').onclick=backup;$('#restoreBtn').onclick=()=>$('#restoreInput').click();$('#restoreInput').onchange=e=>restore(e.target.files[0]);
  const pCounts=countsBy(DATA,'priority');$('#kpiVerified').textContent=DATA.length;$('#kpiA').textContent=(pCounts.A||0)+' A';$('#kpiB').textContent='Priority leads · '+(pCounts.B||0)+' B';$('#countA').textContent=pCounts.A||0;$('#countB').textContent=pCounts.B||0;
  $('#detailPanel').addEventListener('keydown',e=>{if(e.key!=='Tab')return;const items=[...$('#detailPanel').querySelectorAll('button,a[href],input,select,textarea')];const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}});
  window.addEventListener('storage',e=>{if(e.key==='jt-csp-edits-v1'){state.edits=readLocal('jt-csp-edits-v1');buildStatusFiltersOnly();render();notify('Updates loaded from another tab. Reopen details to see the latest saved values.')}});
  buildFilters();bindFilterInputs();render();mobileView('map');initMap();setTimeout(fitVisible,400);
  if(DATA.length!==100)notify('Dataset loading error: expected 100 companies, loaded '+DATA.length+'. Please reload.');
})();