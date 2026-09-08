import type {PlaneId} from './slice';
import type {SystemId} from './anatomy';

/** A real imaging study: an intensity volume and a label volume of the same shape, in which every
 *  voxel carries the index of the structure that owns it. Axes are the atlas's own, so index order
 *  is (patient left, superior, anterior), and spacing is in millimetres along each of those.
 *
 *  Sixteen-bit volumes arrive as a plane of low bytes followed by a plane of high bytes, which
 *  compresses far better than interleaved pairs because the high plane is nearly constant. */
export interface Structure {index:number;file:string;name:string;latin:string;system:SystemId;voxels:number}
export interface Source {dataset:string;subject:string;doi:string;url:string;licence:string;attribution:string}
export interface VolumeManifest {
 modality:string;subject:string;dims:[number,number,number];spacing:[number,number,number];axes:string;
 intensity:{dtype:'uint8'|'uint16';encoding:'plain'|'split-bytes';slope:number;inter:number;unit:string;ceiling?:number};
 /** How this study should be read. Magnetic resonance has no absolute scale, so each carries the
  *  window that puts its own tissue at mid grey. Null for CT, which is windowed by preset. */
 window:{level:number;width:number}|null;
 structures:Structure[];source:Source;
}
export interface Volume {manifest:VolumeManifest;values:Uint8Array|Uint16Array;labels:Uint8Array;named:Map<number,Structure>}

/** A static host may serve a .gz either as a compressed response, which fetch has already decoded,
 *  or as a gzip file to decode here. Checking the magic bytes avoids decoding it twice. */
async function inflate(response:Response,expected:number){
 if(!response.ok)throw new Error(`Could not load imaging data (${response.status}).`);
 const payload=await response.arrayBuffer();
 const signature=new Uint8Array(payload,0,Math.min(2,payload.byteLength));
 const buffer=signature[0]===0x1f&&signature[1]===0x8b
  ? await new Response(new Blob([payload]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
  : payload;
 if(buffer.byteLength<expected)throw new Error('An imaging file was incomplete. Please reload the viewer.');
 return new Uint8Array(buffer);
}

export async function loadVolume(base:string,signal?:AbortSignal):Promise<Volume>{
 const manifest:VolumeManifest=await fetch(`${base}/manifest.json`,{signal}).then(r=>{
  if(!r.ok)throw new Error('Could not load the imaging manifest.');return r.json();});
 const count=manifest.dims[0]*manifest.dims[1]*manifest.dims[2];
 const [volumeBytes,labelBytes]=await Promise.all([
  fetch(`${base}/volume.bin.gz`,{signal}).then(r=>inflate(r,count*(manifest.intensity.dtype==='uint16'?2:1))),
  fetch(`${base}/labels.bin.gz`,{signal}).then(r=>inflate(r,count)),
 ]);
 let values:Uint8Array|Uint16Array;
 if(manifest.intensity.encoding==='split-bytes'){
  const wide=new Uint16Array(count);
  for(let i=0;i<count;i++)wide[i]=volumeBytes[i]|(volumeBytes[count+i]<<8);
  values=wide;
 }else values=volumeBytes.subarray(0,count);
 if(labelBytes.length<count)throw new Error('The label volume does not match the image volume.');
 return {manifest,values,labels:labelBytes.subarray(0,count),
  named:new Map(manifest.structures.map(s=>[s.index,s]))};
}

/** How many slices a plane has, and how far apart they are. */
export function planeAxis(id:PlaneId){return id==='axial'?1:id==='coronal'?2:0;}
export function sliceCount(volume:Volume,id:PlaneId){return volume.manifest.dims[planeAxis(id)];}
export function slicePosition(volume:Volume,id:PlaneId,index:number){
 return index*volume.manifest.spacing[planeAxis(id)]/10;   // centimetres from the edge of the field
}

export interface Section {width:number;height:number;pixelWidth:number;pixelHeight:number;grey:Uint8Array;labels:Uint8Array}
/** Where to write a structure's name on a section, and how much of the slice it occupies. */
export interface Anchor {index:number;x:number;y:number;area:number}

/** One anchor per structure in a section: the point nearest its centre of area that actually lies
 *  inside it, so a name written there points at the structure rather than into the gap between its
 *  parts. A colon wrapping round the abdomen has a centroid in the middle of the small bowel; this
 *  moves the label back onto the colon. */
export function anchorsFor(section:Section,minimumArea=40):Anchor[]{
 const sums=new Map<number,{x:number;y:number;n:number}>();
 for(let y=0,i=0;y<section.height;y++)for(let x=0;x<section.width;x++,i++){
  const label=section.labels[i];
  if(!label)continue;
  const at=sums.get(label);
  if(at){at.x+=x;at.y+=y;at.n++;}else sums.set(label,{x,y,n:1});
 }
 const best=new Map<number,{x:number;y:number;d:number}>();
 for(let y=0,i=0;y<section.height;y++)for(let x=0;x<section.width;x++,i++){
  const label=section.labels[i];
  if(!label)continue;
  const at=sums.get(label)!;
  if(at.n<minimumArea)continue;
  const distance=(x-at.x/at.n)**2+(y-at.y/at.n)**2;
  const held=best.get(label);
  if(!held||distance<held.d)best.set(label,{x,y,d:distance});
 }
 return [...best].map(([index,at])=>({index,x:at.x,y:at.y,area:sums.get(index)!.n}))
  .sort((a,b)=>b.area-a.area);
}

/** Cut one slice out of the volume, windowed to grey, with the matching labels.
 *
 *  Row and column order follow the reading room. Axial is viewed from the feet, so columns run
 *  toward the patient's left and rows run from anterior down. Coronal is viewed from the front, so
 *  columns again run toward the patient's left and rows run from superior down. Sagittal is
 *  displayed with anterior to the left, so columns run posteriorly. */
export function extractSection(volume:Volume,id:PlaneId,index:number,width:number,level:number):Section{
 const [dx,dy,dz]=volume.manifest.dims,[sx,sy,sz]=volume.manifest.spacing;
 const {slope,inter}=volume.manifest.intensity;
 const axis=planeAxis(id);
 const at=Math.min(volume.manifest.dims[axis]-1,Math.max(0,Math.round(index)));
 const w=id==='sagittal'?dz:dx;
 const h=id==='axial'?dz:dy;
 const grey=new Uint8Array(w*h),labels=new Uint8Array(w*h);
 const low=level-width/2,span=Math.max(1e-6,width);
 const values=volume.values,source=volume.labels;
 for(let row=0;row<h;row++)for(let column=0;column<w;column++){
  let i:number,j:number,k:number;
  if(id==='axial'){i=column;j=at;k=dz-1-row;}
  else if(id==='coronal'){i=column;j=dy-1-row;k=at;}
  else{i=at;j=dy-1-row;k=dz-1-column;}
  const offset=(i*dy+j)*dz+k,target=row*w+column;
  grey[target]=Math.round(Math.min(1,Math.max(0,(values[offset]*slope+inter-low)/span))*255);
  labels[target]=source[offset];
 }
 return {width:w,height:h,grey,labels,
  pixelWidth:id==='sagittal'?sz:sx,
  pixelHeight:id==='axial'?sz:sy};
}
