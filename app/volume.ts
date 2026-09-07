import type {PlaneId} from './slice';

/** A real imaging study: an intensity volume and a label volume of the same shape, in which every
 *  voxel carries the index of the structure that owns it. Axes are the atlas's own, so index order
 *  is (patient left, superior, anterior), and spacing is in millimetres along each of those.
 *
 *  Sixteen-bit volumes arrive as a plane of low bytes followed by a plane of high bytes, which
 *  compresses far better than interleaved pairs because the high plane is nearly constant. */
export interface Structure {index:number;file:string;name:string;voxels:number}
export interface Source {dataset:string;subject:string;doi:string;url:string;licence:string;attribution:string}
export interface VolumeManifest {
 modality:string;subject:string;dims:[number,number,number];spacing:[number,number,number];axes:string;
 intensity:{dtype:'uint8'|'uint16';encoding:'plain'|'split-bytes';slope:number;inter:number;unit:string;ceiling?:number};
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
