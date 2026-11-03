export const PREVIEW_THRESHOLD=64*1024;
const TYPES=['image/jpeg','image/png','image/webp'];
export const isPhoto=file=>TYPES.includes(file.type);
export function fitPhoto(width,height,longEdge=1920,shortEdge=1080){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1)throw new Error('Invalid image dimensions.');
  const scale=Math.min(1,longEdge/Math.max(width,height),shortEdge/Math.min(width,height));
  return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
async function encode(bitmap,width,height,type,quality,white=false){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  try{
    const context=canvas.getContext('2d');if(!context)throw new Error('Image processing is unavailable.');
    if(white){context.fillStyle='#fff';context.fillRect(0,0,width,height);}
    context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(bitmap,0,0,width,height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,type,quality));
    if(!blob)throw new Error('Could not encode this image.');return blob;
  }finally{canvas.width=canvas.height=1;}
}
async function bitmapFor(file){
  const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
  if(bitmap.width*bitmap.height>60000000){bitmap.close();throw new Error('Image exceeds 60 megapixels.');}
  return bitmap;
}
async function thumbnailFrom(bitmap){
  const size=fitPhoto(bitmap.width,bitmap.height,640,640);
  const blob=await encode(bitmap,size.width,size.height,'image/jpeg',.72,true);
  if(blob.size>200000)throw new Error('Preview exceeds its size limit.');
  return blob;
}
export async function createThumbnail(file){
  if(!isPhoto(file))return null;
  const bitmap=await bitmapFor(file);try{return await thumbnailFrom(bitmap);}finally{bitmap.close();}
}
export async function preparePhoto(file,{optimize=true}={}){
  if(!isPhoto(file))return {file,thumbnail:null,optimized:false};
  const bitmap=await bitmapFor(file);
  try{
    let stored=file;
    if(optimize){
      const size=fitPhoto(bitmap.width,bitmap.height);
      let blob=await encode(bitmap,size.width,size.height,'image/webp',.78);
      // Some browsers fall back to PNG. JPEG inputs can safely use JPEG instead.
      if(blob.type!=='image/webp'&&file.type==='image/jpeg')blob=await encode(bitmap,size.width,size.height,'image/jpeg',.8,true);
      if(blob.size<file.size){
        const extension={'image/webp':'webp','image/jpeg':'jpg','image/png':'png'}[blob.type];
        if(extension)stored=new File([blob],file.name.replace(/\.[^.]+$/,'').slice(0,220)+'.'+extension,{type:blob.type,lastModified:file.lastModified});
      }
    }
    // Small files are already inexpensive to load; avoid adding a larger preview.
    const thumbnail=file.size>PREVIEW_THRESHOLD?await thumbnailFrom(bitmap):null;
    return {file:stored,thumbnail,optimized:stored!==file};
  }finally{bitmap.close();}
}
