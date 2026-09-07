/** Cross-sectional geometry. Every mesh in the atlas is a closed surface, so a plane cuts it in one
 *  or more closed polygons. Intersecting each triangle with the plane gives those polygons as an
 *  unordered soup of segments, which an even–odd scanline fill turns back into filled regions
 *  without needing to recover the loop order. That is exact rather than sampled: a structure thinner
 *  than a pixel still registers wherever its outline crosses a scanline. */

export type PlaneId = 'axial'|'coronal'|'sagittal';
/** Display conventions follow the reading room. Axial slices are viewed from the feet, so the
 *  patient's right falls on the left of the image with anterior at the top. Coronal slices are
 *  viewed from the front, again with the patient's right on the left. Sagittal slices are displayed
 *  with anterior to the left. Atlas axes are +x patient left, +y superior, +z anterior. */
export interface Plane {id:PlaneId;name:string;description:string;axis:0|1|2;normal:[number,number,number];right:[number,number,number];up:[number,number,number];rightLabel:string;leftLabel:string;topLabel:string;bottomLabel:string}
export const PLANES: Plane[] = [
 {id:'axial',   name:'Axial',   description:'Viewed from the feet. The patient’s right lies on the left of the image and anterior is at the top.', axis:1, normal:[0,1,0], right:[1,0,0],  up:[0,0,1], rightLabel:'L', leftLabel:'R', topLabel:'A', bottomLabel:'P'},
 {id:'coronal', name:'Coronal', description:'Viewed from the front. The patient’s right lies on the left of the image, superior at the top.',       axis:2, normal:[0,0,1], right:[1,0,0],  up:[0,1,0], rightLabel:'L', leftLabel:'R', topLabel:'S', bottomLabel:'I'},
 {id:'sagittal',name:'Sagittal',description:'Viewed from the patient’s left, displayed with anterior to the left of the image.',                    axis:0, normal:[1,0,0], right:[0,0,-1], up:[0,1,0], rightLabel:'P', leftLabel:'A', topLabel:'S', bottomLabel:'I'},
];
export function plane(id:PlaneId){const p=PLANES.find(x=>x.id===id);if(!p)throw new Error(`Unknown plane: ${id}. Expected one of ${PLANES.map(x=>x.id).join(', ')}.`);return p;}

/** Pixel grid on the cutting plane. `scale` is pixels per metre. */
export interface Frame {u0:number;v0:number;scale:number;width:number;height:number}
export function frameFor(u0:number,u1:number,v0:number,v1:number,width:number):Frame{
 const scale=width/(u1-u0);
 return {u0,v0,scale,width,height:Math.max(1,Math.round((v1-v0)*scale))};
}
/** Pixel centres map back to plane coordinates, which the ultrasound model needs for its geometry. */
export function pixelToPlane(frame:Frame,px:number,py:number):[number,number]{
 return [frame.u0+(px+.5)/frame.scale, frame.v0+(frame.height-py-.5)/frame.scale];
}

/** Append the plane's intersection with one indexed mesh as pixel-space segments (x0,y0,x1,y1).
 *  Returns the number of segments appended. A vertex exactly on the plane counts as positive so an
 *  edge lying in the plane is not reported twice. */
export function crossSection(positions:Float32Array,indices:Uint32Array,p:Plane,offset:number,frame:Frame,out:number[]){
 const [nx,ny,nz]=p.normal,[rx,ry,rz]=p.right,[ux,uy,uz]=p.up;
 const {u0,v0,scale,height}=frame;
 let count=0;
 const px=[0,0,0],py=[0,0,0],pz=[0,0,0],d=[0,0,0];
 for(let t=0;t<indices.length;t+=3){
  let positive=0;
  for(let k=0;k<3;k++){
   const base=indices[t+k]*3,x=positions[base],y=positions[base+1],z=positions[base+2];
   px[k]=x;py[k]=y;pz[k]=z;d[k]=x*nx+y*ny+z*nz-offset;
   if(d[k]>=0)positive++;
  }
  if(positive===0||positive===3)continue;
  let found=0,ax=0,ay=0,bx=0,by=0;
  for(let e=0;e<3&&found<2;e++){
   const a=e,b=(e+1)%3;
   if((d[a]>=0)===(d[b]>=0))continue;
   const s=d[a]/(d[a]-d[b]);
   const x=px[a]+(px[b]-px[a])*s,y=py[a]+(py[b]-py[a])*s,z=pz[a]+(pz[b]-pz[a])*s;
   const u=x*rx+y*ry+z*rz,v=x*ux+y*uy+z*uz;
   const sx=(u-u0)*scale,sy=height-(v-v0)*scale;
   if(found===0){ax=sx;ay=sy;}else{bx=sx;by=sy;}
   found++;
  }
  if(found<2)continue;
  out.push(ax,ay,bx,by);count++;
 }
 return count;
}

/** Even–odd fill of a segment soup into a label buffer. Crossings use the half-open rule so a
 *  vertex shared by two segments is counted once and the polygon stays watertight. */
export function fillSegments(segments:number[],frame:Frame,labels:Int32Array,label:number){
 if(!segments.length)return 0;
 const {width,height}=frame;
 let top=Infinity,bottom=-Infinity;
 for(let i=1;i<segments.length;i+=2){const y=segments[i];if(y<top)top=y;if(y>bottom)bottom=y;}
 const first=Math.max(0,Math.ceil(top-.5)),last=Math.min(height-1,Math.floor(bottom-.5));
 let painted=0;
 const crossings:number[]=[];
 for(let row=first;row<=last;row++){
  const y=row+.5;crossings.length=0;
  for(let i=0;i<segments.length;i+=4){
   const x0=segments[i],y0=segments[i+1],x1=segments[i+2],y1=segments[i+3];
   if((y0<=y)===(y1<=y))continue;
   crossings.push(x0+(x1-x0)*(y-y0)/(y1-y0));
  }
  if(crossings.length<2)continue;
  crossings.sort((a,b)=>a-b);
  const base=row*width;
  for(let i=0;i+1<crossings.length;i+=2){
   const from=Math.max(0,Math.ceil(crossings[i]-.5)),to=Math.min(width-1,Math.floor(crossings[i+1]-.5));
   for(let x=from;x<=to;x++){labels[base+x]=label;painted++;}
  }
 }
 return painted;
}

/** Fill whatever an already-drawn outline encloses. The skin in this atlas is a thin shell rather
 *  than a solid body, so cutting it yields an outline two surfaces thick and an even–odd fill paints
 *  only that rim. Everything the rim encloses is body, so flooding inward from the border recovers
 *  the soft-tissue volume. Flooding rather than pairing crossings keeps separate components apart,
 *  which matters because an axial section of this atlas cuts the trunk and both forearms at once. */
export function fillEnclosed(labels:Int32Array,frame:Frame,label:number){
 const {width,height}=frame,total=width*height;
 const outside=new Uint8Array(total),stack:number[]=[];
 const reach=(i:number)=>{if(!outside[i]&&labels[i]!==label){outside[i]=1;stack.push(i);}};
 for(let x=0;x<width;x++){reach(x);reach((height-1)*width+x);}
 for(let y=0;y<height;y++){reach(y*width);reach(y*width+width-1);}
 while(stack.length){
  const i=stack.pop()!,x=i%width,y=(i-x)/width;
  if(x>0)reach(i-1);
  if(x<width-1)reach(i+1);
  if(y>0)reach(i-width);
  if(y<height-1)reach(i+width);
 }
 let filled=0;
 for(let i=0;i<total;i++)if(!outside[i]&&labels[i]!==label){labels[i]=label;filled++;}
 return filled;
}

/** Overlapping meshes are common in the source anatomy: a mesocolon and the colon it suspends both
 *  enclose the same points. Painting from the largest bounding box down lets the more specific
 *  structure win, which is the one a reader would name. */
export function byDescendingVolume<T extends {bounds:[number[],number[]]}>(parts:T[]){
 const volume=(p:T)=>{const [lo,hi]=p.bounds;return (hi[0]-lo[0])*(hi[1]-lo[1])*(hi[2]-lo[2]);};
 return [...parts].sort((a,b)=>volume(b)-volume(a));
}
