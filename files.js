import {uid,validateFile} from './core.js';
const MAX=20*1024*1024;
export async function readSelectedFiles(list){
  const selected=Array.from(list);
  for(const file of selected)if(!file.size||file.size>MAX)throw new Error('Each file must be between 1 byte and 20 MB.');
  // Start every read during the picker event. Mobile/cloud file references can expire
  // before Save is pressed; copying the bytes also makes later indexing independent.
  const results=await Promise.allSettled(selected.map(async file=>{
    try{
      const bytes=await file.arrayBuffer();
      if(bytes.byteLength!==file.size)throw new Error('The selected file changed while reading it.');
      return new File([bytes],file.name,{type:file.type,lastModified:file.lastModified});
    }catch(cause){
      throw new Error(`Could not read “${file.name}” from your device. Choose it again. If it is in Photos, Drive or another cloud app, download a copy to Downloads and select that copy using Upload. File access is controlled by your browser and device; there is no permission switch in this app.`,{cause});
    }
  }));
  // Keep the picker alive until all reads settle, including when one file fails.
  const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  return results.map(result=>result.value);
}
const hash=async buffer=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),b=>b.toString(16).padStart(2,'0')).join('');
function database(){return new Promise((resolve,reject)=>{const req=indexedDB.open('together-demo-files',1);req.onupgradeneeded=()=>req.result.createObjectStore('files');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function demoFile(key,value){const db=await database();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('files',value?'readwrite':'readonly'),store=tx.objectStore('files'),req=value?store.put(value,key):store.get(key);let result;req.onsuccess=()=>result=req.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
export class Files {
  constructor(store){this.store=store;this.urls=new Map();this.generation=store.generation;}
  async upload(file,id=uid()){
    if(!this.store.canWrite)throw new Error('This connection is read-only.');
    if(!file.size||file.size>MAX)throw new Error('Choose a non-empty file no larger than 20 MB.');
    if(this.store.demo){const descriptor=validateFile({id,name:file.name,type:file.type||'application/octet-stream',size:file.size,sha256:await hash(await file.arrayBuffer())});await demoFile(id,{blob:file,text:''});return descriptor;}
    return this.store.github.upload(file,id);
  }
  async blob(file){if(this.store.demo){const entry=await demoFile(file.id);if(!entry)throw new Error('This demo file is no longer on this device.');return entry.blob;}return this.store.github.download(file);}
  async url(file){if(this.generation!==this.store.generation){this.clear();this.generation=this.store.generation;}if(!this.urls.has(file.id)){const generation=this.store.generation;const blob=await this.blob(file);if(generation!==this.store.generation)throw new Error('Connection changed.');this.urls.set(file.id,URL.createObjectURL(blob));}return this.urls.get(file.id);}
  clear(){for(const url of this.urls.values())URL.revokeObjectURL(url);this.urls.clear();}
  async index(file,text){text=new TextDecoder().decode(new TextEncoder().encode(text).slice(0,180000));if(this.store.demo){const entry=await demoFile(file.id);await demoFile(file.id,{...entry,text});}else await this.store.github.index(file,text);return !!text.trim();}
  async text(file){return this.store.demo?(await demoFile(file.id))?.text||'':await this.store.github.text(file);}
  async search(query){if(!this.store.demo)return this.store.github.search(query,this.store.list('document'));
    const matches=[];for(const r of this.store.list('document'))for(const f of r.data.files){const text=await this.text(f);const i=text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());if(i>=0)matches.push({id:f.id,snippet:text.slice(Math.max(0,i-60),i+180)});}return matches;
  }
  async download(file){const url=await this.url(file),a=document.createElement('a');a.href=url;a.download=file.name;a.click();}
}
export async function extractText(file){
  const extension=file.name.split('.').pop().toLowerCase();
  if(['txt','md','csv','json','rtf'].includes(extension))return {text:(await file.text()).slice(0,150000),note:'Text extracted on this device.'};
  if(extension==='docx'){
    const {unzipSync}=await import('./vendor/fflate.mjs');const archive=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:e=>e.name==='word/document.xml'&&e.originalSize<=5*1024*1024});
    if(!archive['word/document.xml'])return {text:'',note:'No supported Word text found. The original is still saved.'};
    const xml=new DOMParser().parseFromString(new TextDecoder().decode(archive['word/document.xml']),'application/xml');
    const text=[...xml.getElementsByTagNameNS('*','p')].map(p=>[...p.getElementsByTagNameNS('*','t')].map(t=>t.textContent).join('')).join('\n');return {text:text.slice(0,150000),note:'Word text extracted on this device.'};
  }
  if(extension==='pdf'||file.type==='application/pdf'){
    const pdfjs=await import('./vendor/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.mjs',import.meta.url).href;
    const loading=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,disableFontFace:true,useSystemFonts:true});
    const timer=setTimeout(()=>loading.destroy(),30000);
    try{const pdf=await loading.promise;let text='';for(let n=1;n<=Math.min(pdf.numPages,150)&&text.length<150000;n++){const page=await pdf.getPage(n),content=await page.getTextContent();text+=content.items.map(i=>i.str+(i.hasEOL?'\n':' ')).join('')+'\n';page.cleanup();}
      return {text:text.slice(0,150000),note:text.trim()?(pdf.numPages>150||text.length>=150000?'Text indexed up to the first 150 pages / 150,000 characters.':'PDF text extracted on this device.'):'This PDF has no text layer. Search it by title, labels and description.'};
    }finally{clearTimeout(timer);await loading.destroy();}
  }
  return {text:'',note:'Searchable by title, labels and description. Image OCR is not enabled.'};
}

// A tiny PDF writer for a scanned JPEG page, keeping document processing local.
export function jpegPDF(jpeg,width,height){
  const enc=new TextEncoder(),chunks=[],offsets=[0];let length=0;const append=v=>{const b=typeof v==='string'?enc.encode(v):v;chunks.push(b);length+=b.length;};
  append('%PDF-1.4\n');const w=595,h=Math.round(w*height/width);
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`];
  for(let i=0;i<objects.length;i++){offsets.push(length);append(`${i+1} 0 obj\n${objects[i]}\nendobj\n`);}
  offsets.push(length);append(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);append(jpeg);append('\nendstream\nendobj\n');
  const content=`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;offsets.push(length);append(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
  const xref=length;append('xref\n0 6\n0000000000 65535 f \n');for(const offset of offsets.slice(1))append(String(offset).padStart(10,'0')+' 00000 n \n');append(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);return new Blob(chunks,{type:'application/pdf'});
}
