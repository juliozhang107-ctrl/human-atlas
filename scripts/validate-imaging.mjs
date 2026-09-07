import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {readFileSync} from 'node:fs';
import {PLANES,plane} from '../app/slice.ts';
import {CT_WINDOWS,MODALITIES,MR_STUDIES,ctWindow,modality,mrStudy,windowed} from '../app/modalities.ts';
import {extractSection,planeAxis,sliceCount} from '../app/volume.ts';

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
assert.deepEqual(MODALITIES.filter(m=>m.interactive).map(m=>m.id),['radiograph','ct','mr']);
assert.equal(modality('radiograph').cross,false,'a radiograph is a projection, not a section');

const atlas=JSON.parse(readFileSync(new URL('../public/models/atlas.json',import.meta.url)));
const concepts=new Set(atlas.concepts.map(c=>c.name.toLowerCase()));

for(const id of ['ct',...MR_STUDIES.map(s=>s.path)]){
 const study=load(id);
 const {manifest,values,labels}=study;
 const [dx,dy,dz]=manifest.dims;

 // ── Manifest integrity ─────────────────────────────────────────────────────────────────────────
 assert.equal(manifest.modality,id==='ct'?'ct':'mr',`${id}: manifest names a different modality`);
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
 const declared=new Set(manifest.structures.map(s=>s.index));
 for(const s of manifest.structures)assert.ok(present.has(s.index),`${id}: ${s.name} is declared but absent from the volume`);
 assert.equal(declared.size,manifest.structures.length,`${id}: duplicate structure indices`);
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
 if(id==='ct'){
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
  assert.ok(manifest.dims[1]*manifest.spacing[1]/10>100,`ct: expected wide craniocaudal coverage, got ${(manifest.dims[1]*manifest.spacing[1]/10).toFixed(0)} cm`);
 }else{
  assert.equal(manifest.intensity.dtype,'uint8');
  assert.ok(values.every(v=>v<=255));
  // The weighting is measured, and each declared study must be the weighting it claims: on T1 urine
  // is dark against liver, on an inversion recovery fluid is bright and muscle is dark.
  const declaredStudy=MR_STUDIES.find(s=>s.path===id);
  assert.ok(declaredStudy,`${id}: no study declares this path`);
  assert.equal(manifest.weighting,declaredStudy.label,`${id}: manifest weighting disagrees with the study list`);
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

// ── Windowing ──────────────────────────────────────────────────────────────────────────────────
assert.equal(windowed(40,400,40),.5,'the window centre must sit mid grey');
assert.equal(windowed(-1000,400,40),0);assert.equal(windowed(3000,400,40),1);
for(const w of CT_WINDOWS)assert.ok(w.width>0&&w.name.trim(),`${w.id}: needs a width and a name`);
assert.equal(ctWindow('lung').level,-600);
assert.throws(()=>ctWindow('pancreas'),/Unknown window/);
assert.throws(()=>plane('oblique'),/Unknown plane/);
for(const study of MR_STUDIES)assert.equal(mrStudy(study.id).path,study.path);
assert.throws(()=>mrStudy('dwi'),/Unknown study/);
console.log('Manifests, label coverage, section geometry, sampling, CT densities and MR weightings all check out.');
