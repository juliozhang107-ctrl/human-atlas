import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {TISSUES,PROJECTIONS,projection,tissueFor,muFor,contributionFor,isEnvelope,integrateBeam,transmission,displayValue,DEFAULT_WINDOW} from '../app/radiograph.ts';

const atlas=JSON.parse(await readFile(new URL('../public/models/atlas.json',import.meta.url)));

// Coefficients must stay physically ordered: air is nearly transparent, enamel is the densest thing
// in the body, and everything watery sits close to the soft-tissue value.
const order=['air','lung','bowel','fat','fluid','soft','brain','muscle','blood','organ','skin','cartilage','bone','tooth'];
assert.deepEqual(new Set(order),new Set(Object.keys(TISSUES)),'tissue table and ordering disagree');
for(let i=1;i<order.length;i++)assert.ok(TISSUES[order[i]].mu>=TISSUES[order[i-1]].mu,`${order[i]} must attenuate at least as much as ${order[i-1]}`);
assert.ok(TISSUES.bone.mu>2*TISSUES.soft.mu,'bone must stand well clear of soft tissue');
assert.ok(TISSUES.lung.mu<TISSUES.soft.mu/3,'inflated lung must be far more transparent than soft tissue');
for(const [id,t] of Object.entries(TISSUES)){assert.ok(t.mu>0&&t.mu<2,`${id}: coefficient out of range`);assert.ok(t.density>0,`${id}: density must be positive`);assert.ok(t.name.trim(),`${id}: needs a name`);}

// Every part in the atlas must classify, and the body envelope must be unique.
const envelopes=atlas.parts.filter(isEnvelope);
assert.equal(envelopes.length,1,`expected exactly one body envelope, found ${envelopes.length}`);
for(const part of atlas.parts){const tissue=tissueFor(part);assert.ok(TISSUES[tissue],`${part.name}: unclassified`);assert.ok(Number.isFinite(muFor(part)),`${part.name}: no coefficient`);}

// Spot checks against anatomy that must not drift if the rules are edited.
const named=name=>atlas.parts.find(p=>p.name===name);
const expected=[['Left tenth rib','bone'],['Right femur','bone'],['Tenth thoracic vertebra','bone'],['Left main bronchus','air'],
 ['Descending thoracic aorta','blood'],['Diaphragm','muscle'],['Stomach','bowel'],['Left kidney','organ'],['Spleen','organ'],
 ['Skin','skin'],['Left upper first secondary molar tooth','tooth'],['Right calcaneal tendon','cartilage'],
 ['Intervertebral disk of axis','cartilage']];
for(const [name,tissue] of expected){const part=named(name);assert.ok(part,`atlas is missing ${name}`);assert.equal(tissueFor(part),tissue,`${name}: classified as ${tissueFor(part)}`);}

// Fibrocartilage must never be typed as bone: the atlas spells it disk, not disc, and a silent
// spelling miss would put 23 spinal structures at the coefficient of cortical bone.
const disks=atlas.parts.filter(p=>/intervertebral dis[ck]/i.test(p.name));
assert.ok(disks.length>=20,`expected the spinal disks to be present, found ${disks.length}`);
for(const disk of disks)assert.equal(tissueFor(disk),'cartilage',`${disk.name}: intervertebral disks are fibrocartilage`);
// The liver reaches this atlas as Couinaud segments filed under the venous system, so a rule that
// only looks for the word liver would leave the largest abdominal organ reading as blood.
const liver=atlas.parts.filter(p=>/hepatovenous segment/i.test(p.name));
assert.ok(liver.length>=8,`expected the liver segments to be present, found ${liver.length}`);
for(const lobe of liver)assert.equal(tissueFor(lobe),'organ',`${lobe.name}: liver parenchyma must read as a solid viscus`);
const costal=atlas.parts.filter(p=>/costal cartilage/i.test(p.name));
assert.ok(costal.length>=10&&costal.every(p=>tissueFor(p)==='cartilage'),'costal cartilages must not read as bone');

// With the envelope in the beam, internal structures carry only their excess over soft tissue, so
// bone stays positive, bowel gas goes negative, and blood is nearly invisible.
const rib=named('Left tenth rib'),bronchus=named('Left main bronchus'),aorta=named('Descending thoracic aorta');
assert.ok(contributionFor(rib,true)>0,'bone must add attenuation');
assert.ok(contributionFor(bronchus,true)<0,'an air-filled airway must subtract attenuation');
assert.ok(Math.abs(contributionFor(aorta,true))<.02,'blood must be close to soft-tissue neutral');
assert.equal(contributionFor(named('Skin'),true),TISSUES.soft.mu,'the envelope carries the soft-tissue fill');
assert.equal(contributionFor(rib,false),TISSUES.bone.mu,'without an envelope a structure carries its own coefficient');

// Path integration. A 10 cm slab of bone at 0.48 cm^-1 attenuates by 4.8.
const slab=integrateBeam([{index:0,distance:.20,front:true},{index:0,distance:.30,front:false}],()=>TISSUES.bone.mu);
assert.equal(slab.crossings.length,1);
assert.ok(Math.abs(slab.crossings[0].thickness-.10)<1e-12,'slab thickness');
assert.ok(Math.abs(slab.total-TISSUES.bone.mu*10)<1e-9,'slab attenuation');

// Re-entering the same structure adds both segments, and the crossing spans entry to final exit.
const twice=integrateBeam([{index:7,distance:.1,front:true},{index:7,distance:.2,front:false},{index:7,distance:.5,front:true},{index:7,distance:.9,front:false}],()=>1);
assert.equal(twice.crossings.length,1);
assert.ok(Math.abs(twice.crossings[0].thickness-.5)<1e-12,'two segments must sum');
assert.ok(Math.abs(twice.crossings[0].entry-.1)<1e-12&&Math.abs(twice.crossings[0].exit-.9)<1e-12,'span covers first entry to last exit');

// Nested shells: an inner structure inside an outer one contributes independently.
const nested=integrateBeam([{index:1,distance:0,front:true},{index:2,distance:.1,front:true},{index:2,distance:.2,front:false},{index:1,distance:.4,front:false}],i=>i===1?.2:1);
assert.equal(nested.crossings.length,2);
assert.equal(nested.crossings[0].index,1,'crossings are ordered along the beam');
assert.ok(Math.abs(nested.total-(.2*40+1*10))<1e-9,'nested attenuation');

// A self-overlapping mesh must not double count: depth returns to zero only on the outer exit.
const overlap=integrateBeam([{index:3,distance:0,front:true},{index:3,distance:.1,front:true},{index:3,distance:.2,front:false},{index:3,distance:.3,front:false}],()=>1);
assert.ok(Math.abs(overlap.crossings[0].thickness-.3)<1e-12,'overlapping shells count the enclosed span once');

// A ray that starts inside a structure still yields a finite segment rather than a negative one.
const inside=integrateBeam([{index:4,distance:.25,front:false}],()=>1);
assert.ok(inside.crossings[0].thickness>=0&&Math.abs(inside.crossings[0].thickness-.25)<1e-12,'ray beginning inside a structure');

// Unsorted input must give the same answer as sorted input.
const shuffled=integrateBeam([{index:0,distance:.30,front:false},{index:0,distance:.20,front:true}],()=>TISSUES.bone.mu);
assert.ok(Math.abs(shuffled.total-slab.total)<1e-12,'integration must not depend on input order');
assert.deepEqual(integrateBeam([],()=>1),{total:0,crossings:[]},'an empty beam attenuates nothing');

// Projections must be orthonormal frames, or the detector image would be skewed.
assert.equal(PROJECTIONS.length,4);
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
for(const p of PROJECTIONS){
 for(const [label,v] of [['beam',p.beam],['right',p.right],['up',p.up]])assert.ok(Math.abs(dot(v,v)-1)<1e-9,`${p.id}: ${label} is not a unit vector`);
 assert.ok(Math.abs(dot(p.beam,p.right))<1e-9&&Math.abs(dot(p.beam,p.up))<1e-9&&Math.abs(dot(p.right,p.up))<1e-9,`${p.id}: frame is not orthogonal`);
}
// Frontal films are read facing the patient, so the patient's right (-x) falls left of centre.
for(const id of ['ap','pa'])assert.ok(projection(id).right[0]>0,`${id}: patient's right must fall on the left of the image`);
assert.throws(()=>projection('axial'),/Unknown projection/,'unknown projections must be rejected by name');

// Transmission and windowing.
assert.equal(transmission(0),1);
assert.ok(transmission(5)<transmission(1)&&transmission(5)>0,'transmission must fall monotonically');
assert.equal(displayValue(DEFAULT_WINDOW.level),.5,'the window centre must sit mid grey');
assert.equal(displayValue(-100),0);assert.equal(displayValue(100),1);
let previous=-1;
for(let a=0;a<=6;a+=.25){const v=displayValue(a);assert.ok(v>=previous,'display must be monotonic');previous=v;}

const counts=new Map();
for(const part of atlas.parts)counts.set(tissueFor(part),(counts.get(tissueFor(part))??0)+1);
const summary=[...counts].sort((a,b)=>b[1]-a[1]).map(([t,n])=>`${t} ${n}`).join(', ');
console.log(`Attenuation model: ${Object.keys(TISSUES).length} tissues, ${atlas.parts.length} parts classified (${summary}).`);
console.log('Beam integration, projection frames, and windowing checks passed.');
