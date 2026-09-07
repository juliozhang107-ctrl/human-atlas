// Renders a cross-section through the atlas as CT, MR or ultrasound.
//
// All three share one geometric step: cut every mesh with the plane, fill the resulting outlines,
// and label each pixel with the structure that owns it. What differs is how a label becomes a grey
// value. CT reads the same linear attenuation coefficients the radiograph uses, expressed in
// Hounsfield units. MR evaluates a spin echo from the proton density and relaxation times of the
// tissue. Ultrasound traces a sector of rays through the label map, returning echoes from every
// impedance mismatch and attenuating what continues, which is what produces shadowing behind bone
// and gas and enhancement behind fluid.
//
// These are synthetic phantoms built from surface meshes and reference tissue constants. They show
// where structures lie and how each modality broadly renders them. They are not acquired images and
// contain no pathology, no acquisition artefact, and no variation within a structure.
import {loadAtlas,option} from './atlas-source.mjs';
import {writeGreyPng,drawGlyph} from './png.mjs';
import {plane,PLANES,frameFor,crossSection,fillSegments,fillEnclosed,byDescendingVolume} from '../app/slice.ts';
import {sectionTissue,hounsfield,TISSUES,isEnvelope} from '../app/radiograph.ts';
import {RELAXATION,ACOUSTIC,SEQUENCES,CT_WINDOWS,MODALITIES,sequence,ctWindow,mrSignal} from '../app/modalities.ts';
import {windowSection,ultrasoundSector,probeFor,scatterFromAttenuation,BEAM} from '../app/imaging.ts';

const argv=process.argv.slice(2),opt=(n,f)=>option(argv,n,f);
if(argv.includes('--help')){
 console.log(`Usage: node scripts/render-slice.mjs [options]

  --modality ct|mr|us          imaging modality (default ct)
  --plane ${PLANES.map(p=>p.id).join('|')}   cutting plane (default axial)
  --position <metres>          plane offset along its normal, in atlas metres
  --at <structure>             centre the plane on a named structure instead
  --sequence ${SEQUENCES.map(s=>s.id).join('|')}   MR sequence (default t1)
  --window ${CT_WINDOWS.map(w=>w.id).join('|')}    CT window (default soft)
  --width <px>                 image width (default 512)
  --field auto|trunk|body      fit the frame to this slice, to the trunk alone, or to the
                               whole body (default auto). This atlas has the arms at the sides,
                               so an abdominal section includes the forearms unless trunk is used.
  --out <file>                 output PNG

  Atlas axes are +x patient left, +y superior, +z anterior; the body spans y 0 to 1.73 m.`);
 process.exit(0);
}
const modalityId=opt('modality','ct');
if(!MODALITIES.some(m=>m.id===modalityId&&m.cross))throw new Error(`--modality ${modalityId} is not a cross-sectional modality. Expected ct, mr or us.`);
const pl=plane(opt('plane','axial')),width=Math.max(64,Math.round(+opt('width',512)));
const {atlas,geometry}=loadAtlas();
const indexed=atlas.parts.map((part,index)=>({...part,index}));

// Where to cut.
let offset;
const at=opt('at',null);
if(at){
 const match=indexed.filter(p=>p.name.toLowerCase().includes(at.toLowerCase()));
 if(!match.length)throw new Error(`--at ${at} matched no structure in the atlas.`);
 offset=match.reduce((sum,p)=>sum+(p.bounds[0][pl.axis]+p.bounds[1][pl.axis])/2,0)/match.length;
}else offset=+opt('position',pl.id==='axial'?1.15:0);
if(!Number.isFinite(offset))throw new Error('--position must be a number in metres.');

// Frame. By default the field follows the anatomy present in this slice, the way a technologist
// collimates; --field body keeps one frame across every slice so a stack stays registered.
const straddling=indexed.filter(p=>offset>=p.bounds[0][pl.axis]&&offset<=p.bounds[1][pl.axis]);
if(!straddling.length)throw new Error(`No anatomy at ${pl.name.toLowerCase()} ${offset.toFixed(3)} m. The body spans y 0 to 1.73 m.`);
const extentOf=(list)=>{
 let u0=Infinity,u1=-Infinity,v0=Infinity,v1=-Infinity;
 for(const p of list)for(let c=0;c<8;c++){
  const x=p.bounds[c&1?1:0][0],y=p.bounds[c&2?1:0][1],z=p.bounds[c&4?1:0][2];
  const u=x*pl.right[0]+y*pl.right[1]+z*pl.right[2],v=x*pl.up[0]+y*pl.up[1]+z*pl.up[2];
  if(u<u0)u0=u;if(u>u1)u1=u;if(v<v0)v0=v;if(v>v1)v1=v;
 }
 return [u0,u1,v0,v1];
};
const field=opt('field','auto');
if(!['auto','trunk','body'].includes(field))throw new Error(`Unknown --field ${field}. Expected auto, trunk or body.`);
let [u0,u1,v0,v1]=extentOf(field==='body'?indexed:straddling);
if(field==='trunk'){
 // Real cross-sectional studies of the trunk are acquired with the arms raised. This atlas stands
 // with the arms down, so the trunk field is coned in to exclude them.
 const centre=(u0+u1)/2,half=pl.id==='sagittal'?.26:pl.id==='axial'?.20:.23;
 u0=Math.max(u0,centre-half);u1=Math.min(u1,centre+half);
 // Coronal and sagittal sections run the length of the body, so the trunk field also crops to the
 // span between the shoulders and the pelvic floor.
 if(pl.id!=='axial'){v0=Math.max(v0,.74);v1=Math.min(v1,1.60);}
}
const margin=.02;u0-=margin;u1+=margin;v0-=margin;v1+=margin;
const frame=frameFor(u0,u1,v0,v1,width);
const {height}=frame;

// Label every pixel with the structure that owns it, largest first so the most specific wins.
// Labelling happens on the whole body extent even when the field is coned in, because flooding the
// body inward from its outline needs an outline that is closed rather than cut by the frame edge.
const started=Date.now();
const [fu0,fu1,fv0,fv1]=extentOf(indexed);
const full=frameFor(fu0-margin,fu1+margin,fv0-margin,fv1+margin,Math.max(1,Math.round((fu1-fu0+2*margin)*frame.scale)));
const wide=new Int32Array(full.width*full.height).fill(-1);
let cut=0;
// The body first: cut the skin shell, then flood what it encloses, so unmodelled interstitial
// space is soft tissue rather than air. Every structure is then painted over that background.
const envelope=straddling.find(isEnvelope);
if(envelope){
 const {positions,indices}=geometry(envelope),outline=[];
 crossSection(positions,indices,pl,offset,full,outline);
 if(outline.length){fillSegments(outline,full,wide,envelope.index);fillEnclosed(wide,full,envelope.index);cut++;}
}
for(const part of byDescendingVolume(straddling)){
 if(isEnvelope(part))continue;
 const {positions,indices}=geometry(part);
 const segments=[];
 crossSection(positions,indices,pl,offset,full,segments);
 if(!segments.length)continue;
 if(fillSegments(segments,full,wide,part.index))cut++;
}
// Crop the labelled body down to the requested field.
const labels=new Int32Array(frame.width*height).fill(-1);
const dx=Math.round((frame.u0-full.u0)*frame.scale),dy=full.height-Math.round((frame.v0-full.v0)*frame.scale)-height;
for(let y=0;y<height;y++){
 const sy=y+dy;if(sy<0||sy>=full.height)continue;
 for(let x=0;x<frame.width;x++){
  const sx=x+dx;if(sx<0||sx>=full.width)continue;
  labels[y*frame.width+x]=wide[sy*full.width+sx];
 }
}
const tissueAt=new Array(atlas.parts.length);
for(const p of indexed)tissueAt[p.index]=sectionTissue(p);

const grey=new Uint8Array(frame.width*height);
const values=new Float64Array(atlas.parts.length);
let caption='';
if(modalityId==='ct'){
 const w=ctWindow(opt('window','soft'));
 for(const p of indexed)values[p.index]=hounsfield(tissueAt[p.index]);
 windowSection(labels,values,hounsfield('air'),w.width,w.level,grey);
 caption=`${w.name} window (W ${w.width} L ${w.level})`;
}else if(modalityId==='mr'){
 const seq=sequence(opt('sequence','t1'));
 for(const p of indexed)values[p.index]=mrSignal(RELAXATION[tissueAt[p.index]],seq);
 let peak=0;for(const v of values)if(v>peak)peak=v;
 windowSection(labels,values,0,peak,peak/2,grey);
 caption=`${seq.name} (TR ${seq.tr} ms, TE ${seq.te} ms${seq.ti?`, TI ${seq.ti} ms`:''})`;
}else{
 const probe=probeFor(pl.id,u0,u1,v0,v1);
 ultrasoundSector(labels,frame,probe,
  label=>ACOUSTIC[tissueAt[label]].z,
  label=>ACOUSTIC[tissueAt[label]].alpha,
  label=>scatterFromAttenuation(ACOUSTIC[tissueAt[label]].alpha),
  grey);
 caption=`${BEAM.frequency} MHz sector, ${(probe.depth*100).toFixed(0)} cm depth, ${BEAM.dynamicRange} dB dynamic range, gel coupled`;
}

// Orientation markers, as on a reported image.
const size=Math.max(14,Math.round(height*.035)),pad=Math.round(size*.7);
drawGlyph(grey,frame.width,height,pl.leftLabel,pad,Math.round(height/2-size/2),size);
drawGlyph(grey,frame.width,height,pl.rightLabel,frame.width-pad-size*.6,Math.round(height/2-size/2),size);
drawGlyph(grey,frame.width,height,pl.topLabel,Math.round(frame.width/2-size*.3),pad,size);
drawGlyph(grey,frame.width,height,pl.bottomLabel,Math.round(frame.width/2-size*.3),height-pad-size,size);

const out=opt('out',`${modalityId}-${pl.id}-${offset.toFixed(3).replace('.','p')}.png`);
writeGreyPng(out,frame.width,height,grey);

const present=new Map();
for(const p of straddling){const t=tissueAt[p.index];present.set(t,(present.get(t)??0)+1);}
console.log(`${MODALITIES.find(m=>m.id===modalityId).name} · ${pl.name} · ${pl.description}`);
console.log(`Plane at ${offset.toFixed(3)} m${at?` (centred on ${at})`:''} · ${cut} structures sectioned of ${straddling.length} crossing the plane · ${((Date.now()-started)/1000).toFixed(1)}s`);
console.log(`${caption}`);
console.log(`Tissues in section: ${[...present].sort((a,b)=>TISSUES[b[0]].mu-TISSUES[a[0]].mu).map(([t,n])=>`${t} ${n}`).join(', ')}`);
console.log(`Wrote ${out} at ${frame.width}x${height}`);
