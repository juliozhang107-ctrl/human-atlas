import type {Frame} from './slice';

/** Turning a labelled section into pixels. These functions take the per-label physical values as
 *  plain arrays and callbacks rather than importing the tissue tables, so the same code runs in the
 *  browser and in the command line renderer and the two cannot drift apart. */

/** Map a per-label value through a width and level into eight-bit grey. */
export function windowSection(labels:Int32Array,valueOf:Float64Array,outside:number,width:number,level:number,out:Uint8Array){
 const low=level-width/2,span=Math.max(1e-6,width);
 for(let i=0;i<labels.length;i++){
  const label=labels[i],value=label<0?outside:valueOf[label];
  out[i]=Math.round(Math.min(1,Math.max(0,(value-low)/span))*255);
 }
}

/** A curvilinear probe placed at the edge of the field, looking inward. Axial sections are scanned
 *  from the front, coronal from the patient's right flank and sagittal from the front, which are
 *  the approaches those planes correspond to in practice. */
export interface Probe {apex:[number,number];direction:[number,number];span:number;depth:number}
export function probeFor(planeId:string,u0:number,u1:number,v0:number,v1:number):Probe{
 return planeId==='axial'
  ? {apex:[(u0+u1)/2,v1],direction:[0,-1],span:Math.PI/6,depth:v1-v0}
  : {apex:[u0,(v0+v1)/2],direction:[1,0],span:Math.PI/6,depth:u1-u0};
}

export interface BeamSettings {frequency:number;lines:number;samples:number;maxGainDb:number;dynamicRange:number;couplingImpedance:number;referenceAttenuation:number}
export const BEAM: BeamSettings = {frequency:3.5,lines:384,samples:1024,maxGainDb:95,dynamicRange:52,couplingImpedance:1.48,referenceAttenuation:.7};

/** Trace a sector and scan convert it onto the image grid.
 *
 *  Along each line the amplitude is tracked one way and squared for the round trip. Every change of
 *  impedance returns a specular echo and takes that fraction out of what continues, and each tissue
 *  also scatters diffusely, which is what gives parenchyma its texture. Time gain compensation
 *  undoes the round-trip attenuation of average soft tissue up to a bounded maximum, so fluid,
 *  which attenuates far less than the reference, brightens what lies behind it, while bone and gas
 *  attenuate far more and leave a shadow. The display is logarithmic over a fixed dynamic range
 *  below the brightest echoes, as a machine maps its gain to the screen. */
export function ultrasoundSector(labels:Int32Array,frame:Frame,probe:Probe,
 impedanceOf:(label:number)=>number,attenuationOf:(label:number)=>number,scatterOf:(label:number)=>number,
 out:Uint8Array,settings:BeamSettings=BEAM){
 const {frequency,lines,samples,maxGainDb,dynamicRange,couplingImpedance,referenceAttenuation}=settings;
 const {u0,v0,scale,width,height}=frame;
 const [ax,ay]=probe.apex,[dx0,dy0]=probe.direction;
 const step=probe.depth/samples,stepCm=step*100;
 const polar=new Float64Array(lines*samples);
 let seed=0x2f6e2b1;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 for(let line=0;line<lines;line++){
  const angle=(line/(lines-1)-.5)*2*probe.span,cos=Math.cos(angle),sin=Math.sin(angle);
  const dx=dx0*cos-dy0*sin,dy=dx0*sin+dy0*cos;
  let amplitude=1,previous=couplingImpedance;
  for(let s=0;s<samples;s++){
   const r=s*step,u=ax+dx*r,v=ay+dy*r;
   const px=Math.floor((u-u0)*scale),py=Math.floor(height-(v-v0)*scale);
   let impedance=couplingImpedance,attenuation=.02,scatter=0,label=-1;
   if(px>=0&&py>=0&&px<width&&py<height)label=labels[py*width+px];
   if(label>=0){impedance=impedanceOf(label);attenuation=attenuationOf(label);scatter=scatterOf(label);}
   const gain=10**(Math.min(maxGainDb,referenceAttenuation*frequency*2*r*100)/20);
   let echo=0;
   if(impedance!==previous){
    const mismatch=(impedance-previous)/(impedance+previous),reflected=mismatch*mismatch;
    echo+=reflected*amplitude*amplitude*gain*12;
    amplitude*=Math.sqrt(Math.max(0,1-reflected));
    previous=impedance;
   }
   echo+=scatter*amplitude*amplitude*gain*(.55+.9*random());
   polar[line*samples+s]=echo;
   amplitude*=10**(-(attenuation*frequency*stepCm)/20);
  }
 }
 const sorted=Float64Array.from(polar).sort();
 const reference=Math.max(1e-9,sorted[Math.floor(sorted.length*.999)]);
 out.fill(0);
 for(let py=0;py<height;py++)for(let px=0;px<width;px++){
  const u=u0+(px+.5)/scale,v=v0+(height-py-.5)/scale,du=u-ax,dv=v-ay;
  const r=Math.hypot(du,dv);
  if(r<1e-6||r>=probe.depth)continue;
  const angle=Math.atan2(du*dy0-dv*dx0,du*dx0+dv*dy0);
  if(Math.abs(angle)>probe.span)continue;
  const lf=(angle/(2*probe.span)+.5)*(lines-1),sf=r/step;
  const l0=Math.min(lines-1,Math.max(0,Math.floor(lf))),s0=Math.min(samples-1,Math.max(0,Math.floor(sf)));
  const l1=Math.min(lines-1,l0+1),s1=Math.min(samples-1,s0+1),tl=lf-l0,ts=sf-s0;
  const value=polar[l0*samples+s0]*(1-tl)*(1-ts)+polar[l1*samples+s0]*tl*(1-ts)
             +polar[l0*samples+s1]*(1-tl)*ts+polar[l1*samples+s1]*tl*ts;
  const db=20*Math.log10(Math.max(value,1e-12)/reference);
  out[py*width+px]=Math.round(Math.min(1,Math.max(0,(db+dynamicRange)/dynamicRange))*255);
 }
}
/** Scattering rises with attenuation, which is dominated by scatter in soft tissue. Capping it
 *  keeps a bone surface from saturating the whole near field. */
export function scatterFromAttenuation(alpha:number){return Math.min(.015,alpha*.004);}
