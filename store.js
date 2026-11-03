import {GitHub,githubConfig} from './github.js';
import { uid, validateRecord, today, addDays, newTask, newItem, defaultSettings } from './core.js';

export const storagePrefix=`together:${new URL('.',location.href).pathname}:`;
export function readLocal(key,fallback) {try{return JSON.parse(localStorage.getItem(storagePrefix+key)) ?? fallback;}catch{return fallback;}}
export function writeLocal(key,value) {localStorage.setItem(storagePrefix+key,JSON.stringify(value));}
export function credentials() {
  const config=readLocal('connection',null);
  if(!config) return null;
  let session=null;try{session=JSON.parse(sessionStorage.getItem(storagePrefix+'session'));}catch{}
  return {...config,token:session?.token || config.token || ''};
}
export function saveCredentials(config,remember) {
  writeLocal('connection',{...config,token:remember?config.token:''});
  sessionStorage.setItem(storagePrefix+'session',JSON.stringify({token:config.token}));
}
export function forgetCredentials() {localStorage.removeItem(storagePrefix+'connection');sessionStorage.removeItem(storagePrefix+'session');}
export class Store extends EventTarget {
  constructor(){super();this.base=[];this.pending=[];this.activity=[];this.key=null;this.state='disconnected';this.error='';this.conflict=null;this.running=null;this.demo=false;this.cacheKey='';this.config=null;this.generation=0;this.ownsLock=true;this.releaseLock=null;
    globalThis.addEventListener?.('storage',event=>{if(!this.ownsLock&&event.key===storagePrefix+this.cacheKey&&event.newValue){try{const cached=JSON.parse(event.newValue);this.base=cached.base;this.pending=cached.pending;this.activity=cached.activity;this.key=cached.key;this.emit();}catch{}}});
  }
  emit(){this.dispatchEvent(new Event('change'));}
  get records(){const result=new Map(this.base.map(r=>[r.id,r]));for(const p of this.pending) result.set(p.id,{id:p.id,kind:p.kind,data:p.data,deleted:p.deleted,version:p.expectedVersion+1,updated_at:p.at,updated_by:this.key?.name||'You'});return [...result.values()].filter(r=>!r.deleted);}
  get(id){return this.records.find(r=>r.id===id);}
  list(kind){return this.records.filter(r=>r.kind===kind);}
  version(id){const p=this.pending.filter(p=>p.id===id).at(-1);return p?p.expectedVersion+1:this.base.find(r=>r.id===id)?.version||0;}
  get settings(){return this.get('household')?.data || defaultSettings();}
  get canWrite(){return !!this.key&&this.key.role!=='viewer'&&this.ownsLock;}
  persist(){if(this.cacheKey&&this.ownsLock)writeLocal(this.cacheKey,{base:this.base,pending:this.pending,activity:this.activity,key:this.key});}
  async claimTab(){
    if(this.releaseLock&&this.lockedCache===this.cacheKey)return;
    this.releaseLock?.();this.releaseLock=null;this.ownsLock=true;
    if(!globalThis.navigator?.locks)return;
    this.ownsLock=await new Promise(resolve=>{
      navigator.locks.request(storagePrefix+this.cacheKey,{ifAvailable:true},async lock=>{
        if(!lock){resolve(false);return;}
        await new Promise(release=>{this.releaseLock=release;this.lockedCache=this.cacheKey;resolve(true);});
      }).catch(()=>resolve(false));
    });
  }
  async connect(config,{verify=true}={}) {
    config=githubConfig(config);this.generation++;this.config=config;this.github=new GitHub(config);this.demo=false;this.conflict=null;this.error='';
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('github|'+config.repo.toLowerCase()+'|'+config.branch+'|'+config.token));
    this.cacheKey='cache:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    await this.claimTab();
    const cached=readLocal(this.cacheKey,null);
    this.base=cached?.base||[];this.pending=cached?.pending||[];this.activity=cached?.activity||[];this.key=cached?.key||null;
    this.state='syncing';
    if(verify){const data=await this.api('/state');this.base=data.records;this.activity=data.activity;this.key=data.key;this.persist();}
    if(!this.ownsLock){this.state='secondary';this.emit();return;}
    this.emit();await this.sync();
  }
  async api(path,method='GET',data) {
    if(path==='/state')return this.github.state();
    if(path==='/records'&&method==='POST')return this.github.change(data);
    throw new Error('Unsupported GitHub operation.');
  }
  change(kind,id,data,deleted=false) {
    if(!this.ownsLock)throw new Error('This connection is open in another tab. Close that tab and reload this one to edit here.');
    if(!this.canWrite)throw new Error('This access key is read-only.');
    const valid=deleted?{}:validateRecord(kind,data),before=this.get(id);
    const op={opId:uid(),id,kind,data:valid,deleted,expectedVersion:this.version(id),at:new Date().toISOString()};
    const pending=this.pending;this.pending=[...pending,op];
    try{this.persist();}catch{this.pending=pending;throw new Error('Device storage is full or unavailable. Your change was not saved. Export a backup or free storage.');}
    if(this.demo){this.base=this.records;this.pending=[];this.activity.unshift({id:uid(),actor:'You',message:`${deleted?'Deleted':before?'Updated':'Added'} ${kind}: ${valid.title||before?.data.title||'Household'}`,created_at:op.at});this.persist();}
    this.emit();clearTimeout(this.timer);this.timer=setTimeout(()=>this.sync(),350);
    return ()=>this.change(kind,id,before?.data||{},!before);
  }
  async sync() {
    if(this.demo||!this.config||this.conflict||!this.ownsLock)return;
    if(this.running)return this.running;
    const generation=this.generation;
    this.running=(async()=>{
      this.state='syncing';this.error='';this.emit();
      try {
        while(this.pending.length) {
          const op=this.pending[0];
          try {
            const response=await this.api('/records','POST',op);
            if(generation!==this.generation)return;
            this.base=this.base.filter(r=>r.id!==op.id);
            this.base.push({id:op.id,kind:op.kind,data:op.data,version:response.version,deleted:op.deleted,updated_at:op.at,updated_by:this.key?.name});
            this.pending=this.pending.filter(p=>p.opId!==op.opId);this.persist();
          }catch(e){if(e.status===409){this.conflict={op,current:e.current||null};}throw e;}
        }
        const response=await this.api('/state');if(generation!==this.generation)return;
        this.base=response.records;this.activity=response.activity;this.key=response.key;this.state='synced';this.persist();
      }catch(e){if(generation!==this.generation)return;this.error=e.message;this.state=e.status===401?'locked':this.conflict?'conflict':e.status?'error':'offline';}
      finally{if(generation===this.generation)this.emit();}
    })();
    await this.running;this.running=null;
    if(this.state==='synced'&&this.pending.length)this.sync();
  }
  resolve(keepMine) {
    if(!this.conflict)return;
    const {op,current}=this.conflict,last=this.pending.filter(p=>p.id===op.id).at(-1);
    this.base=this.base.filter(r=>r.id!==op.id);if(current)this.base.push(current);
    this.pending=this.pending.filter(p=>p.id!==op.id);this.conflict=null;
    if(keepMine)this.pending.push({...last,opId:uid(),expectedVersion:current?.version||0});
    this.persist();this.emit();this.sync();
  }
  disconnect(clear=true) {
    this.generation++;clearTimeout(this.timer);if(clear&&this.cacheKey&&this.ownsLock)localStorage.removeItem(storagePrefix+this.cacheKey);this.releaseLock?.();this.releaseLock=null;this.ownsLock=true;
    this.config=null;this.github=null;this.base=[];this.pending=[];this.activity=[];this.key=null;this.conflict=null;this.cacheKey='';this.state='disconnected';this.demo=false;this.emit();
  }
  startDemo() {
    this.releaseLock?.();this.releaseLock=null;this.ownsLock=true;
    this.generation++;this.demo=true;this.config=null;this.cacheKey='demo';this.key={name:'You',role:'admin'};this.state='demo';this.error='';this.conflict=null;
    const cached=readLocal('demo',null);
    if(cached){this.base=cached.base;this.pending=[];this.activity=cached.activity||[];this.emit();return;}
    const rec=(kind,data,id=uid())=>({id,kind,data,version:1,deleted:false,updated_at:new Date().toISOString(),updated_by:'You'});
    const shop=uid();
    this.base=[
      rec('settings',{...defaultSettings(),person1:'Alex',person2:'Jamie'},'household'),
      rec('task',{...newTask('Plan our weekend away'),due:addDays(today(),2),priority:2,tags:['together'],assignee:'both',children:[{...newTask('Pick somewhere by the sea'),id:uid(),done:true},{...newTask('Find a cosy place to stay'),id:uid()}]}),
      rec('task',{...newTask('Water our green friends'),due:today(),repeat:'weekly',assignee:'person1',tags:['home']}),
      rec('task',{...newTask('Book a table for Friday'),due:today(),priority:1,assignee:'person2',tags:['date-night']}),
      rec('task',{...newTask('Sort the hallway shelf'),due:addDays(today(),4),assignee:'both',tags:['home']}),
      rec('item',{...newItem('Cherry tomatoes'),quantity:500,unit:'g',price:0.006,category:'Produce',placeId:shop,due:today()}),
      rec('item',{...newItem('Oat milk'),quantity:2,unit:'cartons',price:2.29,category:'Dairy & eggs',placeId:shop,favorite:true}),
      rec('item',{...newItem('Sourdough bread'),price:4.5,category:'Bakery',placeId:shop}),
      rec('item',{...newItem('Fresh tulips'),price:6,category:'Other',due:addDays(today(),1),assignee:'person1'}),
      rec('place',{title:'The neighbourhood market',address:'Example place · Berlin',lat:52.5246,lon:13.402,notes:'A sample place. Replace it with your own favourite.',link:''},shop),
      rec('note',{title:'A little weekend inspiration',body:'A long walk, a new recipe, and absolutely no alarms.\n\nAdd your ideas here — this is our space.',pinned:true})
    ];this.pending=[];this.activity=[];this.persist();this.emit();
  }
}
