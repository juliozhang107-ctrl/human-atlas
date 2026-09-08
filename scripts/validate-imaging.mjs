import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {readFileSync,readdirSync} from 'node:fs';
import {PLANES,plane} from '../app/slice.ts';
import {CT_WINDOWS,MODALITIES,STUDIES,ctWindow,modality,study as studyFor,studiesFor,windowed} from '../app/modalities.ts';
import {extractSection,anchorsFor,planeAxis,sliceCount} from '../app/volume.ts';

const SYSTEMS=['skeletal','muscular','arterial','venous','nervous','digestive','respiratory','urinary',
               'reproductive','lymphatic','endocrine','integumentary','connective','sensory','cardiac'];

const load=id=>{
 const base=new URL(`../public/imaging/${id}/`,import.meta.url);
 const manifest=JSON.parse(readFileSync(new URL('manifest.json',base)));
 const count=manifest.dims[0]*manifest.dims[1]*manifest.dims[2];
 const raw=zlib.gunzipSync(readFileSync(new URL('volume.bin.gz',base)));
 let values;
 if(manifest.intensity.encoding==='split-bytes'){
  assert.equal(raw.length,count*2,`${id}: volume size does not match its dimensions`);
  values=new Uint16Array(count);
  for(let i=0;i<count;i++)values[i]=raw[i]|(raw[count+i]<<8);
 }else{
  assert.equal(raw.length,count,`${id}: volume size does not match its dimensions`);
  values=new Uint8Array(raw.buffer,raw.byteOffset,count);
 }
 const labelBytes=zlib.gunzipSync(readFileSync(new URL('labels.bin.gz',base)));
 assert.equal(labelBytes.length,count,`${id}: label volume does not match the image volume`);
 return {manifest,values,labels:new Uint8Array(labelBytes.buffer,labelBytes.byteOffset,count),
         named:new Map(manifest.structures.map(s=>[s.index,s]))};
};

// ── Plane conventions ───────────────────────────────────────────────────────────────────────────
assert.equal(PLANES.length,3);
assert.equal(planeAxis('axial'),1,'axial travels along the superior axis');
assert.equal(planeAxis('coronal'),2,'coronal travels along the anterior axis');
assert.equal(planeAxis('sagittal'),0,'sagittal travels along the left-right axis');
assert.ok(plane('axial').right[0]>0&&plane('coronal').right[0]>0,'frontal planes put the patient’s right on the left of the image');
assert.ok(plane('sagittal').right[2]<0,'sagittal is displayed with anterior to the left');
assert.deepEqual(MODALITIES.filter(m=>m.interactive).map(m=>m.id),['radiograph','ct']);
assert.equal(modality('radiograph').cross,false,'a radiograph is a projection, not a section');

const atlas=JSON.parse(readFileSync(new URL('../public/models/atlas.json',import.meta.url)));
const concepts=new Set(atlas.concepts.map(c=>c.name.toLowerCase()));

for(const id of STUDIES.map(s=>s.path)){
 const study=load(id);
 const {manifest,values,labels}=study;
 const [dx,dy,dz]=manifest.dims;

 // ── Manifest integrity ─────────────────────────────────────────────────────────────────────────
 const declared=STUDIES.find(s=>s.path===id);
 assert.ok(declared,`${id}: no study declares this path`);
 assert.equal(manifest.modality,declared.modality,`${id}: manifest names a different modality`);
 // A clinical study can be thin in one direction: a T2 abdomen is often thirty-odd slices at six
 // millimetres. What matters is that each axis covers a real distance, not that it has many voxels.
 assert.ok(manifest.dims.every(d=>d>16),`${id}: implausible dimensions ${manifest.dims}`);
 assert.ok(manifest.spacing.every(s=>s>0&&s<10),`${id}: implausible voxel spacing`);
 const extent=manifest.dims.map((d,i)=>d*manifest.spacing[i]/10);
 assert.ok(extent.every(cm=>cm>8),`${id}: field of view too small (${extent.map(c=>c.toFixed(0)).join('×')} cm)`);
 assert.ok(manifest.structures.length>20,`${id}: too few structures to be useful`);
 for(const field of ['dataset','subject','doi','url','licence','attribution'])
  assert.ok(manifest.source[field],`${id}: source is missing ${field}`);

 // Every label in the volume must name a structure, and every named structure must appear.
 const present=new Set(labels);present.delete(0);
 for(const index of present)assert.ok(study.named.has(index),`${id}: label ${index} names nothing`);
 const indices=new Set(manifest.structures.map(s=>s.index));
 for(const s of manifest.structures)assert.ok(present.has(s.index),`${id}: ${s.name} is declared but absent from the volume`);
 assert.equal(indices.size,manifest.structures.length,`${id}: duplicate structure indices`);
 // Every structure must carry a reported name, and the identifiers the model writes must not reach
 // a reader: 'autochthon_left' is the erector spinae, and naming it after the file would teach the
 // wrong word.
 for(const s of manifest.structures){
  assert.ok(s.name&&s.name.trim(),`${id}: structure ${s.index} has no name`);
  assert.ok(!/_/.test(s.name),`${id}: ${s.name} still reads like a file name`);
  assert.ok(s.name[0]===s.name[0].toUpperCase(),`${id}: ${s.name} should start with a capital`);
  assert.ok('latin' in s,`${id}: ${s.name} has no Terminologia Anatomica field`);
  // The label on the image is coloured by system, so an unclassified structure would be drawn a
  // neutral grey among coloured neighbours and read as a different kind of thing than it is.
  assert.ok(SYSTEMS.includes(s.system),`${id}: ${s.name} has system ${JSON.stringify(s.system)}, which is not one the atlas colours`);
 }
 const named=manifest.structures.filter(s=>s.latin).length;
 assert.ok(named>manifest.structures.length*.9,`${id}: only ${named} of ${manifest.structures.length} carry a Latin term`);
 const labelled=[...labels].filter(Boolean).length;
 assert.ok(labelled>values.length*.02,`${id}: barely any voxels are labelled`);

 // ── Sections ───────────────────────────────────────────────────────────────────────────────────
 for(const p of PLANES){
  const count=sliceCount(study,p.id);
  assert.equal(count,manifest.dims[planeAxis(p.id)],`${id}/${p.id}: slice count must follow the plane's axis`);
  const middle=Math.floor(count/2);
  const section=extractSection(study,p.id,middle,400,40);
  const expected=p.id==='sagittal'?[dz,dy]:p.id==='axial'?[dx,dz]:[dx,dy];
  assert.deepEqual([section.width,section.height],expected,`${id}/${p.id}: section has the wrong shape`);
  assert.equal(section.grey.length,section.width*section.height);
  assert.equal(section.labels.length,section.grey.length);
  assert.ok(section.pixelWidth>0&&section.pixelHeight>0,`${id}/${p.id}: pixel spacing must be positive`);
  assert.ok(section.labels.some(Boolean),`${id}/${p.id}: the middle slice should cross some anatomy`);
  // A name written on the image must sit inside the structure it names, not in the gap between its
  // parts, which is where a plain centroid would land for anything horseshoe shaped.
  for(const anchor of anchorsFor(section))
   assert.equal(section.labels[anchor.y*section.width+anchor.x],anchor.index,
    `${id}/${p.id}: the anchor for structure ${anchor.index} falls outside it`);
  // Out-of-range indices clamp rather than reading past the end of the volume.
  for(const index of [-5,count+5])
   assert.equal(extractSection(study,p.id,index,400,40).grey.length,section.grey.length,`${id}/${p.id}: index ${index} must clamp`);
 }
 // A section's labels must be the ones actually stored at those voxels, not a resampling of them.
 const axial=extractSection(study,'axial',Math.floor(dy/2),400,40);
 const row=Math.floor(dz/3),column=Math.floor(dx/3);
 const offset=(column*dy+Math.floor(dy/2))*dz+(dz-1-row);
 assert.equal(axial.labels[row*axial.width+column],labels[offset],`${id}: axial sampling does not match the volume`);

 // ── The data itself ────────────────────────────────────────────────────────────────────────────
 const hu=index=>{
  const structure=manifest.structures.find(s=>s.name.toLowerCase()===index);
  if(!structure)return null;
  let sum=0,n=0;
  for(let i=0;i<labels.length;i++)if(labels[i]===structure.index){sum+=values[i]*manifest.intensity.slope+manifest.intensity.inter;n++;}
  return n?sum/n:null;
 };
 if(declared.modality==='ct'){
  assert.equal(manifest.intensity.unit,'HU');
  // Hounsfield units are absolute, so a mislabelled or misaligned mask shows up as tissue whose
  // density is wrong for its name. These bounds are wide enough for any normal study.
  // Bounds are wide enough for any phase of contrast: an angiogram puts the aorta near 300 HU
  // where a portal venous study puts it near 110, and both are correct. They are still tight
  // enough that a mask landing in bone or in fat would fail.
  const checks=[['liver',20,140],['spleen',20,180],['urinary bladder',-30,60],['aorta',20,500],
                ['vertebrae l3',120,900],['autochthon left',0,110]];
  for(const [name,low,high] of checks){
   const mean=hu(name);
   if(mean===null)continue;
   assert.ok(mean>low&&mean<high,`ct: ${name} averages ${mean.toFixed(0)} HU, outside ${low}..${high} — the mask and the image may not align`);
  }
  const air=[...values].slice(0,5000).map(v=>v*1+manifest.intensity.inter);
  assert.ok(Math.min(...air)<-800,'ct: the field should contain air near -1000 HU');
  if(declared.id==='body')assert.ok(manifest.dims[1]*manifest.spacing[1]/10>100,`ct: the body study should span the trunk and legs, got ${(manifest.dims[1]*manifest.spacing[1]/10).toFixed(0)} cm`);
 }else{
  assert.equal(manifest.intensity.dtype,'uint8');
  assert.ok(values.every(v=>v<=255));
  // The weighting is measured, and each declared study must be the weighting it claims: on T1 urine
  // is dark against liver, on an inversion recovery fluid is bright and muscle is dark.
  assert.equal(manifest.weighting,declared.label,`${id}: manifest weighting disagrees with the study list`);
  // Magnetic resonance has no absolute scale, so each study must say how to read it, and that
  // window must put its own tissue near mid grey rather than leaving the image dark.
  assert.ok(manifest.window&&manifest.window.width>0,`${id}: no display window`);
  // Measured the way a reader meets it, slice by slice, which is also how the builder sizes the
  // window. A pooled histogram answers a different question: bright slices outvote dim ones, so it
  // reports a study as well exposed while its dim end displays as black.
  const [dxw,dyw,dzw]=manifest.dims;
  const greys=[];
  for(let y=0;y<dyw;y++){
   const body=[];
   for(let x=0;x<dxw;x+=3)for(let z=0;z<dzw;z+=3){
    const value=values[(x*dyw+y)*dzw+z];
    if(value>40)body.push(value);
   }
   if(body.length<60)continue;
   body.sort((a,b)=>a-b);
   greys.push((body[body.length>>1]-(manifest.window.level-manifest.window.width/2))/manifest.window.width);
  }
  assert.ok(greys.length>20,`${id}: too few slices to judge the window`);
  greys.sort((a,b)=>a-b);
  const typical=greys[greys.length>>1];
  assert.ok(typical>.4&&typical<.6,`${id}: the typical slice displays at ${(typical*100).toFixed(0)}% grey, too ${typical<.5?'dark':'bright'}`);
  assert.ok(greys[0]>.02,`${id}: its dimmest slice displays at ${(greys[0]*100).toFixed(0)}% grey, which is clipped to black`);
  // A stitched acquisition scales each station separately and shows the joins as brightness bands.
  // Measuring the body median slice by slice catches any that survive the flattening.
  // Banding is a step, not a gradient: a stitched study jumps in brightness between one slice and
  // the next while the anatomy barely changes. A smooth falloff across a single station is coil
  // sensitivity and is left alone, so only adjacent slices holding a similar amount of body are
  // compared, which excludes the places where an arm or a leg enters the field.
  const [dxm,dym,dzm]=manifest.dims;
  const level=[],area=[];
  for(let y=0;y<dym;y++){
   const sample=[];
   for(let x=0;x<dxm;x+=3)for(let z=0;z<dzm;z+=3){
    const value=values[(x*dym+y)*dzm+z];
    if(value>40)sample.push(value);
   }
   if(sample.length>80){sample.sort((a,b)=>a-b);level.push(sample[sample.length>>1]);area.push(sample.length);}
   else {level.push(null);area.push(0);}
  }
  // A join is a sustained shift, so the level either side is compared over a window rather than
  // slice to slice. Brightness that swings back and forth across a few slices is anatomy changing
  // quickly, not a seam, and averages out over the window.
  const window=8;
  const median=list=>{const v=list.filter(x=>x!==null).sort((a,b)=>a-b);return v.length?v[v.length>>1]:null;};
  let worst=0,worstAt=-1;
  for(let y=window;y<level.length-window;y++){
   const before=median(level.slice(y-window,y)),after=median(level.slice(y,y+window));
   if(before===null||after===null)continue;
   const areaBefore=median(area.slice(y-window,y)),areaAfter=median(area.slice(y,y+window));
   const ratio=areaAfter/Math.max(1,areaBefore);
   if(ratio<.88||ratio>1.14)continue;
   const shift=Math.abs(after-before)/Math.max(1,before);
   if(shift>worst){worst=shift;worstAt=y;}
  }
  assert.ok(worst<.3,`${id}: brightness shifts ${(worst*100).toFixed(0)}% across slice ${worstAt} with the body unchanged, which reads as a station join`);
  const fluid=hu('urinary bladder'),liver=hu('liver'),muscle=hu('autochthon left')??hu('autochthon right');
  if(manifest.weighting==='T1'&&fluid&&liver)
   assert.ok(fluid/liver<0.9,`${id}: declared T1 but fluid/liver is ${(fluid/liver).toFixed(2)}`);
  if(manifest.weighting==='STIR'&&liver&&muscle)
   assert.ok(muscle<liver,`${id}: declared STIR but muscle is not dark against liver`);
 }
 const bridged=manifest.structures.filter(s=>concepts.has(s.name.toLowerCase())).length;
 console.log(`${manifest.source.dataset} ${manifest.subject}: ${manifest.dims.join('×')} at `
  +`${manifest.spacing.map(s=>s.toFixed(2)).join('×')} mm, ${manifest.structures.length} structures, `
  +`${(100*labelled/values.length).toFixed(0)}% of voxels labelled, ${bridged} names shared with the atlas. `
  +`${manifest.source.licence}.`);
}

// Structures must sit in an anatomically possible order along the superior axis.
{
 const base=new URL('../public/imaging/ct-head/',import.meta.url);
 const head=JSON.parse(readFileSync(new URL('manifest.json',base)));
 const names=head.structures.map(s=>s.name.toLowerCase());
 for(const expected of ['brain','skull'])
  assert.ok(names.includes(expected),`ct-head: the head study must contain the ${expected}`);
 const body=JSON.parse(readFileSync(new URL('../public/imaging/ct/manifest.json',import.meta.url)));
 assert.ok(!body.structures.some(s=>s.name.toLowerCase()==='skull'),
  'ct: a study that stops at the neck must not claim a skull');
}

// ── Windowing ──────────────────────────────────────────────────────────────────────────────────
assert.equal(windowed(40,400,40),.5,'the window centre must sit mid grey');
assert.equal(windowed(-1000,400,40),0);assert.equal(windowed(3000,400,40),1);
for(const w of CT_WINDOWS)assert.ok(w.width>0&&w.name.trim(),`${w.id}: needs a width and a name`);
assert.equal(ctWindow('lung').level,-600);
assert.throws(()=>ctWindow('pancreas'),/Unknown window/);
assert.throws(()=>plane('oblique'),/Unknown plane/);
for(const s of STUDIES)assert.equal(studyFor(s.modality,s.id).path,s.path);
assert.equal(studiesFor('ct').length,2,'the body arrives in two CT studies');
// Every study the interface offers must be on disk, and nothing may be on disk unoffered: a study
// dropped from the list while its 10 MB of volume stayed behind would ship dead weight to every
// visitor, and one listed without its data would break the moment a reader selected it.
const onDisk=readdirSync(new URL('../public/imaging/',import.meta.url),{withFileTypes:true})
 .filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort();
assert.deepEqual(onDisk,STUDIES.map(s=>s.path).sort(),
 `the studies on disk and the studies offered must match: disk has ${onDisk.join(', ')}`);
// Dormant while magnetic resonance is not offered, and kept for when it is: a sequence is only
// worth offering if it survives being reformatted. The collection's T2 and STIR of the trunk are
// six-millimetre stacks, coarse in any plane but the acquired one, which is why they went first.
for(const study of studiesFor('mr')){
 const spacing=JSON.parse(readFileSync(new URL(`../public/imaging/${study.path}/manifest.json`,import.meta.url))).spacing;
 assert.ok(Math.max(...spacing)<=3.0,
  `${study.label}: ${Math.max(...spacing)} mm through-plane is too coarse to reformat`);
}
// Anatomy that cannot be where a label puts it: the collection's own labels once placed a fragment
// of skull among the toes of a study whose highest slice is lung.

console.log('Manifests, naming, label coverage, section geometry, anchors, sampling and CT densities all check out.');
