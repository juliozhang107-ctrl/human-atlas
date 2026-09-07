// Renders a projection radiograph on the CPU so the beam maths can be checked without a GPU.
// The tube is modelled as a parallel beam, which is the usual approximation at a long source to
// detector distance and keeps the depth interpolation exact. Each triangle is scan converted and
// its distance along the beam is accumulated with a sign: surfaces the beam enters subtract, those
// it leaves add, so a closed mesh contributes exactly its path length multiplied by its
// attenuation coefficient. That is the same quantity the shader accumulates in the browser.
import fs from 'node:fs';
import zlib from 'node:zlib';
import {projection,PROJECTIONS,contributionFor,isEnvelope,tissueFor,TISSUES,displayValue} from '../app/radiograph.ts';

const argv=process.argv.slice(2),opt=(name,fallback)=>{const i=argv.indexOf(`--${name}`);return i<0?fallback:argv[i+1];};
if(argv.includes('--help')){
 console.log(`Usage: node scripts/render-projection.mjs [options]

  --projection ${PROJECTIONS.map(p=>p.id).join('|')}   radiographic projection (default ap)
  --layers surface|internal|skeleton|<systems>   what the beam passes through (default surface)
  --width <px>        detector width in pixels (default 620)
  --supersample <n>   samples per axis before downsampling (default 2)
  --level <v> --window <v>   fixed windowing; omitted means window to the image
  --region full|chest|abdomen|trunk|head|pelvis   collimate the field (default full)
  --out <file>        output PNG (default radiograph-<projection>-<layers>.png)

  surface  the body envelope filled with soft tissue plus every structure inside it
  internal every structure except the envelope, each carrying its own coefficient
  skeleton the skeletal system alone`);
 process.exit(0);
}
const view=projection(opt('projection','ap')),layers=opt('layers','surface'),width=Math.max(64,Math.round(+opt('width',620)));
const ss=Math.min(4,Math.max(1,Math.round(+opt('supersample',2))));
const out=opt('out',`radiograph-${view.id}-${layers.replace(/[^a-z0-9]+/gi,'-')}${opt('region','full')==='full'?'':'-'+opt('region','full')}.png`);

const base=new URL('../public/models/',import.meta.url),atlas=JSON.parse(fs.readFileSync(new URL('atlas.json',base)));
const chunks=atlas.chunks.map(c=>fs.readFileSync(new URL(c.url.split('/').pop(),base)));

const systems=new Set(PROJECTIONS.length&&layers.split(',').map(s=>s.trim()).filter(Boolean));
let parts;
if(layers==='surface')parts=atlas.parts;
else if(layers==='internal')parts=atlas.parts.filter(p=>!isEnvelope(p));
else if(layers==='skeleton')parts=atlas.parts.filter(p=>p.system==='skeletal');
else{parts=atlas.parts.filter(p=>systems.has(p.system));if(!parts.length)throw new Error(`--layers ${layers} selected nothing. Use surface, internal, skeleton, or a comma separated list of system ids.`);}
const envelopePresent=parts.some(isEnvelope);

// Detector frame. The image spans the projected extent of everything being rendered, with a margin.
const [rx,ry,rz]=view.right,[ux,uy,uz]=view.up,[bx,by,bz]=view.beam;
let u0=Infinity,u1=-Infinity,v0=Infinity,v1=-Infinity;
for(const p of parts)for(let corner=0;corner<8;corner++){
 const x=p.bounds[corner&1?1:0][0],y=p.bounds[corner&2?1:0][1],z=p.bounds[corner&4?1:0][2];
 const u=x*rx+y*ry+z*rz,v=x*ux+y*uy+z*uz;
 if(u<u0)u0=u;if(u>u1)u1=u;if(v<v0)v0=v;if(v>v1)v1=v;
}
const margin=.02;u0-=margin;u1+=margin;v0-=margin;v1+=margin;
// Collimation. Named regions cone the beam down the way a real examination restricts the field,
// which also keeps the detector resolution on the anatomy being examined. Heights are in metres
// above the floor and apply to every projection, since each detector frame has up along +y.
const REGIONS={chest:[1.12,1.58,.26],abdomen:[.92,1.32,.24],trunk:[.82,1.60,.30],head:[1.45,1.78,.14],pelvis:[.78,1.10,.24]};
const region=opt('region','full');
if(region!=='full'){
 const bounds=REGIONS[region];
 if(!bounds)throw new Error(`Unknown --region ${region}. Expected full, ${Object.keys(REGIONS).join(', ')}.`);
 const [low,high,half]=bounds;
 v0=Math.max(v0,low);v1=Math.min(v1,high);
 const centre=(u0+u1)/2;u0=Math.max(u0,centre-half);u1=Math.min(u1,centre+half);
 if(v1<=v0||u1<=u0)throw new Error(`--region ${region} does not overlap the rendered anatomy.`);
}
const height=Math.max(64,Math.round(width*(v1-v0)/(u1-u0)));
const W=width*ss,H=height*ss,accum=new Float64Array(W*H);
const scaleU=W/(u1-u0),scaleV=H/(v1-v0);

let triangles=0,rendered=0;
const started=Date.now();
for(const part of parts){
 const mu=contributionFor(part,envelopePresent);
 const buf=chunks[part.chunk];
 const pos=new Float32Array(buf.buffer,buf.byteOffset+part.positions,part.vertexCount*3);
 const nor=new Int16Array(buf.buffer,buf.byteOffset+part.normals,part.vertexCount*3);
 const idx=new Uint32Array(buf.buffer,buf.byteOffset+part.indices,part.indexCount);
 rendered++;
 if(mu===0){triangles+=idx.length/3;continue;}
 for(let t=0;t<idx.length;t+=3){
  triangles++;
  const a=idx[t]*3,b=idx[t+1]*3,c=idx[t+2]*3;
  const ax=pos[a],ay=pos[a+1],az=pos[a+2],bx2=pos[b],by2=pos[b+1],bz2=pos[b+2],cx=pos[c],cy=pos[c+1],cz=pos[c+2];
  // Geometric normal, disambiguated by the stored vertex normals so that a mesh with reversed
  // winding still reports the correct side.
  const e1x=bx2-ax,e1y=by2-ay,e1z=bz2-az,e2x=cx-ax,e2y=cy-ay,e2z=cz-az;
  let nx=e1y*e2z-e1z*e2y,ny=e1z*e2x-e1x*e2z,nz=e1x*e2y-e1y*e2x;
  const sx=nor[a]+nor[b]+nor[c],sy=nor[a+1]+nor[b+1]+nor[c+1],sz=nor[a+2]+nor[b+2]+nor[c+2];
  if(nx*sx+ny*sy+nz*sz<0){nx=-nx;ny=-ny;nz=-nz;}
  const facing=nx*bx+ny*by+nz*bz;
  if(facing===0)continue;
  const sign=facing>0?1:-1;
  // Project to the detector.
  const pau=(ax*rx+ay*ry+az*rz-u0)*scaleU,pav=H-(ax*ux+ay*uy+az*uz-v0)*scaleV,pad=ax*bx+ay*by+az*bz;
  const pbu=(bx2*rx+by2*ry+bz2*rz-u0)*scaleU,pbv=H-(bx2*ux+by2*uy+bz2*uz-v0)*scaleV,pbd=bx2*bx+by2*by+bz2*bz;
  const pcu=(cx*rx+cy*ry+cz*rz-u0)*scaleU,pcv=H-(cx*ux+cy*uy+cz*uz-v0)*scaleV,pcd=cx*bx+cy*by+cz*bz;
  const area=(pbu-pau)*(pcv-pav)-(pbv-pav)*(pcu-pau);
  if(area===0)continue;
  const inv=1/area;
  let minX=Math.max(0,Math.ceil(Math.min(pau,pbu,pcu)-.5)),maxX=Math.min(W-1,Math.floor(Math.max(pau,pbu,pcu)-.5));
  let minY=Math.max(0,Math.ceil(Math.min(pav,pbv,pcv)-.5)),maxY=Math.min(H-1,Math.floor(Math.max(pav,pbv,pcv)-.5));
  for(let py=minY;py<=maxY;py++){
   const cy2=py+.5,row=py*W;
   for(let px=minX;px<=maxX;px++){
    const cx2=px+.5;
    // Barycentric coordinates via edge functions, evaluated at the sample centre.
    const w0=((pbu-pau)*(cy2-pav)-(pbv-pav)*(cx2-pau))*inv;
    const w1=((cx2-pau)*(pcv-pav)-(cy2-pav)*(pcu-pau))*inv;
    if(w0<0||w1<0||w0+w1>1)continue;
    const depth=pad+(pbd-pad)*w1+(pcd-pad)*w0;
    accum[row+px]+=sign*mu*depth*100;
   }
  }
 }
}

// Downsample the supersampled accumulator.
const pixels=new Float64Array(width*height);
for(let y=0;y<height;y++)for(let x=0;x<width;x++){
 let sum=0;
 for(let sy=0;sy<ss;sy++)for(let sx=0;sx<ss;sx++)sum+=accum[(y*ss+sy)*W+x*ss+sx];
 pixels[y*width+x]=sum/(ss*ss);
}

// Window to the image unless a window was given, the way a reading console auto windows a study.
let level=+opt('level',NaN),window=+opt('window',NaN);
if(!Number.isFinite(level)||!Number.isFinite(window)){
 const body=[...pixels].filter(v=>v>1e-6).sort((a,b)=>a-b);
 if(!body.length)throw new Error('The beam did not cross any tissue. Check --projection and --layers.');
 const low=body[Math.floor(body.length*.01)],high=body[Math.floor(body.length*.995)];
 window=Math.max(1e-3,high-low);level=low+window/2;
}
const grey=new Uint8Array(width*height);
for(let i=0;i<pixels.length;i++)grey[i]=Math.round(displayValue(pixels[i],level,window)*255);

// A laterality marker, as on a real film: the block letter L over the patient's left.
if(view.id==='ap'||view.id==='pa'){
 const leftIsImageRight=view.right[0]>0,size=Math.max(8,Math.round(height*.026)),pad=Math.round(size*.9),thick=Math.max(2,Math.round(size*.22));
 const x0=leftIsImageRight?width-pad-size:pad,y0=pad;
 const box=(x,y,w,h)=>{for(let j=y;j<y+h&&j<height;j++)for(let i=x;i<x+w&&i<width;i++)if(i>=0&&j>=0)grey[j*width+i]=255;};
 box(x0,y0,thick,size);box(x0,y0+size-thick,Math.round(size*.62),thick);
}

// Minimal 8 bit greyscale PNG.
const crcTable=new Int32Array(256);
for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c;}
const crc=buf=>{let c=-1;for(const b of buf)c=crcTable[(c^b)&255]^(c>>>8);return(c^-1)>>>0;};
const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const body=Buffer.concat([Buffer.from(type,'ascii'),data]);const tail=Buffer.alloc(4);tail.writeUInt32BE(crc(body));return Buffer.concat([len,body,tail]);};
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=0;
const raw=Buffer.alloc((width+1)*height);
for(let y=0;y<height;y++){raw[y*(width+1)]=0;Buffer.from(grey.buffer,y*width,width).copy(raw,y*(width+1)+1);}
fs.writeFileSync(out,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]));

const tissues=new Map();
for(const p of parts){const t=tissueFor(p);tissues.set(t,(tissues.get(t)??0)+1);}
console.log(`${view.name} (${view.abbr}) · ${view.description}`);
console.log(`${rendered} structures, ${triangles.toLocaleString()} triangles, ${ss}x supersampled, ${((Date.now()-started)/1000).toFixed(1)}s`);
console.log(`Tissues in beam: ${[...tissues].sort((a,b)=>TISSUES[b[0]].mu-TISSUES[a[0]].mu).map(([t,n])=>`${t} ${n}`).join(', ')}`);
console.log(`Soft-tissue envelope: ${envelopePresent?'present, structures shown as excess over soft tissue':'absent, structures shown at their own coefficient'}`);
console.log(`Window level ${level.toFixed(2)}, width ${window.toFixed(2)} (attenuation units)`);
console.log(`Field: ${region}${region==='full'?'':' (collimated)'} · wrote ${out} at ${width}x${height}`);
