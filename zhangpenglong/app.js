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
  const state = {
    areas:new Set(Object.keys(AREAS)), priorities:new Set(['A','B']), statuses:new Set(STATUSES), type:'', q:'', sort:'priority', selected:null,
    edits: JSON.parse(localStorage.getItem('jt-csp-edits-v1') || '{}'), coords: JSON.parse(localStorage.getItem('jt-csp-coords-v1') || '{}')
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
  function jitter(c){
    const seed=(c.id*9301+49297)%233280, seed2=(c.id*233+991)%104729;
    return [(seed/233280-.5)*.22,(seed2/104729-.5)*.28];
  }
  function fallbackCoord(c){const [j1,j2]=jitter(c),base=AREAS[c.area].center;return [base[0]+j1,base[1]+j2]}
  function companyCoord(c){return state.coords[c.id]?.coord || fallbackCoord(c)}

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
    if(q) arr=arr.filter(c=>norm([c.company,c.base,c.postcode,c.outcode,c.phone,c.email,c.candidateType,c.capability,c.area].join(' ')).includes(q));
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
      const color=AREAS[c.area].color;return `<article class="company-card ${state.selected===c.id?'active':''}" data-id="${c.id}">
        <div class="company-avatar" style="background:${color}">${esc(initials(c.company))}</div>
        <div class="company-main"><div class="company-name">${esc(c.company)}</div><div class="company-meta"><b>${c.area}</b><span>${esc(c.base)}</span></div><div class="company-contact">${esc(c.email)}</div></div>
        <div class="company-badges"><span class="badge ${c.priority==='A'?'badge-a':'badge-b'}">${c.priority}</span><span class="badge badge-status">${esc(c.outreachStatus)}</span></div>
      </article>`}).join(''):'<div class="empty">No companies match these filters.</div>';
    $$('.company-card').forEach(el=>el.addEventListener('click',()=>selectCompany(+el.dataset.id,true)));
    refreshMarkers(arr);
  }

  function initMap(){
    if(!window.L){$('#map').hidden=true;$('#mapFallback').hidden=false;$('#geocodeState').textContent='Interactive map library unavailable';return;}
    leafletReady=true;
    map=L.map('map',{zoomControl:true,preferCanvas:true}).setView([53.48,-2.25],8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
    cluster=L.markerClusterGroup({showCoverageOnHover:false,maxClusterRadius:48,spiderfyOnMaxZoom:true,disableClusteringAtZoom:13}); map.addLayer(cluster);
    refreshMarkers(getFiltered());
    setTimeout(()=>map.invalidateSize(),50);
    geocodeAll();
  }

  function markerIcon(c){const color=AREAS[c.area].color;return L.divIcon({className:'',html:`<div class="csp-marker" style="background:${color}"><span>${c.priority}</span></div>`,iconSize:[24,24],iconAnchor:[12,24],popupAnchor:[0,-22]})}
  function ensureMarker(c){
    if(!leafletReady)return null;
    let m=markers.get(c.id);const coord=companyCoord(c);
    if(!m){m=L.marker(coord,{icon:markerIcon(c),title:c.company});m.bindPopup(`<div class="pop-name">${esc(c.company)}</div><div class="pop-meta"><b>${c.area}</b> · ${esc(c.base)}<br>${esc(c.candidateType)}</div><button class="pop-link" onclick="window.__openCsp(${c.id})">View details →</button>`);markers.set(c.id,m)}else m.setLatLng(coord);
    return m;
  }
  function refreshMarkers(arr){
    if(!leafletReady)return; cluster.clearLayers();arr.forEach(c=>cluster.addLayer(ensureMarker(c)));
  }
  function fitVisible(){if(!leafletReady)return;const arr=getFiltered(),latlngs=arr.map(companyCoord);if(latlngs.length)map.fitBounds(L.latLngBounds(latlngs).pad(.16),{maxZoom:11})}

  async function geocodeOne(c){
    if(state.coords[c.id])return;
    let url='';
    if(c.postcode) url='https://api.postcodes.io/postcodes/'+encodeURIComponent(c.postcode.replace(/\s/g,''));
    else if(c.outcode) url='https://api.postcodes.io/outcodes/'+encodeURIComponent(c.outcode);
    if(!url){state.coords[c.id]={coord:fallbackCoord(c),precision:'area'};return;}
    try{
      const r=await fetch(url); if(!r.ok)throw new Error('geocode'); const j=await r.json(); const x=j.result; if(!x)throw new Error('no result');
      state.coords[c.id]={coord:[x.latitude,x.longitude],precision:c.postcode?'postcode':'outcode'};
    }catch(e){state.coords[c.id]={coord:fallbackCoord(c),precision:'area'};}
    localStorage.setItem('jt-csp-coords-v1',JSON.stringify(state.coords)); const m=markers.get(c.id);if(m)m.setLatLng(companyCoord(c));
  }
  async function geocodeAll(){
    const pending=DATA.filter(c=>!state.coords[c.id]);let done=DATA.length-pending.length;
    $('#geocodeState').textContent=pending.length?`Locating companies ${done}/${DATA.length}`:'Locations ready';
    const queue=[...pending]; const workers=Array.from({length:5},async()=>{while(queue.length){const c=queue.shift();await geocodeOne(c);done++;$('#geocodeState').textContent=`Locating companies ${done}/${DATA.length}`;await new Promise(r=>setTimeout(r,50));}});
    await Promise.all(workers);$('#geocodeState').textContent='Locations ready · postcode pins + approximate fallbacks';refreshMarkers(getFiltered());setTimeout(()=>$('#geocodeState').style.opacity='.78',1000);
  }

  function selectCompany(id,pan=false){
    const raw=DATA.find(x=>x.id===id);if(!raw)return;const c=editedCompany(raw);state.selected=id;render();openDetail(c);if(pan&&leafletReady){map.setView(companyCoord(c),Math.max(map.getZoom(),11));ensureMarker(c)?.openPopup()}
  }
  window.__openCsp=id=>selectCompany(id,false);

  function openDetail(c){
    const loc=state.coords[c.id]||{precision:c.locationPrecision}; const precision=loc.precision||'area';
    $('#detailContent').innerHTML=`
      <div class="detail-title"><h1>${esc(c.company)}</h1><div class="sub"><span class="badge badge-area" style="background:${AREAS[c.area].color}">${c.area} · ${AREAS[c.area].name}</span><span class="badge ${c.priority==='A'?'badge-a':'badge-b'}">${c.priority} priority</span><span class="badge badge-status">Verified contact</span></div></div>
      <div class="action-row"><a class="primary" href="mailto:${esc(c.email)}">Email</a><a href="tel:${esc(c.phone.replace(/[^+\d]/g,''))}">Call</a><a href="${esc(c.website)}" target="_blank" rel="noopener">Website ↗</a></div>
      <div class="capability-box"><b>Why it may fit CSP</b>${esc(c.capability)}</div>
      <dl class="detail-grid">
        <div class="detail-row"><dt>Base / coverage</dt><dd>${esc(c.base)}</dd></div>
        <div class="detail-row"><dt>Phone</dt><dd><a href="tel:${esc(c.phone.replace(/[^+\d]/g,''))}">${esc(c.phone)}</a></dd></div>
        <div class="detail-row"><dt>Email</dt><dd><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></dd></div>
        <div class="detail-row"><dt>Candidate type</dt><dd>${esc(c.candidateType)}</dd></div>
        <div class="detail-row"><dt>Evidence</dt><dd><a href="${esc(c.source)}" target="_blank" rel="noopener">Official source ↗</a><br><small>${esc(c.sourceType)}</small></dd></div>
        <div class="detail-row"><dt>Map precision</dt><dd>${precision==='postcode'?'Postcode-level':precision==='outcode'?'Outcode-level':'Approximate area-level'}</dd></div>
      </dl>
      <div class="pipeline-box"><label>Recruitment status</label><select id="detailStatus">${STATUSES.map(s=>`<option ${s===c.outreachStatus?'selected':''}>${esc(s)}</option>`).join('')}</select><label style="margin-top:10px">Owner</label><input id="detailOwner" value="${esc(c.owner||'')}" placeholder="e.g. Maxim"><label style="margin-top:10px">Working notes</label><textarea id="detailNotes" placeholder="Call result, capacity, depot, exclusivity, next action…">${esc(c.notes||'')}</textarea><div class="pipeline-actions"><small>Saved locally in this browser</small><button id="savePipeline">Save update</button></div></div>`;
    $('#detailPanel').hidden=false;$('#detailBackdrop').hidden=false;
    $('#savePipeline').onclick=()=>{state.edits[c.id]={status:$('#detailStatus').value,owner:$('#detailOwner').value.trim(),notes:$('#detailNotes').value.trim()};localStorage.setItem('jt-csp-edits-v1',JSON.stringify(state.edits));buildStatusFiltersOnly();render();selectCompany(c.id,false)};
  }
  function closeDetail(){state.selected=null;$('#detailPanel').hidden=true;$('#detailBackdrop').hidden=true;render()}
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
    const arr=getFiltered();const cols=['id','area','company','base','phone','email','website','candidateType','priority','outreachStatus','owner','notes','source'];const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';const csv='\ufeff'+[cols.join(','),...arr.map(r=>cols.map(k=>q(r[k])).join(','))].join('\n');const b=new Blob([csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`jt-csp-filtered-${arr.length}.csv`;a.click();URL.revokeObjectURL(a.href)
  }
  function mobileView(v){$$('.mobile-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.view===v));$$('.filters,.results,.map-shell').forEach(x=>x.classList.remove('mobile-active'));const el=v==='filters'?$('.filters'):v==='results'?$('.results'):$('.map-shell');el.classList.add('mobile-active');if(v==='map'&&leafletReady)setTimeout(()=>map.invalidateSize(),30)}

  $('#searchInput').addEventListener('input',e=>{state.q=e.target.value;render()});
  $('#typeFilter').addEventListener('change',e=>{state.type=e.target.value;render()});
  $('#sortSelect').addEventListener('change',e=>{state.sort=e.target.value;render()});
  $('#resetBtn').onclick=reset;$('#exportBtn').onclick=exportCSV;$('#fitBtn').onclick=fitVisible;$('#locateAreasBtn').onclick=()=>{if(leafletReady)map.fitBounds([[52.9,-3.65],[54.15,-1.45]])};$('#detailClose').onclick=closeDetail;$('#detailBackdrop').onclick=closeDetail;
  $$('.mobile-tabs button').forEach(b=>b.onclick=()=>mobileView(b.dataset.view));
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#detailPanel').hidden)closeDetail();if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();$('#searchInput').focus()}});

  buildFilters();bindFilterInputs();render();mobileView('map');initMap();setTimeout(fitVisible,400);
})();