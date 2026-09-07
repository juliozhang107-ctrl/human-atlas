import assert from 'node:assert/strict';
import {loadAtlas} from './atlas-source.mjs';
import {PLANES,plane,frameFor,pixelToPlane,crossSection,fillSegments,byDescendingVolume} from '../app/slice.ts';
import {TISSUES,hounsfield,MU_WATER,sectionTissue,tissueFor,isEnvelope} from '../app/radiograph.ts';
import {RELAXATION,ACOUSTIC,SEQUENCES,CT_WINDOWS,MODALITIES,sequence,ctWindow,modality,mrSignal,reflection,windowed} from '../app/modalities.ts';

// ── Plane frames ────────────────────────────────────────────────────────────────────────────────
assert.equal(PLANES.length,3);
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
for(const p of PLANES){
 for(const [label,v] of [['normal',p.normal],['right',p.right],['up',p.up]])assert.ok(Math.abs(dot(v,v)-1)<1e-9,`${p.id}: ${label} is not a unit vector`);
 assert.ok(Math.abs(dot(p.normal,p.right))<1e-9&&Math.abs(dot(p.normal,p.up))<1e-9&&Math.abs(dot(p.right,p.up))<1e-9,`${p.id}: frame is not orthogonal`);
}
// Reading-room orientation. Axial and coronal put the patient's right (-x) on the left of the
// image, so their right vector runs toward patient left. Sagittal puts anterior on the left, so its
// right vector runs posteriorly.
assert.ok(plane('axial').right[0]>0&&plane('coronal').right[0]>0,'frontal planes must place the patient’s right on the left of the image');
assert.ok(plane('sagittal').right[2]<0,'sagittal must be displayed with anterior to the left');
assert.equal(plane('axial').axis,1);assert.equal(plane('coronal').axis,2);assert.equal(plane('sagittal').axis,0);
assert.throws(()=>plane('oblique'),/Unknown plane/);

// ── Cutting and filling, against shapes whose area is known exactly ─────────────────────────────
/** Axis-aligned box as an indexed triangle mesh. */
const box=(x0,y0,z0,x1,y1,z1)=>{
 const v=[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
 const f=[[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1],[3,2,6],[3,6,7],[0,3,7],[0,7,4],[1,5,6],[1,6,2]];
 return {positions:new Float32Array(v.flat()),indices:new Uint32Array(f.flat())};
};
const axial=plane('axial');
const frame=frameFor(-.1,1.1,-.1,1.1,240);
assert.equal(frame.height,240,'a square field must give a square frame');
const cube=box(0,0,0,1,1,1);
let segments=[];
const count=crossSection(cube.positions,cube.indices,axial,.5,frame,segments);
assert.ok(count>=4,`a plane through a cube must cut at least four triangles, cut ${count}`);
assert.equal(segments.length,count*4);
let labels=new Int32Array(frame.width*frame.height).fill(-1);
let painted=fillSegments(segments,frame,labels,7);
const pixelsPerMetre=frame.scale,expected=1*1*pixelsPerMetre*pixelsPerMetre;
assert.ok(Math.abs(painted-expected)/expected<.02,`cube section area off by more than 2%: ${painted} vs ${expected}`);
assert.ok(labels.every(v=>v===7||v===-1),'fill must only write its own label');

// A plane that misses the shape entirely produces nothing.
segments=[];
assert.equal(crossSection(cube.positions,cube.indices,axial,2.5,frame,segments),0,'a plane outside the mesh must not cut it');
assert.equal(fillSegments(segments,frame,new Int32Array(4),1),0,'an empty segment list fills nothing');

// Even–odd must hollow out a nested shell rather than filling straight over it.
const shell={positions:new Float32Array([...cube.positions,...box(.25,-.5,.25,.75,1.5,.75).positions]),
 indices:new Uint32Array([...cube.indices,...box(0,0,0,1,1,1).indices.map(i=>i+8)])};
segments=[];crossSection(shell.positions,shell.indices,axial,.5,frame,segments);
labels=new Int32Array(frame.width*frame.height).fill(-1);
const annulus=fillSegments(segments,frame,labels,3);
const inner=.5*.5*pixelsPerMetre*pixelsPerMetre;
assert.ok(Math.abs(annulus-(expected-inner))/(expected-inner)<.03,`nested shell must leave a hole: ${annulus} vs ${expected-inner}`);
const centre=labels[Math.floor(frame.height/2)*frame.width+Math.floor(frame.width/2)];
assert.equal(centre,-1,'the centre of a hollow section must stay unlabelled');

// Pixel centres must map back onto the plane they came from.
const [u,v]=pixelToPlane(frame,10,20);
assert.ok(Math.abs(u-(frame.u0+10.5/frame.scale))<1e-9&&Math.abs(v-(frame.v0+(frame.height-20.5)/frame.scale))<1e-9,'pixel mapping must round trip');

// Larger structures are painted first so a more specific one can overwrite them.
const ordered=byDescendingVolume([{bounds:[[0,0,0],[1,1,1]]},{bounds:[[0,0,0],[3,3,3]]},{bounds:[[0,0,0],[2,2,2]]}]);
assert.deepEqual(ordered.map(p=>p.bounds[1][0]),[3,2,1],'painting order must run from largest to smallest');

// ── CT ─────────────────────────────────────────────────────────────────────────────────────────
assert.equal(hounsfield('fluid'),0,'water must sit at zero Hounsfield units by definition');
assert.ok(Math.abs(hounsfield('air')+1000)<3,`air must sit near -1000 HU, got ${hounsfield('air')}`);
assert.ok(hounsfield('lung')<-600&&hounsfield('lung')>-900,`inflated lung must fall between -900 and -600 HU, got ${hounsfield('lung')}`);
assert.ok(hounsfield('fat')<0&&hounsfield('fat')>-200,`fat must be modestly negative, got ${hounsfield('fat')}`);
assert.ok(hounsfield('bone')>300,'bone must be strongly positive');
assert.equal(MU_WATER,TISSUES.fluid.mu);
// Hounsfield units are derived from the coefficients, so the two orderings can never disagree.
const byMu=Object.keys(TISSUES).sort((a,b)=>TISSUES[a].mu-TISSUES[b].mu);
for(let i=1;i<byMu.length;i++)assert.ok(hounsfield(byMu[i])>=hounsfield(byMu[i-1]),`${byMu[i]} breaks the ordering shared with attenuation`);
assert.equal(windowed(40,400,40),.5,'the window centre must sit mid grey');
assert.equal(windowed(-1000,400,40),0);assert.equal(windowed(3000,400,40),1);
for(const w of CT_WINDOWS){assert.ok(w.width>0,`${w.id}: width must be positive`);assert.ok(w.name.trim());}
assert.equal(ctWindow('lung').level,-600);
assert.throws(()=>ctWindow('pancreas'),/Unknown window/);

// ── MR ─────────────────────────────────────────────────────────────────────────────────────────
for(const [id,t] of Object.entries(RELAXATION)){
 assert.ok(t.pd>=0&&t.pd<=1,`${id}: proton density out of range`);
 assert.ok(t.t1>0&&t.t2>0,`${id}: relaxation times must be positive`);
 assert.ok(t.t2<=t.t1,`${id}: T2 cannot exceed T1`);
}
const signal=(tissue,seq)=>mrSignal(RELAXATION[tissue],sequence(seq));
// The contrast a resident reads off each sequence.
assert.ok(signal('fat','t1')>signal('muscle','t1'),'fat must be brighter than muscle on T1');
assert.ok(signal('fat','t1')>signal('fluid','t1'),'fluid must be dark on T1');
assert.ok(signal('fluid','t2')>signal('muscle','t2'),'fluid must be bright on T2');
assert.ok(signal('fluid','t2')>signal('fluid','t1'),'fluid must gain signal from T1 to T2');
assert.ok(signal('bone','t1')>signal('muscle','t1'),'fatty marrow must be bright on T1');
assert.ok(signal('air','t1')===0&&signal('air','t2')===0,'air must return no signal');
assert.ok(signal('tooth','t1')<.05,'enamel must be effectively signalless');
// Inversion recovery must null what it is tuned to null.
const fatStir=signal('fat','stir'),muscleStir=signal('muscle','stir');
assert.ok(fatStir<muscleStir*.35,`STIR must suppress fat: fat ${fatStir.toFixed(4)} vs muscle ${muscleStir.toFixed(4)}`);
const fluidFlair=signal('fluid','flair');
assert.ok(fluidFlair<signal('brain','flair'),'FLAIR must suppress free fluid below brain');
assert.ok(fluidFlair<signal('fluid','t2')*.2,'FLAIR must null fluid relative to T2');
for(const s of SEQUENCES){assert.ok(s.tr>s.te,`${s.id}: TE cannot exceed TR`);if(s.ti!==undefined)assert.ok(s.ti<s.tr,`${s.id}: TI must fall inside TR`);}
assert.throws(()=>sequence('dwi'),/Unknown sequence/);

// ── Ultrasound ─────────────────────────────────────────────────────────────────────────────────
for(const [id,a] of Object.entries(ACOUSTIC)){
 assert.ok(a.z>0,`${id}: impedance must be positive`);
 assert.ok(a.alpha>0,`${id}: attenuation must be positive`);
}
assert.equal(reflection(1.5,1.5),0,'matched impedances must not reflect');
assert.ok(Math.abs(reflection(1.4,1.6)-reflection(1.6,1.4))<1e-12,'reflection must not depend on direction');
for(const a of Object.values(ACOUSTIC))for(const b of Object.values(ACOUSTIC)){
 const r=reflection(a.z,b.z);assert.ok(r>=0&&r<=1,'reflection must stay a fraction');
}
// The two findings a resident is taught to recognise.
assert.ok(reflection(ACOUSTIC.soft.z,ACOUSTIC.bone.z)>.4,'bone must reflect most of the beam and shadow behind');
assert.ok(reflection(ACOUSTIC.soft.z,ACOUSTIC.air.z)>.99,'gas must reflect essentially all of the beam');
assert.ok(reflection(ACOUSTIC.soft.z,ACOUSTIC.fluid.z)<.01,'fluid must let the beam through and enhance behind');
assert.ok(ACOUSTIC.fluid.alpha<ACOUSTIC.soft.alpha/10,'fluid must attenuate far less than soft tissue');
assert.ok(ACOUSTIC.bone.alpha>10*ACOUSTIC.soft.alpha,'bone must attenuate enough to cast a shadow');

// ── Modalities and the atlas itself ────────────────────────────────────────────────────────────
assert.equal(MODALITIES.filter(m=>m.cross).length,3,'CT, MR and ultrasound are the cross-sectional modalities');
assert.equal(modality('radiograph').cross,false,'a radiograph is a projection, not a section');
assert.throws(()=>modality('pet'),/Unknown modality/);
const {atlas,geometry}=loadAtlas();
for(const part of atlas.parts){
 assert.ok(RELAXATION[sectionTissue(part)],`${part.name}: no relaxation constants`);
 assert.ok(ACOUSTIC[sectionTissue(part)],`${part.name}: no acoustic constants`);
}
// The envelope is the soft-tissue fill of a projection but the interstitial space of a section.
const envelope=atlas.parts.find(isEnvelope);
assert.equal(tissueFor(envelope),'skin');
assert.equal(sectionTissue(envelope),'fat','unfilled space inside the body reads as fat in section');

// A real cut through L2 must contain the structures a reader would expect to name there.
const l2=atlas.parts.filter(p=>p.name==='Second lumbar vertebra');
const offset=(l2[0].bounds[0][1]+l2[0].bounds[1][1])/2;
const straddling=atlas.parts.map((p,index)=>({...p,index})).filter(p=>offset>=p.bounds[0][1]&&offset<=p.bounds[1][1]);
const sliceFrame=frameFor(-.25,.25,-.16,.16,256);
const map=new Int32Array(sliceFrame.width*sliceFrame.height).fill(-1);
let sectioned=0;
for(const part of byDescendingVolume(straddling)){
 const g=geometry(part),segs=[];
 crossSection(g.positions,g.indices,plane('axial'),offset,sliceFrame,segs);
 if(segs.length&&fillSegments(segs,sliceFrame,map,part.index))sectioned++;
}
assert.ok(sectioned>50,`an axial cut at L2 should section many structures, sectioned ${sectioned}`);
const names=new Set([...new Set(map)].filter(i=>i>=0).map(i=>atlas.parts[i].name));
for(const expected of ['Second lumbar vertebra','Abdominal aorta','Skin'])
 assert.ok([...names].some(n=>n===expected),`an axial cut at L2 must show ${expected}`);
assert.ok([...names].some(n=>/psoas/i.test(n)),'an axial cut at L2 must show psoas');
const filled=[...map].filter(v=>v>=0).length;
assert.ok(filled>map.length*.15,'a trunk section must fill a reasonable share of the field');

console.log(`Slice engine: cut and fill verified against analytic areas, nested shells, and a real cut at L2 naming ${names.size} structures.`);
console.log(`CT: ${CT_WINDOWS.length} windows, Hounsfield scale derived from the attenuation coefficients and ordered with them.`);
console.log(`MR: ${SEQUENCES.length} sequences; T1, T2, STIR fat nulling and FLAIR fluid nulling all behave as read.`);
console.log(`Ultrasound: impedance and attenuation give shadowing behind bone and gas and enhancement behind fluid.`);
