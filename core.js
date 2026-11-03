export const KINDS = ['task', 'item', 'place', 'note', 'secret', 'settings', 'appointment', 'damage', 'document'];
export const CATEGORIES = ['Produce', 'Dairy & eggs', 'Bakery', 'Pantry', 'Frozen', 'Drinks', 'Household', 'Personal care', 'Other'];
export const uid = () => crypto.randomUUID();
export const isoDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const today = () => isoDate();
export function parseDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return null;
  const [y,m,d] = s.split('-').map(Number), result = new Date(y,m-1,d,12);
  return isoDate(result) === s ? result : null;
}
export function addDays(s, days) { const d = parseDate(s); if (!d) throw new Error('Invalid date'); d.setDate(d.getDate()+days); return isoDate(d); }
export function resolveDate(value, base = today()) {
  const word = value.toLowerCase().replace(/^@/, '');
  if (parseDate(word)) return word;
  if (word === 'today') return base;
  if (['tomorrow','tom'].includes(word)) return addDays(base,1);
  if (/^\+\d+[dw]?$/.test(word)) return addDays(base, parseInt(word.slice(1))* (word.endsWith('w') ? 7 : 1));
  const weekday = ['sun','mon','tue','wed','thu','fri','sat'].indexOf(word);
  if (weekday >= 0) return addDays(base, (weekday - parseDate(base).getDay()+7)%7 || 7);
  return null;
}
export function quickParse(input, base = today()) {
  let priority = 0, due = '', tags = [];
  const title = input.replace(/(?:^|\s)!([1-3])(?=\s|$)/g, (_, p) => {priority=Number(p); return '';})
    .replace(/(?:^|\s)@(\S+)(?=\s|$)/g, (all, w) => {const date=resolveDate(w,base); if (!date) return all; due=date; return '';})
    .replace(/(?:^|\s):([^\s,:]+(?:,[^\s,:]+)*):(?=\s|$)/g, (_, labels) => {tags.push(...labels.split(',')); return '';}).trim();
  tags = [...new Map(tags.map(t => [t.toLowerCase(),t])).values()];
  return {title, priority, due, tags};
}
export function nextDue(due, repeat) {
  const base = due || today();
  if (repeat === 'daily') return addDays(base,1);
  if (repeat === 'weekly') return addDays(base,7);
  if (repeat === 'monthly') {
    const date=parseDate(base), day=date.getDate(); date.setDate(1); date.setMonth(date.getMonth()+1);
    const last=new Date(date.getFullYear(),date.getMonth()+1,0).getDate(); date.setDate(Math.min(day,last)); return isoDate(date);
  }
  return '';
}
export function dueLabel(due, base=today()) {
  if (!due) return 'Anytime';
  if (due === base) return 'Today';
  if (due === addDays(base,1)) return 'Tomorrow';
  if (due < base) return 'Overdue · '+parseDate(due).toLocaleDateString(undefined,{month:'short',day:'numeric'});
  return parseDate(due)?.toLocaleDateString(undefined,{month:'short',day:'numeric'}) || due;
}
export function groupDue(due, base=today()) {
  if (!due) return 'Anytime';
  if (due < base) return 'Overdue';
  if (due === base) return 'Today';
  if (due === addDays(base,1)) return 'Tomorrow';
  if (due <= addDays(base,7)) return 'Next 7 days';
  return 'Later';
}
export function resetChildren(children) { return children.map(c => ({...c,done:false,children:resetChildren(c.children || [])})); }
export function checkChildren(children, done) { return children.map(c => ({...c,done,children:checkChildren(c.children || [],done)})); }
export function flattenChildren(children) { return children.flatMap(c => [c,...flattenChildren(c.children || [])]); }
export function completeTask(task) {
  if (task.done) return {...task,done:false};
  if (task.repeat) return {...task,due:nextDue(task.due,task.repeat),children:resetChildren(task.children),completedCount:(task.completedCount||0)+1,lastCompleted:today()};
  return {...task,done:true,children:checkChildren(task.children,true)};
}
export function importMarkdown(text) {
  const tasks=[], stack=[];
  for (const line of text.split(/\r?\n/)) {
    const match=/^(\s*)[-*+] \[([ xX])\]\s*(.*)$/.exec(line);
    if (!match) { if (stack.length && line.trim()) stack[stack.length-1].task.notes += (stack[stack.length-1].task.notes ? '\n' : '')+line.trim(); continue; }
    const indent=match[1].replace(/\t/g,'    ').length, parsed=quickParse(match[3]);
    const task={...newTask(parsed.title || 'Untitled'),...parsed,id:uid(),done:match[2].toLowerCase()==='x'};
    while(stack.length && stack[stack.length-1].indent >= indent) stack.pop();
    if(stack.length) stack[stack.length-1].task.children.push(task); else tasks.push(task);
    stack.push({indent,task});
  }
  return tasks;
}
export function exportMarkdown(tasks) {
  const lines=['# Together — todos',''];
  function emit(task,depth) {
    const text=[task.title,task.priority ? `!${task.priority}`:'',task.due ? `@${task.due}`:'',task.tags?.length ? `:${task.tags.join(',')}:`:''].filter(Boolean).join(' ');
    lines.push(`${'  '.repeat(depth)}- [${task.done?'x':' '}] ${text}`);
    if (task.notes) lines.push(...task.notes.split('\n').map(n => '  '.repeat(depth+1)+n));
    (task.children || []).forEach(c => emit(c,depth+1));
  }
  tasks.forEach(t=>emit(t,0)); return lines.join('\n')+'\n';
}
export function newTask(title='') { return {title,done:false,due:'',priority:0,tags:[],assignee:'both',repeat:'',notes:'',children:[],completedCount:0,lastCompleted:'',link:''}; }
export function newItem(title='') { return {title,done:false,quantity:1,unit:'pcs',category:'Other',list:'Groceries',placeId:'',due:'',price:0,assignee:'both',notes:'',favorite:false}; }
export const defaultSettings = () => ({title:'Our little home',person1:'Me',person2:'My partner',currency:'EUR',budget:100});

export function berlinDateTime(now=new Date()) {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function appointmentUTC(value) {
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)||!parseDate(value.slice(0,10))||Number(value.slice(11,13))>23||Number(value.slice(14))>59)throw new Error('Enter a valid appointment date and time.');
  const wall=Date.parse(value+'Z');
  // Try summer time first: an ambiguous autumn hour means its first occurrence.
  for(const offset of [120,60]){const date=new Date(wall-offset*60000);if(berlinDateTime(date)===value)return date;}
  throw new Error('This time does not exist in Europe/Berlin because the clocks change.');
}
export function appointmentOnDate(data,date) {return data.status!=='cancelled'&&data.start<addDays(date,1)+'T00:00'&&data.end>date+'T00:00';}
export function newAppointment(){const date=berlinDateTime().slice(0,10);return {title:'',start:date+'T09:00',end:date+'T10:00',allDay:false,assignee:'both',location:'',description:'',status:'confirmed'};}
export function validateFile(file) {
  if(!file||!/^[a-zA-Z0-9_-]{8,80}$/.test(file.id||'')||typeof file.name!=='string'||!file.name.trim()||file.name.length>240||typeof file.type!=='string'||file.type.length>150||!Number.isInteger(file.size)||file.size<1||file.size>20*1024*1024||!/^[a-f0-9]{64}$/.test(file.sha256||''))throw new Error('Invalid file attachment.');
  return {id:file.id,name:file.name,type:file.type,size:file.size,sha256:file.sha256,searchable:!!file.searchable};
}

// The same allowlist validates browser imports and every API write.
export function validateRecord(kind, value) {
  if (!KINDS.includes(kind) || !value || typeof value!=='object' || Array.isArray(value)) throw new Error('Invalid record');
  function str(key,max=200,required=false) { const v=value[key] ?? ''; if(typeof v!=='string' || v.length>max || (required && !v.trim())) throw new Error(`Invalid ${key}`); return v.trim(); }
  function number(key,min,max,fallback=0) { const v=value[key] ?? fallback; if(typeof v!=='number' || !Number.isFinite(v) || v<min || v>max) throw new Error(`Invalid ${key}`); return v; }
  function bool(key) { const v=value[key] ?? false; if(typeof v!=='boolean') throw new Error(`Invalid ${key}`); return v; }
  function one(key,options,fallback='') {const v=value[key] ?? fallback; if(!options.includes(v)) throw new Error(`Invalid ${key}`); return v;}
  function date(key) {const v=str(key,10); if(v && !parseDate(v)) throw new Error(`Invalid ${key}`); return v;}
  function url(key) {const v=str(key,2000); if(v && !/^https?:\/\//i.test(v)) throw new Error('Links must start with https:// or http://'); if(v) {try {new URL(v);} catch {throw new Error('Invalid URL');}} return v;}
  if(kind==='settings') {
    const currency=str('currency',3,true); try {new Intl.NumberFormat('en',{style:'currency',currency});} catch {throw new Error('Invalid currency');}
    return {title:str('title',80,true),person1:str('person1',40,true),person2:str('person2',40,true),currency,budget:number('budget',0,1000000)};
  }
  const title=str('title',200,true);
  if(kind==='appointment') {
    const start=str('start',16,true),end=str('end',16,true),allDay=bool('allDay');appointmentUTC(start);appointmentUTC(end);
    if(end<=start)throw new Error('The appointment must end after it starts.');
    if(allDay&&(!start.endsWith('T00:00')||!end.endsWith('T00:00')))throw new Error('All-day appointments use midnight boundaries.');
    return {title,start,end,allDay,assignee:one('assignee',['both','person1','person2'],'both'),location:str('location',500),description:str('description',10000),status:one('status',['confirmed','tentative','cancelled'],'confirmed')};
  }
  if(kind==='damage'||kind==='document') {
    if(!Array.isArray(value.files)||!value.files.length||value.files.length>20)throw new Error('Attach between 1 and 20 files per entry.');
    const files=value.files.map(validateFile);if(new Set(files.map(f=>f.id)).size!==files.length)throw new Error('Duplicate attachments.');
    if(kind==='damage'&&files.some(f=>!['image/jpeg','image/png','image/webp'].includes(f.type)))throw new Error('Damage photos must be JPEG, PNG or WebP.');
    const description=str('description',10000),recordDate=date('date');if(!recordDate)throw new Error('Choose a date.');
    if(kind==='damage')return {title,description,date:recordDate,files,room:str('room',100),status:one('status',['open','reported','fixed'],'open')};
    const labels=value.labels||[];if(!Array.isArray(labels)||labels.length>20||labels.some(l=>typeof l!=='string'||!l.trim()||l.length>60))throw new Error('Use up to 20 labels, each at most 60 characters.');
    return {title,description,date:recordDate,files,labels:[...new Set(labels.map(l=>l.trim()))]};
  }
  if(kind==='secret') {
    const encrypted=value.encrypted;
    if(!encrypted || encrypted.v!==1 || encrypted.iterations!==600000 || !/^[A-Za-z0-9+/]{22}==$/.test(encrypted.salt || '') || !/^[A-Za-z0-9+/]{16}$/.test(encrypted.iv || '') || !/^[A-Za-z0-9+/]+={0,2}$/.test(encrypted.cipher || '') || encrypted.cipher.length<24 || encrypted.cipher.length>50000) throw new Error('Invalid encrypted secret');
    return {title,encrypted:{v:1,iterations:600000,salt:encrypted.salt,iv:encrypted.iv,cipher:encrypted.cipher}};
  }
  if(kind==='place') {
    const lat=value.lat ?? null,lon=value.lon ?? null;
    if((lat===null)!==(lon===null) || (lat!==null && (typeof lat!=='number'||typeof lon!=='number'||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180))) throw new Error('Enter both valid latitude and longitude');
    return {title,address:str('address',500),notes:str('notes',10000),lat,lon,link:url('link')};
  }
  if(kind==='note') return {title,body:str('body',20000),pinned:bool('pinned')};
  const shared={title,done:bool('done'),due:date('due'),assignee:one('assignee',['both','person1','person2'],'both'),notes:str('notes',10000)};
  if(kind==='item') return {...shared,quantity:number('quantity',0.001,1000000,1),unit:str('unit',30),category:one('category',CATEGORIES,'Other'),list:str('list',80,true),placeId:str('placeId',80),price:number('price',0,1000000),favorite:bool('favorite')};
  const tags=value.tags ?? [];
  if(!Array.isArray(tags)||tags.length>20||tags.some(t=>typeof t!=='string'||!/^[^\s,:]{1,40}$/.test(t))) throw new Error('Use up to 20 short labels without spaces');
  let count=0;
  function children(items,depth=0) {
    if(!Array.isArray(items)||depth>12) throw new Error('Too many subtask levels');
    return items.map(c=>{if(++count>200||!c||typeof c.id!=='string'||c.id.length>80||typeof c.title!=='string'||!c.title.trim()||c.title.length>200||typeof c.done!=='boolean') throw new Error('Invalid subtasks');
      const sub=validateRecord('task',{...newTask(),...c,children:[]});
      return {...sub,id:c.id,children:children(c.children || [],depth+1)};});
  }
  return {...shared,priority:one('priority',[0,1,2,3],0),tags:[...new Set(tags)],repeat:one('repeat',['','daily','weekly','monthly']),children:children(value.children ?? []),completedCount:number('completedCount',0,1000000),lastCompleted:date('lastCompleted'),link:url('link')};
}

export function calendarExport(records) {
  const escape=s=>String(s).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Together//Shared life//EN','CALSCALE:GREGORIAN'];
  for(const r of records.filter(r=>(['task','item'].includes(r.kind)&&r.data.due||r.kind==='appointment'&&r.data.status!=='cancelled')&&!r.deleted)) {
    const d=r.data;
    if(r.kind==='appointment') {
      const stamp=value=>appointmentUTC(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
      lines.push('BEGIN:VEVENT',`UID:${r.id}@together`,`DTSTAMP:${stamp(berlinDateTime())}`,...(d.allDay?[`DTSTART;VALUE=DATE:${d.start.slice(0,10).replace(/-/g,'')}`,`DTEND;VALUE=DATE:${d.end.slice(0,10).replace(/-/g,'')}`]:[`DTSTART:${stamp(d.start)}`,`DTEND:${stamp(d.end)}`]),`SUMMARY:${escape(d.title)}`,`LOCATION:${escape(d.location)}`,`DESCRIPTION:${escape(d.description)}`,'END:VEVENT');continue;
    }
    lines.push('BEGIN:VEVENT',`UID:${r.id}@together`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,`DTSTART;VALUE=DATE:${d.due.replace(/-/g,'')}`,`DTEND;VALUE=DATE:${addDays(d.due,1).replace(/-/g,'')}`,`SUMMARY:${escape((d.done?'✓ ':'')+d.title)}`,`DESCRIPTION:${escape(d.notes||'')}`,'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  // Fold at 75 UTF-8 octets (RFC 5545), including continuation spaces.
  return lines.map(line=>{let out='',width=0; for(const ch of line){const n=new TextEncoder().encode(ch).length;if(width+n>75){out+='\r\n ';width=1;}out+=ch;width+=n;}return out;}).join('\r\n')+'\r\n';
}
