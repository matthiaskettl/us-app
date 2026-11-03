import {ROUTES,snapshotForDisplay,latestSnapshot,waitForJourneySnapshot} from './transit.js';
import {uid,today,addDays,newAppointment,berlinDateTime,appointmentOnDate,validateRecord,validateFile} from './core.js';
import {Files,extractText,jpegPDF,readSelectedFiles} from './files.js';
import {Scanner} from './scanner.js';

export function createHousehold(ctx){
  const {store,$,esc,icon,button,heading,empty,input,textarea,select,whoOptions,modal,closeModal,formFooter,toast,render,person,avatar,taskRow}=ctx;
  const files=new Files(store);let edit=null,staged=[],scan=null,scanOriginal=null,docLabel='all',damageStatus='all',contentMatches=[],searchError='',searchTimer,searchGeneration=0,imageObserver,transit=null,transitLoading=false,lastTransit=0,transitGeneration=-1,transitController=null,transitStatus='',transitNeedsHelp=false;
  const fileSizes=size=>size<1024*1024?`${Math.ceil(size/1024)} KB`:`${(size/1024/1024).toFixed(1)} MB`;
  const clock=value=>new Date(value).toLocaleTimeString('de-DE',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit'});
  const normalize=value=>String(value).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
  const transitDirections={munich:'outbound',hospital:'outbound'};
  try{const saved=JSON.parse(localStorage.getItem('together-journey-directions'));for(const group of Object.keys(transitDirections))if(['outbound','return'].includes(saved?.[group]))transitDirections[group]=saved[group];}catch{}
  const query=()=>ctx.search().trim();
  const metadataMatch=data=>query().split(/\s+/).every(q=>normalize(JSON.stringify(data)).includes(normalize(q)));
  let readingFiles=null;
  function cleanup(){readingFiles=null;scan=null;scanOriginal=null;staged=[];edit=null;}
  function attachments(){return [...(edit?.data.files||[]).map(f=>({...f,saved:true})),...staged.map(s=>({id:s.id,name:s.file.name,size:s.file.size,type:s.file.type,saved:false}))];}
  function attachmentsHTML(){return attachments().map(f=>`<div class="attachment-row"><span class="attachment-type">${icon(f.type.startsWith('image/')?'camera':'document')}</span><div><strong>${esc(f.name)}</strong><small>${fileSizes(f.size)}${f.saved?' · uploaded':' · ready to upload'}</small></div>${f.saved&&f.type.startsWith('image/')?button('View','view-photo','text-button',`data-id="${f.id}"`):''}${f.saved?button('Download','download-file','text-button',`data-id="${f.id}"`):''}${store.canWrite?button(icon('close'),'remove-attachment','icon-button',`data-id="${f.id}" aria-label="Remove ${esc(f.name)}"`):''}</div>`).join('')||'<p class="muted">No files attached yet.</p>';}
  const editorFooter=(label,existing)=>`${existing&&store.canWrite?button('Delete this entry','remove-household-record','danger'):''}${store.canWrite?formFooter(label):button('Close','close','secondary')}`;

  function appointmentRow(record){const d=record.data;return `<button type="button" class="appointment-row ${d.status==='cancelled'?'cancelled':''}" data-action="edit-appointment" data-id="${record.id}"><span class="appointment-time">${d.allDay?'All day':esc(d.start.slice(11))}<small>${esc(d.start.slice(0,10).split('-').reverse().slice(0,2).join('.'))}</small></span><span class="appointment-copy"><strong>${esc(d.title)}</strong><small>${esc(d.location||'No location set')}${d.status!=='confirmed'?' · '+d.status:''}</small></span>${avatar(d.assignee)}</button>`;}
  function appointmentEditor(id){
    const record=id?store.get(id):null,data=structuredClone(record?.data||newAppointment());
    modal(id?'Appointment details':'New appointment',`<form id="appointment-form"><fieldset ${!store.canWrite?'disabled':''}>${input('title','Appointment',data.title,'text','required maxlength="200" autofocus placeholder="Flat handover, a bank meeting, dinner…"')}<div class="form-row">${input('start','Starts (Berlin time)',data.start,'datetime-local','required')}${input('end','Ends (Berlin time)',data.allDay?addDays(data.end.slice(0,10),-1)+'T00:00':data.end,'datetime-local','required')}</div><label class="check-label"><input type="checkbox" name="allDay" ${data.allDay?'checked':''}> All day (end date is the last included day)</label><div class="form-row">${select('assignee','For whom?',whoOptions(),data.assignee)}${select('status','Status',[['confirmed','Confirmed'],['tentative','Tentative'],['cancelled','Cancelled']],data.status)}</div>${input('location','Location / meeting link',data.location,'text','maxlength="500"')}${textarea('description','Details',data.description,'rows="4" maxlength="10000"')}</fieldset><p class="fine">Berlin time · Export to your calendar for reminders.</p>${editorFooter('Save appointment',!!id)}</form>`);
    edit={kind:'appointment',id:id||uid(),data};ctx.setCleanup(cleanup);
  }
  function appointmentsView(){
    const now=berlinDateTime(),all=store.list('appointment').filter(r=>metadataMatch(r.data)&&(ctx.assignee()==='all'||r.data.assignee===ctx.assignee()||(['person1','person2'].includes(ctx.assignee())&&r.data.assignee==='both')));
    const upcoming=all.filter(r=>r.data.end>=now&&r.data.status!=='cancelled').sort((a,b)=>a.data.start.localeCompare(b.data.start)),past=all.filter(r=>r.data.end<now||r.data.status==='cancelled').sort((a,b)=>b.data.start.localeCompare(a.data.start));
    return `${heading('','Planner','','new-appointment','Add appointment')}<nav class="view-switch" aria-label="Planner views"><a href="#calendar">${icon('calendar')}Month</a><a href="#appointments" aria-current="page">${icon('appointments')}Appointments</a></nav><div class="filter-bar"><div class="search-field">${icon('search')}<input id="search" value="${esc(query())}" placeholder="Search appointments…" aria-label="Search appointments"></div><select data-filter="assignee" aria-label="Appointment person">${[['all','Everyone'],...whoOptions()].map(([v,l])=>`<option value="${v}" ${ctx.assignee()===v?'selected':''}>${esc(l)}</option>`).join('')}</select>${button('Export calendar','export-calendar','secondary')}</div><div class="panel">${upcoming.length?upcoming.map(appointmentRow).join(''):empty('No upcoming appointments','')}</div>${past.length?`<details class="past-appointments"><summary>Past & cancelled · ${past.length}</summary><div class="panel">${past.map(appointmentRow).join('')}</div></details>`:''}`;
  }
  function personPanels(){const now=berlinDateTime();return `<div class="personal-plans">${['person1','person2'].map(who=>{
    const tasks=store.list('task').filter(r=>!r.data.done&&[who,'both'].includes(r.data.assignee)).sort((a,b)=>(a.data.due||'9999').localeCompare(b.data.due||'9999'));
    const appointments=store.list('appointment').filter(r=>r.data.end>=now&&r.data.status!=='cancelled'&&[who,'both'].includes(r.data.assignee)).sort((a,b)=>a.data.start.localeCompare(b.data.start));
    return `<section class="panel person-panel"><div class="person-heading">${avatar(who)}<div><h2>${esc(person(who))}</h2></div></div><div class="section-heading"><h3>To-dos <span class="tag">${tasks.length}</span></h3><a href="#tasks" data-action="person-plans" data-page="tasks" data-person="${who}">View all ${icon('arrow')}</a></div>${tasks.length?tasks.slice(0,3).map(r=>taskRow(r,true)).join(''):'<p class="person-empty">No open to-dos.</p>'}<div class="section-heading appointments-section"><h3>Appointments</h3><div class="section-actions"><a href="#appointments" data-action="person-plans" data-page="appointments" data-person="${who}">View all</a>${store.canWrite?button(icon('plus'),'new-appointment','icon-button','aria-label="Add appointment"'):''}</div></div>${appointments.length?appointments.slice(0,2).map(appointmentRow).join(''):'<p class="person-empty">No upcoming appointments.</p>'}</section>`;
  }).join('')}</div>`;}
  function journeyHTML(j,route,index){const first=j.legs[0],boarding=j.legs.find(l=>!l.walking),last=j.legs.at(-1),delay=Math.round((Date.parse(first.departure)-Date.parse(first.plannedDeparture))/60000),date=new Date(j.departure).toLocaleDateString('de-DE',{timeZone:'Europe/Berlin',day:'2-digit',month:'2-digit'});return `<button type="button" class="journey" data-action="journey-details" data-route="${route.id}" data-index="${index}"><span class="journey-time"><strong>${clock(j.departure)}</strong><small>${date}${delay>0?' · +'+delay+' min':''}</small></span><span class="journey-copy"><strong>${esc(j.legs.filter(l=>!l.walking).map(l=>l.line).join(' → '))}</strong><small>${clock(j.arrival)} arrival · ${j.duration} min · ${j.changes?j.changes+' change'+(j.changes===1?'':'s'):'direct'}</small><small>${first.walking?'Walk from ':''}${esc(first.origin)}${first.platform?' · platform '+esc(first.platform):''}</small>${first.walking&&boarding?`<small>Board ${esc(boarding.origin)} · ${clock(boarding.departure)}${boarding.platform?' · platform '+esc(boarding.platform):''}</small>`:''}${route.group==='hospital'&&route.direction==='return'?`<small>To ${esc(last.destination)}</small>`:''}</span>${j.preferred&&route.group==='munich'?'<span class="tag preferred">RB16</span>':icon('arrow')}</button>`;}
  function transitHTML(){
    const allRoutes=snapshotForDisplay(transit||{format:'together-journeys',routes:[]}).routes;
    const routes=Object.entries(transitDirections).map(([group,direction])=>allRoutes.find(route=>route.group===group&&route.direction===direction));
    return `<div class="section-heading transit-heading"><div><h2>Next connections</h2></div>${button(icon('sync')+(transitLoading?'Checking…':'Refresh'),'refresh-transit','text-button',transitLoading?'disabled':'')}</div><div class="transit-grid">${routes.map(route=>{
      const available=(route.journeys||[]).filter(j=>Date.parse(j.departure)>=Date.now());const selected=available.slice(0,3),preferred=route.group==='munich'&&available.find(j=>j.preferred);if(preferred&&!selected.includes(preferred))selected[2]=preferred;
      return `<section class="panel transit-card" data-transit-group="${route.group}"><div class="section-heading"><h3>${icon(route.group==='munich'?'train':'bus')}${esc(route.title)}</h3><span class="tag">${route.group==='munich'?'RB16 preferred':'West + Ost'}</span></div><div class="transit-direction-toggle" role="group" aria-label="${esc(route.title)} direction">${['outbound','return'].map(direction=>{const option=ROUTES.find(r=>r.group===route.group&&r.direction===direction);return button(direction==='outbound'?'Outbound':'Return','transit-direction','',`data-group="${route.group}" data-direction="${direction}" aria-pressed="${direction===route.direction}" aria-label="${direction==='outbound'?'Outbound':'Return'}: ${esc(option.originTitle)} → ${esc(option.destinationTitle)}"`);}).join('')}</div><p class="transit-direction-line">${esc(route.originTitle)} <span aria-hidden="true">→</span> ${esc(route.destinationTitle)}</p>${selected.length?selected.map(j=>journeyHTML(j,route,transit.routes.find(r=>r.id===route.id).journeys.indexOf(j))).join(''):`<p class="transit-empty">${store.demo?'Connect to see departures.':transitLoading?'Loading…':route.error?esc(route.error):transit?'No upcoming journey returned. Check the planner.':'No departures loaded.'}</p>`}${route.warning?`<p class="transit-warning">${esc(route.warning)}</p>`:''}${route.stale?'<p class="transit-warning">Saved result · snapshot is outdated. Verify before travelling.</p>':''}<div class="transit-foot"><span>${route.updatedAt?'Updated '+clock(route.updatedAt):'Times in Europe/Berlin'} · no ICE</span><a href="https://www.bayern-fahrplan.de/" target="_blank" rel="noopener noreferrer">Bayern-Fahrplan ↗</a></div></section>`;
    }).join('')}</div><p class="transit-status" role="status" aria-live="polite">${esc(transitStatus)}${transitNeedsHelp&&store.config?` <a href="https://github.com/${esc(store.config.repo)}/actions/workflows/journeys.yml" target="_blank" rel="noopener noreferrer">Check refresh job ↗</a>`:''}</p><p class="fine transit-attribution">Journey data: DEFAS Bayern / Bayern-Fahrplan. ${transit?.error?esc(transit.error):'Auto updates ~15 min · Refresh requests a new timetable.'}</p>`;
  }
  function refreshTransitHTML(){const el=$('#transit-board');if(el)el.innerHTML=transitHTML();}
  async function loadTransit(force=false){
    if(store.demo||!store.config){if(force)toast('Connect your private repository to refresh connections.');return;}
    if(transitLoading||(!force&&Date.now()-lastTransit<60000))return;
    const generation=store.generation,client=store.github,controller=new AbortController();
    transitController=controller;transitLoading=true;lastTransit=Date.now();transitNeedsHelp=false;
    transitStatus=force?'Requesting fresh connections…':'';refreshTransitHTML();
    try{
      if(force&&store.canWrite){
        const request=await client.requestJourneyRefresh();
        if(generation!==store.generation||controller.signal.aborted)return;
        transitStatus='Waiting for GitHub to update the timetable…';refreshTransitHTML();
        const data=await waitForJourneySnapshot(client,request,{signal:controller.signal});
        if(generation!==store.generation||controller.signal.aborted)return;
        transit=data;
        const routes=snapshotForDisplay(data).routes,failed=routes.filter(r=>r.error);
        transitStatus=failed.length===routes.length?'The timetable provider is unavailable. Please try again.':failed.length?`Connections updated; ${failed.length} direction${failed.length===1?' is':'s are'} unavailable.`:'Connections updated.';
      }else{
        const data=await latestSnapshot(client,{signal:controller.signal});
        if(generation!==store.generation||controller.signal.aborted)return;
        transit=data;if(force)transitStatus='Latest saved timetable loaded. An editing connection is needed to request a new one.';
      }
    }catch(e){
      if(generation!==store.generation||controller.signal.aborted)return;
      transitStatus=e.message;transitNeedsHelp=force&&store.canWrite;
    }finally{
      if(transitController===controller){transitController=null;transitLoading=false;refreshTransitHTML();}
    }
  }
  function dashboard(){return `${personPanels()}<section id="transit-board">${transitHTML()}</section>`;}

  function damageView(){const all=store.list('damage'),rows=all.filter(r=>metadataMatch(r.data)&&(damageStatus==='all'||r.data.status===damageStatus)).sort((a,b)=>b.data.date.localeCompare(a.data.date));return `${heading('','Flat gallery','','new-damage','Record damage')}<div class="filter-bar"><div class="search-field">${icon('search')}<input id="search" value="${esc(query())}" aria-label="Search damages" placeholder="Search room, description or title…"></div>${[['all','All'],['open','Open'],['reported','Reported'],['fixed','Fixed']].map(([id,label])=>button(label,'damage-status',damageStatus===id?'pill active':'pill',`data-status="${id}"`)).join('')}</div><div class="damage-grid">${rows.map(r=>`<button type="button" class="damage-card" data-action="edit-damage" data-id="${r.id}"><div class="damage-photo">${r.data.files[0]?`<img data-file-image="${r.data.files[0].id}" alt="${esc(r.data.title)}" loading="lazy">`:icon('camera')}<span class="photo-count">${r.data.files.length} photo${r.data.files.length===1?'':'s'}</span></div><div class="damage-caption"><span class="tag status-${r.data.status}">${r.data.status}</span><h3>${esc(r.data.title)}</h3><p>${esc(r.data.description)}</p><small>${esc(r.data.room||'Room not specified')} · ${esc(r.data.date)}</small></div></button>`).join('')}</div>${rows.length?'':empty('No damage records','Add photos of your flat.','new-damage','Record damage')}<p class="fine">Original photos are saved unchanged.</p>`;}
  function documentsView(){const all=store.list('document'),labels=[...new Set(all.flatMap(r=>r.data.labels))].sort(),rows=all.filter(r=>(docLabel==='all'||r.data.labels.includes(docLabel))&&(!query()||metadataMatch(r.data)||r.data.files.some(f=>contentMatches.some(m=>m.id===f.id)))).sort((a,b)=>b.data.date.localeCompare(a.data.date));return `${heading('','Documents','','new-document','Upload document')}<div class="filter-bar"><div class="search-field">${icon('search')}<input id="search" value="${esc(query())}" maxlength="120" aria-label="Search documents" placeholder="Search titles, labels, descriptions and document text…"></div>${button(icon('download')+'Backup with files','export-file-backup','secondary')}</div><div class="list-tabs">${['all',...labels].map(label=>button(label==='all'?'All documents':esc(label),'doc-label',docLabel===label?'pill active':'pill',`data-label="${esc(label)}"`)).join('')}</div>${searchError?`<p class="notice">${esc(searchError)}</p>`:''}<div class="document-list">${rows.map(r=>{const match=r.data.files.map(f=>contentMatches.find(m=>m.id===f.id)).find(Boolean);return `<button type="button" class="document-card" data-action="edit-document" data-id="${r.id}"><span class="document-icon">${icon('document')}</span><span class="document-info"><strong>${esc(r.data.title)}</strong><span>${esc(r.data.description)}</span><span class="document-labels">${r.data.labels.map(l=>`<span class="tag">${esc(l)}</span>`).join('')}<small>${r.data.date} · ${r.data.files.length} file${r.data.files.length===1?'':'s'}${r.data.files.some(f=>f.searchable)?' · text searchable':''}</small></span>${match?`<span class="search-snippet">…${esc(match.snippet)}…</span>`:''}</span>${icon('arrow')}</button>`;}).join('')}</div>${rows.length?'':empty(query()?'No matching documents':'No documents yet',query()?'Try a different search or label.':'Upload a file or scan a document.','new-document','Add document')}<p class="fine">Search includes text PDFs, DOCX and text files. Scans use labels and descriptions; no OCR.</p>`;}
  function fileEditor(kind,id){
    const record=id?store.get(id):null,data=structuredClone(record?.data||{title:'',date:today(),description:'',files:[],...(kind==='damage'?{room:'',status:'open'}:{labels:[]})});
    modal(kind==='damage'?(id?'Damage record':'Record damage'):(id?'Document details':'Add an important document'),`<form id="${kind}-form"><fieldset ${!store.canWrite?'disabled':''}>${input('title',kind==='damage'?'What is damaged?':'Document name',data.title,'text','required maxlength="200" autofocus')}<div class="form-row">${input('date',kind==='damage'?'Date observed':'Document date',data.date,'date','required')}${kind==='damage'?input('room','Room / area',data.room,'text','maxlength="100" placeholder="Kitchen, bathroom…"'):input('labels','Labels (comma separated)',data.labels.join(', '),'text','maxlength="1000" placeholder="Bank, Flat, Internet, Contracts"')}</div>${kind==='damage'?select('status','Status',[['open','Open'],['reported','Reported'],['fixed','Fixed']],data.status):''}${textarea('description','Description',data.description,'rows="3" maxlength="10000"')}<div class="upload-controls"><label class="secondary upload-button">${icon('upload')} Upload ${kind==='damage'?'photos':'files'}<input id="attachment-input" type="file" ${kind==='damage'?'accept="image/jpeg,image/png,image/webp"':'accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.rtf,image/jpeg,image/png,image/webp"'} multiple></label>${kind==='damage'?`<label class="secondary upload-button">${icon('camera')} Take a photo<input id="camera-input" type="file" accept="image/*" capture="environment"></label>`:`<label class="secondary upload-button">${icon('camera')} Scan a document<input id="scan-input" type="file" accept="image/*" capture="environment"></label>`}</div><p class="fine">Up to 20 files · 20 MB each. ${kind==='damage'?'Photos are saved unchanged.':'Scanning and text extraction happen on this device.'}</p></fieldset><div id="scan-panel"></div><div id="attachments"></div><div id="photo-preview"></div><p id="upload-progress" role="status" aria-live="polite"></p>${editorFooter(kind==='damage'?'Save damage record':'Save document',!!id)}</form>`,true);
    edit={kind,id:id||uid(),data};staged=[];$('#attachments').innerHTML=attachmentsHTML();ctx.setCleanup(cleanup);
  }
  function setProgress(message){const el=$('#upload-progress');if(el)el.textContent=message;}
  async function selectAttachments(el){
    const chosen=[...el.files];if(!chosen.length||!edit||readingFiles)return;
    const target=edit,generation=store.generation,job={},form=el.closest('form');
    const current=()=>edit===target&&generation===store.generation&&readingFiles===job;
    const controls=[...form.querySelectorAll('input[type=file],button[type=submit]')].map(control=>[control,control.disabled]);
    readingFiles=job;controls.forEach(([control])=>control.disabled=true);
    $('.form-error',form)?.replaceChildren();setProgress('Reading selected files…');
    try{
      if(!store.canWrite)throw new Error('This connection is read-only.');
      validateAttachments(chosen);
      const copies=await readSelectedFiles(chosen);
      if(!current())return;
      if(el.id==='scan-input')await startScan(copies[0]);else await stage(copies);
      if(current())setProgress(el.id==='scan-input'?'':`${copies.length} file${copies.length===1?'':'s'} ready. Save to upload.`);
    }catch(error){if(current()){setProgress('');ctx.formError(error);}}
    finally{
      el.value='';
      if(current()){readingFiles=null;controls.forEach(([control,disabled])=>control.disabled=disabled);}
    }
  }
  function validateAttachments(list){
    if(attachments().length+list.length>20)throw new Error('Attach at most 20 files.');
    for(const file of list){if(!file.size||file.size>20*1024*1024)throw new Error('Each file must be between 1 byte and 20 MB.');if(edit.kind==='damage'&&!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Choose JPEG, PNG or WebP for original damage photos. Convert unsupported HEIC photos first.');}
  }
  async function stage(list){
    validateAttachments(list);
    staged.push(...list.map(file=>({id:uid(),file})));
    $('#attachments').innerHTML=attachmentsHTML();
  }
  async function startScan(file){
    if(file.size>20*1024*1024)throw new Error('Choose an image under 20 MB.');
    const target=edit,scanner=new Scanner();scanOriginal=file;scan=scanner;$('#scan-panel').innerHTML=`<section class="scanner"><div class="section-heading"><h3>Review the page edges</h3>${button('Rotate 90°','rotate-scan','text-button')}</div><p id="scan-message" class="muted">Detecting the page…</p><canvas id="scan-canvas" aria-label="Document crop preview. Drag the numbered corners or use the controls below."></canvas><div class="scan-corner-controls">${select('corner','Adjust corner',[[0,'1 · top left'],[1,'2 · top right'],[2,'3 · bottom right'],[3,'4 · bottom left']],0)}<label>Horizontal position<input id="corner-x" type="range" min="0" max="100" step="0.1"></label><label>Vertical position<input id="corner-y" type="range" min="0" max="100" step="0.1"></label></div><div class="form-row">${select('scanMode','Appearance',[['clean','Clean scan'],['grayscale','Grayscale'],['color','Original colours']],'clean')}${select('scanFormat','Save scan as',[['pdf','PDF'],['jpeg','JPEG']],'pdf')}</div><div class="button-row">${button('Detect edges again','detect-scan','secondary')}${button('Use original photo','original-scan','secondary')}${button('Crop & add scan','apply-scan','primary')}</div><p class="fine">Automatic edges are a suggestion. Check all four corners before cropping. This creates a new file; it never changes the photo on your phone.</p></section>`;
    try{await scanner.load(file,$('#scan-canvas'));if(edit!==target||scan!==scanner)return;scan.onchange=updateCornerControls;updateCornerControls();$('#scan-message').textContent=scan.confident?'Page edges detected. Adjust if needed.':'No clear page boundary found. Set the four corners manually.';}catch(e){if(edit!==target||scan!==scanner)return;scan=null;scanOriginal=null;$('#scan-panel').innerHTML='';throw new Error('Could not read this photo. Choose a JPEG, PNG or WebP image. '+e.message);}
  }
  function updateCornerControls(){if(!scan)return;const i=Number($('[name=corner]').value);$('#corner-x').value=scan.points[i][0]*100;$('#corner-y').value=scan.points[i][1]*100;}
  async function saveFiles(data){
    if(readingFiles)throw new Error('Wait for the selected files to finish reading before saving.');
    const target=edit,generation=store.generation,check=()=>{if(edit!==target||store.generation!==generation)throw new Error('The editor or connection changed. Saving stopped; originals already uploaded remain in the original repository.');};if(scan)throw new Error('Finish the scan first: crop it or use the original photo.');if(!attachments().length)throw new Error('Attach at least one file before saving.');
    const uploaded=[...target.data.files];let warnings=[];
    for(let i=0;i<staged.length;i++){
      const item=staged[i];setProgress(`Uploading ${i+1} of ${staged.length}: ${item.file.name}`);
      const descriptor=item.uploaded||await files.upload(item.file,item.id);check();item.uploaded=descriptor;
      if(target.kind==='document'&&!item.extracted){
        try{setProgress('Extracting searchable text on this device…');const result=await extractText(item.file);check();descriptor.searchable=!!result.text.trim()&&await files.index(descriptor,result.text);check();if(result.note)warnings.push(result.note);item.extracted=true;}
        catch{check();warnings.push(`${item.file.name}: text indexing was unavailable; the original file is saved.`);descriptor.searchable=false;}
      }
      uploaded.push(descriptor);
    }
    check();
    const value={...target.data,title:data.title,date:data.date,description:data.description,files:uploaded,...(target.kind==='damage'?{room:data.room,status:data.status}:{labels:data.labels.split(',').map(t=>t.trim()).filter(Boolean)})};
    const undo=store.change(target.kind,target.id,value);closeModal();toast(target.kind==='damage'?'Damage recorded. Originals preserved.':'Document saved.'+(warnings.some(w=>w.includes('unavailable'))?' Text indexing unavailable for some files.':''),undo);render();
  }

  async function hydrate(){
    imageObserver?.disconnect();imageObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;imageObserver.unobserve(entry.target);const id=entry.target.dataset.fileImage,file=store.records.flatMap(r=>r.data.files||[]).find(f=>f.id===id);if(!file)continue;files.url(file).then(url=>{if(entry.target.isConnected)entry.target.src=url;}).catch(()=>{entry.target.alt='Photo unavailable offline. Open the record to retry.';});}},{rootMargin:'150px'});
    document.querySelectorAll('[data-file-image]').forEach(img=>imageObserver.observe(img));
    if(transitGeneration!==store.generation){files.clear();transitController?.abort();transitController=null;transitLoading=false;transitGeneration=store.generation;transit=null;lastTransit=0;transitStatus='';transitNeedsHelp=false;}
    if(ctx.page()==='home')loadTransit();
  }
  async function fullBackup(){
    const generation=store.generation,check=()=>{if(store.generation!==generation)throw new Error('Connection changed. Backup stopped.');};
    const {zipSync,strToU8}=await import('./vendor/fflate.mjs');check();const records=structuredClone(store.records),unique=[...new Map(records.flatMap(r=>r.data.files||[]).map(f=>[f.id,f])).values()];
    if(unique.reduce((sum,f)=>sum+f.size,0)>100*1024*1024)throw new Error('This browser export supports up to 100 MB. Download larger originals individually or clone your private data repository.');
    const archive={'household.json':strToU8(JSON.stringify({format:'together-backup',version:1,records,exportedAt:new Date().toISOString()}))};
    for(const [i,file]of unique.entries()){check();toast(`Preparing backup: ${i+1}/${unique.length} originals…`);archive['files/'+file.id]=new Uint8Array(await(await files.blob(file)).arrayBuffer());check();archive['text/'+file.id+'.txt']=strToU8(await files.text(file));}check();
    const blob=new Blob([zipSync(archive,{level:0})],{type:'application/zip'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`together-with-files-${today()}.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);toast('Backup includes original files and document search text.');
  }
  async function importArchive(file){
    if(file.size>110*1024*1024)throw new Error('Choose an archive smaller than 110 MB.');
    const {unzipSync,strFromU8}=await import('./vendor/fflate.mjs');let total=0;
    const archive=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:e=>{total+=e.originalSize;if(total>120*1024*1024)throw new Error('Archive expands beyond the size limit.');return e.name==='household.json'||/^(files\/[\w-]{8,80}|text\/[\w-]{8,80}\.txt)$/.test(e.name);}});
    const backup=JSON.parse(strFromU8(archive['household.json']||new Uint8Array()));if(backup.format!=='together-backup'||backup.version!==1||!Array.isArray(backup.records)||backup.records.length>1000)throw new Error('Invalid household archive.');
    const records=backup.records.filter(r=>!r.deleted),ids=new Set();for(const r of records){if(!/^[\w-]{8,80}$/.test(r.id)||ids.has(r.id))throw new Error('Duplicate or invalid record ID.');ids.add(r.id);r.data=validateRecord(r.kind,r.data);}
    const allFiles=[...new Map(records.flatMap(r=>r.data.files||[]).map(f=>[f.id,f])).values()];
    for(const f of allFiles){validateFile(f);const bytes=archive['files/'+f.id];if(!bytes||bytes.length!==f.size)throw new Error('A file is missing from the archive.');const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(sha!==f.sha256)throw new Error('An original file does not match its checksum.');}
    modal('Restore this household archive?',`<p>Restore ${records.length} records and ${allFiles.length} original files. Matching record IDs will be updated; other records will stay. Vault entries still need their original passphrase.</p><div class="modal-actions">${button('Cancel','close')}${button('Restore archive','confirm-file-restore','primary')}</div><p class="form-error" role="alert"></p>`);
    pendingRestore={records,allFiles,archive};
  }
  let pendingRestore=null;
  async function action(name,el){
    const id=el?.dataset.id;
    if(name==='new-appointment'||name==='edit-appointment'){appointmentEditor(id);return true;}
    if(['new-damage','edit-damage','new-document','edit-document'].includes(name)){fileEditor(name.endsWith('damage')?'damage':'document',id);return true;}
    if(name==='damage-status'){damageStatus=el.dataset.status;render();return true;}
    if(name==='doc-label'){docLabel=el.dataset.label;render();return true;}
    if(name==='remove-attachment'){edit.data.files=edit.data.files.filter(f=>f.id!==id);staged=staged.filter(f=>f.id!==id);$('#attachments').innerHTML=attachmentsHTML();return true;}
    if(name==='view-photo'){const file=edit?.data.files.find(f=>f.id===id),target=edit;if(file){const url=await files.url(file);if(edit===target)$('#photo-preview').innerHTML=`<figure class="original-preview"><div>${button('Close preview','close-photo','text-button')}</div><img src="${esc(url)}" alt="${esc(file.name)}"><figcaption>${esc(file.name)} · original photo</figcaption></figure>`;}return true;}
    if(name==='close-photo'){$('#photo-preview').innerHTML='';return true;}
    if(name==='download-file'){const file=[...(edit?.data.files||[]),...store.records.flatMap(r=>r.data.files||[])].find(f=>f.id===id);if(file)await files.download(file);return true;}
    if(name==='rotate-scan'){scan.rotate();updateCornerControls();return true;}
    if(name==='detect-scan'){scan.detect();updateCornerControls();return true;}
    if(name==='original-scan'){await stage([scanOriginal]);scan=null;scanOriginal=null;$('#scan-panel').innerHTML='';return true;}
    if(name==='apply-scan'){
      const target=edit,scanner=scan,mode=$('[name=scanMode]').value,format=$('[name=scanFormat]').value,name=scanOriginal.name.replace(/\.[^.]+$/,'')+'-scan.'+(format==='pdf'?'pdf':'jpg');el.disabled=true;setProgress('Straightening and cropping the page…');
      try{const result=await scanner.scan(mode);if(edit!==target||scan!==scanner)return true;const blob=format==='pdf'?jpegPDF(new Uint8Array(await result.blob.arrayBuffer()),result.width,result.height):result.blob;await stage([new File([blob],name,{type:blob.type})]);scan=null;scanOriginal=null;$('#scan-panel').innerHTML='';setProgress('Scan ready. Save the document to upload it.');}finally{el.disabled=false;}return true;
    }
    if(name==='remove-household-record'){
      const target=edit;modal('Delete this entry?',`<p>Remove “${esc(target.data.title)}” from your shared space? Original files remain in the private repository and Git history so this can be undone.</p><div class="modal-actions">${button('Cancel','close')}${button('Delete entry','confirm-household-delete','danger')}</div>`);edit=target;return true;
    }
    if(name==='confirm-household-delete'){const undo=store.change(edit.kind,edit.id,{},true);closeModal();toast('Entry deleted.',undo);return true;}
    if(name==='transit-direction'){
      const {group,direction}=el.dataset;
      if(!Object.hasOwn(transitDirections,group)||!['outbound','return'].includes(direction))return true;
      transitDirections[group]=direction;try{localStorage.setItem('together-journey-directions',JSON.stringify(transitDirections));}catch{}
      refreshTransitHTML();$(`[data-action="transit-direction"][data-group="${group}"][data-direction="${direction}"]`)?.focus({preventScroll:true});return true;
    }
    if(name==='refresh-transit'){await loadTransit(true);return true;}
    if(name==='journey-details'){
      const source=transit?.routes.find(r=>r.id===el.dataset.route),j=source?.journeys[Number(el.dataset.index)],route=transit&&snapshotForDisplay(transit).routes.find(r=>r.id===el.dataset.route);if(!j)return true;
      modal(`${route.originTitle} → ${route.destinationTitle}`,`${route.stale?'<p class="notice">Saved result: snapshot is outdated. Verify before leaving.</p>':''}<p>${clock(j.departure)}–${clock(j.arrival)} · ${j.duration} minutes · ${j.changes} changes</p><div class="journey-legs">${j.legs.map(l=>`<section><span class="tag">${esc(l.line)} · ${l.realtime?'Realtime reported at last update':'Timetable only'}</span><h3>${esc(l.origin)} → ${esc(l.destination)}</h3><p>${clock(l.departure)}–${clock(l.arrival)}${l.platform?' · Board at '+esc(l.platform):''}</p>${l.notes.map(n=>`<p class="fine">${esc(n)}</p>`).join('')}</section>`).join('')}</div><p class="fine">Hospital journeys include Nordbahnhof West and Ost. Check the stated stop and allow time to reach it. Times use Europe/Berlin.</p><a class="primary" href="https://www.bayern-fahrplan.de/" target="_blank" rel="noopener noreferrer">Check in Bayern-Fahrplan ↗</a>`,true);return true;
    }
    if(name==='export-file-backup'){await fullBackup();return true;}
    if(name==='import-file-backup'){if(!store.canWrite)throw new Error('This connection is read-only.');const input=document.createElement('input');input.type='file';input.accept='.zip';input.onchange=()=>{if(input.files[0])importArchive(input.files[0]).catch(e=>toast(e.message));};input.click();return true;}
    if(name==='confirm-file-restore'){
      const restore=pendingRestore,generation=store.generation,check=()=>{if(generation!==store.generation)throw new Error('Connection changed. Restore stopped.');};if(!restore)return true;el.disabled=true;
      try{for(const f of restore.allFiles){check();await files.upload(new File([restore.archive['files/'+f.id]],f.name,{type:f.type}),f.id);check();const text=restore.archive['text/'+f.id+'.txt'];if(text)await files.index(f,new TextDecoder().decode(text));}check();ctx.confirmImport(restore.records);pendingRestore=null;}finally{el.disabled=false;}return true;
    }
    return false;
  }
  async function submit(form,data){
    if(form.id==='appointment-form'){const target=edit;const allDay=!!data.allDay,start=allDay?data.start.slice(0,10)+'T00:00':data.start,end=allDay?addDays(data.end.slice(0,10),1)+'T00:00':data.end;const undo=store.change('appointment',target.id,{...data,start,end,allDay});closeModal();toast('Appointment saved.',undo);render();return true;}
    if(['damage-form','document-form'].includes(form.id)){
      const pickers=[...form.querySelectorAll('input[type=file]')];pickers.forEach(picker=>picker.disabled=true);
      try{await saveFiles(data);return true;}finally{if(form.isConnected)pickers.forEach(picker=>picker.disabled=!store.canWrite||!!readingFiles);}
    }return false;
  }
  document.addEventListener('change',event=>{
    const el=event.target;if(['attachment-input','camera-input','scan-input'].includes(el.id)&&edit)selectAttachments(el);
    if(el.name==='corner'&&scan)updateCornerControls();
  });
  document.addEventListener('input',event=>{
    if(event.target.id==='search'&&ctx.page()==='documents'){
      const q=event.target.value.trim();contentMatches=[];searchError='';clearTimeout(searchTimer);const generation=++searchGeneration,connection=store.generation;
      if(q)searchTimer=setTimeout(async()=>{if(connection!==store.generation)return;try{const matches=await files.search(q);if(generation===searchGeneration&&connection===store.generation&&ctx.page()==='documents'){contentMatches=matches;render();}}catch{if(generation===searchGeneration&&connection===store.generation&&ctx.page()==='documents'){searchError='Document-content search is unavailable. Titles, labels and descriptions still work.';render();}}},300);
    }
    if(['corner-x','corner-y'].includes(event.target.id)&&scan){const corner=Number($('[name=corner]').value);scan.points[corner]=[Number($('#corner-x').value)/100,Number($('#corner-y').value)/100];scan.draw();}
  });
  setInterval(()=>{if(!document.hidden&&ctx.page()==='home'&&!ctx.isLogin()){refreshTransitHTML();loadTransit();}},60000);
  return {views:{appointments:appointmentsView,damages:damageView,documents:documentsView},appointmentRow,appointmentOnDate,appointmentEditor,dashboard,action,submit,afterRender:hydrate,clear:()=>{transitController?.abort();transitController=null;transitLoading=false;transitStatus='';transitNeedsHelp=false;files.clear();cleanup();pendingRestore=null;searchGeneration++;clearTimeout(searchTimer);transit=null;lastTransit=0;contentMatches=[];searchError='';}};
}
