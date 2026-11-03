import {validateRecord,validateFile,KINDS} from './core.js';

const API='https://api.github.com';
const STATE='together/state.json';
const MAX_STATE=8*1024*1024;
const fail=(message,status=400,extra={})=>{throw Object.assign(new Error(message),{status,...extra});};
export const encodeBytes=bytes=>{let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(text);};
export const decodeBytes=text=>Uint8Array.from(atob(text.replace(/\s/g,'')),c=>c.charCodeAt(0));
export const checksum=async(bytes,algorithm='SHA-256')=>Array.from(new Uint8Array(await crypto.subtle.digest(algorithm,bytes)),b=>b.toString(16).padStart(2,'0')).join('');
export async function gitBlobSHA(bytes){const header=new TextEncoder().encode(`blob ${bytes.length}\0`),all=new Uint8Array(header.length+bytes.length);all.set(header);all.set(bytes,header.length);return checksum(all,'SHA-1');}
export function githubConfig(input){
  const repo=String(input.repo||'').trim().replace(/^https:\/\/github\.com\//i,'').replace(/\/$/,'').replace(/\.git$/,'');
  if(!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(repo)||['.','..'].includes(repo.split('/')[1]))fail('Enter the private repository as owner/repository.');
  const branch=String(input.branch||'main').trim();
  if(!branch||branch.length>200||/[\s~^:?*\[\\]/.test(branch)||branch.includes('..')||branch.includes('@{')||branch.includes('//')||branch.split('/').some(p=>!p||p.startsWith('.')||p.endsWith('.lock'))||branch.endsWith('.'))fail('Enter a valid Git branch name.');
  const token=String(input.token||'').trim();if(!token||/[\r\n]/.test(token))fail('Enter your GitHub access token.');
  const label=String(input.label||'This device').trim().slice(0,80)||'This device';
  return {repo,branch,token,label,readOnly:!!input.readOnly};
}
export function emptyState(){return {format:'together-github',version:1,records:[],activity:[],receipts:[]};}
export function validateState(value){
  if(value?.format!=='together-github'||value.version!==1||!Array.isArray(value.records)||value.records.length>20000||!Array.isArray(value.receipts)||!Array.isArray(value.activity))fail('The household data file has an unsupported format. Restore a backup before editing.');
  const ids=new Set();
  const records=value.records.map(record=>{
    if(!record||!/^[\w-]{8,80}$/.test(record.id)||ids.has(record.id)||(record.kind==='settings')!==(record.id==='household')||!Number.isInteger(record.version)||record.version<1||typeof record.deleted!=='boolean'||!KINDS.includes(record.kind))fail('The household data contains an invalid record.');
    ids.add(record.id);const data=record.deleted?{}:validateRecord(record.kind,record.data);
    return {...record,data:record.deleted?{}:data};
  });
  if(value.receipts.length>2000||value.receipts.some(r=>!r||!/^[\w-]{8,80}$/.test(r.id)||!/^[a-f0-9]{64}$/.test(r.hash)||!Number.isInteger(r.version)||r.version<1)||value.activity.length>50||value.activity.some(r=>!r||typeof r.actor!=='string'||typeof r.message!=='string'||!Number.isFinite(Date.parse(r.created_at))))fail('The household data contains invalid activity or retry information.');
  return {...value,records};
}
// One Contents API file provides Git's compare-and-swap protection for household edits.
// Originals and extracted text are separate ordinary files in the same private repository.
export class GitHub {
  constructor(config,fetcher=globalThis.fetch.bind(globalThis)){this.config=githubConfig(config);this.fetcher=fetcher;this.root=`/repos/${this.config.repo}`;this.textCache=new Map();this.serial=Promise.resolve();this.etag='';this.snapshot=null;this.repository=null;}
  async request(path,{method='GET',body,accept='application/vnd.github+json',headers={},allowMissing=false,allowUnchanged=false}={}){
    // No configurable API host, redirects, download_url requests, or tokens in query strings.
    if(!path.startsWith(this.root+'/')&&path!==this.root)fail('Invalid GitHub request.');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
    try{
      const response=await this.fetcher(API+path,{method,headers:{Accept:accept,Authorization:'Bearer '+this.config.token,'X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined,credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal});
      if(response.ok||(allowMissing&&response.status===404)||(allowUnchanged&&response.status===304))return response;
      const data=await response.json().catch(()=>({})),status=response.status;
      if(status===401)fail('GitHub rejected this token. It may have expired or been revoked. Connect with a valid token.',401);
      if(status===403||status===429){const limited=response.headers.get('X-RateLimit-Remaining')==='0'||/rate limit|abuse/i.test(data.message||'');fail(limited?'GitHub has temporarily limited requests. Your edits are saved on this device; try syncing later.':'GitHub denied this action. Check Contents permission, token approval and branch protection.',status);}
      if(status===404)fail('Repository or branch not found, or this token cannot access it.',404);
      fail(`GitHub could not save this change (${status}). ${String(data.message||'').slice(0,220)}`,status);
    }finally{clearTimeout(timer);}
  }
  contentPath(path){return this.root+'/contents/'+path.split('/').map(encodeURIComponent).join('/');}
  async verify(){
    const repository=await(await this.request(this.root)).json();
    if(repository.private!==true)fail('Choose a private data repository. Public repositories cannot hold your household documents.',403);
    this.repository=repository;
    await this.request(this.root+'/branches/'+encodeURIComponent(this.config.branch));
    return this.key();
  }
  key(){return {name:this.config.label,role:this.config.readOnly||this.repository?.permissions?.push===false?'viewer':'member'};}
  async metadata(path,allowMissing=false,ref=this.config.branch,headers={}){const response=await this.request(this.contentPath(path)+'?ref='+encodeURIComponent(ref),{accept:'application/vnd.github.object+json',allowMissing,allowUnchanged:true,headers});if(response.status===404)return null;if(response.status===304)return {unchanged:true};const data=await response.json();if(data.type!=='file'||!data.sha)fail('A household file path is not a regular file.');return {...data,etag:response.headers.get('ETag')||''};}
  async bytesAtSHA(sha){
    if(!/^[a-f0-9]{40,64}$/.test(sha))fail('Invalid Git object identifier.');
    const data=await(await this.request(this.root+'/git/blobs/'+sha)).json();
    if(data.encoding!=='base64')fail('GitHub returned an unsupported file encoding.');return decodeBytes(data.content);
  }
  async readState(force=false){
    const file=await this.metadata(STATE,true,this.config.branch,!force&&this.etag?{'If-None-Match':this.etag}:{});
    if(file?.unchanged&&this.snapshot)return structuredClone(this.snapshot);
    if(!file){this.etag='';this.snapshot={sha:null,data:emptyState()};return structuredClone(this.snapshot);}
    if(file.size>MAX_STATE)fail('The household record file exceeds 8 MB. Export and archive older records before continuing.');
    const bytes=file.encoding==='base64'?decodeBytes(file.content):await this.bytesAtSHA(file.sha);
    if(bytes.length>MAX_STATE)fail('The household record file exceeds 8 MB.');
    let data;try{data=validateState(JSON.parse(new TextDecoder().decode(bytes)));}catch(e){fail('Cannot read household data: '+e.message);}
    this.etag=file.etag;this.snapshot={sha:file.sha,data};return structuredClone(this.snapshot);
  }
  async state(){await this.verify();const snapshot=await this.readState();return {...snapshot.data,key:this.key()};}
  enqueue(fn){const task=this.serial.then(fn);this.serial=task.catch(()=>{});return task;}
  async put(path,bytes,sha,message){return(await this.request(this.contentPath(path),{method:'PUT',body:{message,content:encodeBytes(bytes),branch:this.config.branch,...(sha?{sha}:{})}})).json();}
  change(op){return this.enqueue(async()=>{
    await this.verify();if(this.key().role==='viewer')fail('This connection is read-only.',403);
    if(!/^[\w-]{8,80}$/.test(op.opId)||!/^[\w-]{8,80}$/.test(op.id)||(op.kind==='settings')!==(op.id==='household')||!Number.isInteger(op.expectedVersion)||op.expectedVersion<0||typeof op.deleted!=='boolean')fail('Invalid household change.');
    if(op.deleted&&op.kind==='settings')fail('Household settings cannot be deleted.');
    const data=op.deleted?{}:validateRecord(op.kind,op.data),hash=await checksum(new TextEncoder().encode(JSON.stringify(op)));
    for(let attempt=0;attempt<5;attempt++){
      const snapshot=await this.readState(true),state=snapshot.data,prior=state.receipts.find(r=>r.id===op.opId);
      if(prior){if(prior.hash!==hash)fail('This change ID was already used for another edit.',409);return {version:prior.version};}
      const current=state.records.find(r=>r.id===op.id);
      if(current&&current.kind!==op.kind)fail('A record cannot change its type.');
      if((current?.version||0)!==op.expectedVersion)fail('This item changed on another device.',409,{current:current||null});
      const at=new Date().toISOString(),version=op.expectedVersion+1,record={id:op.id,kind:op.kind,data,version,deleted:op.deleted,updated_at:at,updated_by:this.config.label};
      state.records=state.records.filter(r=>r.id!==op.id);state.records.push(record);
      if(state.records.length>20000)fail('This household has reached 20,000 records.');
      state.activity.unshift({id:op.opId,actor:this.config.label,message:`${op.deleted?'Deleted':current?'Updated':'Added'} ${op.kind}: ${data.title||current?.data.title||'Household'}`,created_at:at});state.activity=state.activity.slice(0,50);
      state.receipts.push({id:op.opId,hash,version});state.receipts=state.receipts.slice(-2000);
      const bytes=new TextEncoder().encode(JSON.stringify(state,null,2)+'\n');if(bytes.length>MAX_STATE)fail('This edit would exceed the 8 MB record-file limit.');
      try{const result=await this.put(STATE,bytes,snapshot.sha,`Together: ${op.deleted?'delete':'save'} ${op.kind}`);this.etag='';this.snapshot={sha:result.content.sha,data:state};return {version};}
      catch(e){if((e.status===409||e.status===422)&&attempt<4)continue;throw e;}
    }
  });}
  filePath(file){validateFile(file);if(/[\x00-\x1f\x7f/\\]/.test(file.name)||['.','..'].includes(file.name))fail('Invalid filename.');return `together/files/${file.id}/${file.name}`;}
  upload(file,id){return this.enqueue(async()=>{
    await this.verify();if(this.key().role==='viewer')fail('This connection is read-only.',403);
    if(!file.size||file.size>20*1024*1024)fail('Choose a non-empty file no larger than 20 MB.');
    const bytes=new Uint8Array(await file.arrayBuffer()),descriptor=validateFile({id,name:file.name,type:file.type||'application/octet-stream',size:bytes.length,sha256:await checksum(bytes)}),path=this.filePath(descriptor),sha=await gitBlobSHA(bytes);
    for(let attempt=0;attempt<3;attempt++){
      const existing=await this.metadata(path,true);
      if(existing){if(existing.sha!==sha)fail('This original file already exists with different contents.',409);return descriptor;}
      try{await this.put(path,bytes,null,'Together: add original file');return descriptor;}catch(e){if(![409,422].includes(e.status)||attempt===2)throw e;}
    }
  });}
  async download(file){
    await this.verify();const path=this.filePath(file),meta=await this.metadata(path);
    if(meta.size!==file.size)fail('This original does not match its saved checksum. Check the repository history or restore a backup.');
    const bytes=meta.encoding==='base64'?decodeBytes(meta.content):await this.bytesAtSHA(meta.sha);
    if(bytes.length!==file.size||await checksum(bytes)!==file.sha256)fail('This original does not match its saved checksum. Check the repository history or restore a backup.');
    return new Blob([bytes],{type:file.type});
  }
  index(file,text){return this.enqueue(async()=>{
    await this.verify();if(this.key().role==='viewer')fail('This connection is read-only.',403);validateFile(file);
    const bytes=new TextEncoder().encode(text),path=`together/text/${file.id}.txt`;if(bytes.length>200000)fail('Extracted text exceeds 200 KB.');
    for(let attempt=0;attempt<3;attempt++){const existing=await this.metadata(path,true);if(existing?.sha===await gitBlobSHA(bytes)){this.textCache.set(file.id,text);return;}
      try{await this.put(path,bytes,existing?.sha,'Together: save document search text');this.textCache.set(file.id,text);return;}catch(e){if(![409,422].includes(e.status)||attempt===2)throw e;}
    }
  });}
  async text(file){validateFile(file);if(this.textCache.has(file.id))return this.textCache.get(file.id);const meta=await this.metadata(`together/text/${file.id}.txt`,true);if(!meta)return '';if(meta.size>200000)fail('Document search text exceeds its size limit.');const bytes=meta.encoding==='base64'?decodeBytes(meta.content):await this.bytesAtSHA(meta.sha),text=new TextDecoder().decode(bytes);this.textCache.set(file.id,text);return text;}
  async search(query,records){
    await this.verify();const norm=s=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase(),terms=norm(query).trim().split(/\s+/).filter(Boolean),files=[...new Map(records.flatMap(r=>r.data.files.filter(f=>f.searchable)).map(f=>[f.id,f])).values()],matches=[];
    if(!terms.length)return matches;
    // Keep request concurrency low; originals never need downloading to search their text.
    for(let i=0;i<files.length;i+=3)await Promise.all(files.slice(i,i+3).map(async file=>{const text=await this.text(file),normalized=norm(text);if(terms.every(t=>normalized.includes(t))){const at=normalized.indexOf(terms[0]);matches.push({id:file.id,snippet:text.slice(Math.max(0,at-60),at+180)});}}));
    return matches;
  }
}
