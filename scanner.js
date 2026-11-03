// Local, deterministic document edge detection and perspective correction.
export function validCorners(points){
  if(points.length!==4||points.some(p=>p.some(v=>!Number.isFinite(v)||v<0||v>1)))return false;
  let area=0;for(let i=0;i<4;i++){const a=points[i],b=points[(i+1)%4],c=points[(i+2)%4];if((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0])<=0)return false;area+=a[0]*b[1]-b[0]*a[1];}return area>.04;
}
export function detectCorners({data,width,height}){
  const gray=new Uint8Array(width*height),hist=new Uint32Array(256);for(let i=0;i<gray.length;i++){gray[i]=Math.round(data[i*4]*.299+data[i*4+1]*.587+data[i*4+2]*.114);hist[gray[i]]++;}
  let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];let low=0,sumLow=0,best=0,threshold=150;
  for(let i=0;i<255;i++){low+=hist[i];if(!low)continue;const high=gray.length-low;if(!high)break;sumLow+=i*hist[i];const between=low*high*(sumLow/low-(sum-sumLow)/high)**2;if(between>best){best=between;threshold=i;}}
  const visited=new Uint8Array(gray.length),queue=new Uint32Array(gray.length);let largest=[];
  for(let seed=0;seed<gray.length;seed++){if(visited[seed]||gray[seed]<=Math.max(threshold,70))continue;let read=0,write=1;queue[0]=seed;visited[seed]=1;const region=[];
    while(read<write){const i=queue[read++];region.push(i);const x=i%width;for(const next of [x?i-1:-1,x<width-1?i+1:-1,i-width,i+width])if(next>=0&&next<gray.length&&!visited[next]&&gray[next]>Math.max(threshold,70)){visited[next]=1;queue[write++]=next;}}
    if(region.length>largest.length)largest=region;
  }
  const full=[[.015,.015],[.985,.015],[.985,.985],[.015,.985]];
  if(largest.length<gray.length*.12||largest.length>gray.length*.94)return {points:full,confident:false};
  const corners=[null,null,null,null],scores=[Infinity,-Infinity,-Infinity,Infinity];
  for(const i of largest){const x=i%width,y=Math.floor(i/width),sum=x+y,diff=x-y;for(const [n,s,better]of [[0,sum,sum<scores[0]],[1,diff,diff>scores[1]],[2,sum,sum>scores[2]],[3,diff,diff<scores[3]]])if(better){scores[n]=s;corners[n]=[x/(width-1),y/(height-1)];}}
  return validCorners(corners)?{points:corners,confident:true}:{points:full,confident:false};
}
export function homography(points){
  const [p0,p1,p2,p3]=points,dx1=p1[0]-p2[0],dx2=p3[0]-p2[0],dy1=p1[1]-p2[1],dy2=p3[1]-p2[1],sx=p0[0]-p1[0]+p2[0]-p3[0],sy=p0[1]-p1[1]+p2[1]-p3[1],den=dx1*dy2-dx2*dy1;
  const g=Math.abs(den)>1e-9?(sx*dy2-dx2*sy)/den:0,h=Math.abs(den)>1e-9?(dx1*sy-sx*dy1)/den:0;
  return (u,v)=>{const d=g*u+h*v+1;return [((p1[0]-p0[0]+g*p1[0])*u+(p3[0]-p0[0]+h*p3[0])*v+p0[0])/d,((p1[1]-p0[1]+g*p1[1])*u+(p3[1]-p0[1]+h*p3[1])*v+p0[1])/d];};
}
export class Scanner {
  async load(file,preview){
    const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});if(bitmap.width<10||bitmap.height<10){bitmap.close();throw new Error('Choose an image at least 10 pixels wide and high.');}if(bitmap.width*bitmap.height>60000000){bitmap.close();throw new Error('Choose a photo under 60 megapixels.');}
    const scale=Math.min(1,2400/Math.max(bitmap.width,bitmap.height));this.source=document.createElement('canvas');this.source.width=Math.round(bitmap.width*scale);this.source.height=Math.round(bitmap.height*scale);this.source.getContext('2d').drawImage(bitmap,0,0,this.source.width,this.source.height);bitmap.close();this.canvas=preview;this.detect();
    const coordinates=e=>{const r=preview.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))];};
    preview.onpointerdown=e=>{const p=coordinates(e);this.drag=this.points.reduce((best,v,i)=>Math.hypot(v[0]-p[0],v[1]-p[1])<Math.hypot(this.points[best][0]-p[0],this.points[best][1]-p[1])?i:best,0);preview.setPointerCapture(e.pointerId);this.points[this.drag]=p;this.draw();};
    preview.onpointermove=e=>{if(this.drag===undefined)return;this.points[this.drag]=coordinates(e);this.draw();};preview.onpointerup=preview.onpointercancel=()=>{this.drag=undefined;this.onchange?.();};
  }
  detect(){const small=document.createElement('canvas'),scale=Math.min(1,450/Math.max(this.source.width,this.source.height));small.width=Math.round(this.source.width*scale);small.height=Math.round(this.source.height*scale);const context=small.getContext('2d');context.drawImage(this.source,0,0,small.width,small.height);const result=detectCorners(context.getImageData(0,0,small.width,small.height));this.points=result.points;this.confident=result.confident;this.draw();return result.confident;}
  rotate(){const next=document.createElement('canvas');next.width=this.source.height;next.height=this.source.width;const context=next.getContext('2d');context.translate(next.width,0);context.rotate(Math.PI/2);context.drawImage(this.source,0,0);this.source=next;this.detect();}
  draw(){const canvas=this.canvas;canvas.width=this.source.width;canvas.height=this.source.height;const ctx=canvas.getContext('2d');ctx.drawImage(this.source,0,0);ctx.beginPath();this.points.forEach(([x,y],i)=>i?ctx.lineTo(x*canvas.width,y*canvas.height):ctx.moveTo(x*canvas.width,y*canvas.height));ctx.closePath();ctx.fillStyle='#294f4620';ctx.fill();ctx.strokeStyle='#b8e196';ctx.lineWidth=canvas.width/180;ctx.stroke();this.points.forEach(([x,y],i)=>{ctx.beginPath();ctx.arc(x*canvas.width,y*canvas.height,canvas.width/48,0,Math.PI*2);ctx.fillStyle='#294f46';ctx.fill();ctx.strokeStyle='white';ctx.lineWidth=canvas.width/350;ctx.stroke();ctx.fillStyle='white';ctx.font=`${canvas.width/40}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i+1),x*canvas.width,y*canvas.height);});}
  async scan(mode='clean'){
    if(!validCorners(this.points))throw new Error('Keep the four corners clockwise around the page without crossing.');
    const source=this.source,points=this.points.map(([x,y])=>[x*(source.width-1),y*(source.height-1)]),distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
    const width=Math.round(Math.max(distance(points[0],points[1]),distance(points[3],points[2]))),height=Math.round(Math.max(distance(points[0],points[3]),distance(points[1],points[2]))),out=document.createElement('canvas');out.width=width;out.height=height;
    const src=source.getContext('2d').getImageData(0,0,source.width,source.height).data,ctx=out.getContext('2d'),target=ctx.createImageData(width,height),map=homography(points);
    for(let y=0;y<height;y++){for(let x=0;x<width;x++){const [px,py]=map(x/(width-1),y/(height-1)),sx=Math.max(0,Math.min(source.width-1,px)),sy=Math.max(0,Math.min(source.height-1,py)),ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy,at=(y*width+x)*4;let rgb=[];
      for(let c=0;c<3;c++){const a=src[(iy*source.width+ix)*4+c],b=src[(iy*source.width+Math.min(ix+1,source.width-1))*4+c],d=src[(Math.min(iy+1,source.height-1)*source.width+ix)*4+c],e=src[(Math.min(iy+1,source.height-1)*source.width+Math.min(ix+1,source.width-1))*4+c];rgb[c]=a*(1-fx)*(1-fy)+b*fx*(1-fy)+d*(1-fx)*fy+e*fx*fy;}
      if(mode!=='color'){let gray=rgb[0]*.299+rgb[1]*.587+rgb[2]*.114;if(mode==='clean')gray=Math.max(0,Math.min(255,(gray-35)*255/185));rgb=[gray,gray,gray];}for(let c=0;c<3;c++)target.data[at+c]=rgb[c];target.data[at+3]=255;
    }if(y%80===0)await new Promise(resolve=>requestAnimationFrame(resolve));}
    ctx.putImageData(target,0,0);const blob=await new Promise(resolve=>out.toBlob(resolve,'image/jpeg',.93));if(!blob)throw new Error('Could not create the scan. Try a smaller image.');return {blob,width,height};
  }
}
