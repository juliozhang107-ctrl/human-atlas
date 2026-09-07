import type {SystemId} from './anatomy';

/** Linear attenuation coefficients in cm^-1 at a 70 keV effective beam energy, taken as the NIST
 *  mass attenuation coefficient for the tissue multiplied by its density. Whole-bone meshes enclose
 *  the marrow cavity as well as the cortex, so `bone` is the blended value for that whole volume
 *  rather than the much higher coefficient of compact cortical bone alone. */
export type TissueId = 'air'|'lung'|'bowel'|'fat'|'fluid'|'soft'|'brain'|'blood'|'muscle'|'organ'|'skin'|'cartilage'|'bone'|'tooth';
export const TISSUES: Record<TissueId,{name:string;density:number;mu:number}> = {
 air:      {name:'Air',                density:.0012, mu:.0002},
 lung:     {name:'Inflated lung',      density:.26,   mu:.051},
 bowel:    {name:'Bowel and content',   density:.90,  mu:.175},
 fat:      {name:'Adipose tissue',     density:.95,   mu:.177},
 fluid:    {name:'Serous fluid',       density:1.00,  mu:.194},
 soft:     {name:'Soft tissue',        density:1.00,  mu:.194},
 brain:    {name:'Brain',              density:1.04,  mu:.201},
 muscle:   {name:'Skeletal muscle',    density:1.05,  mu:.206},
 blood:    {name:'Blood',              density:1.06,  mu:.208},
 organ:    {name:'Solid viscus',       density:1.06,  mu:.209},
 skin:     {name:'Skin',               density:1.09,  mu:.213},
 cartilage:{name:'Cartilage and tendon',density:1.10, mu:.219},
 bone:     {name:'Bone',               density:1.55,  mu:.480},
 tooth:    {name:'Dental enamel',      density:2.96,  mu:1.010},
};

/** The single mesh that bounds the body. It is a thin shell in this atlas, not a solid volume, so
 *  what it contributes is the span it encloses rather than its own thickness: a beam is filled with
 *  tissue between the first and last time it meets the shell, and a section is filled by flooding
 *  inward from its outline.
 *
 *  That fill is adipose rather than water. The space inside the body that no mesh models is mostly
 *  fat and loose connective tissue, which is why it reads dark on a section. Every modelled
 *  structure then contributes only its excess over that fill, so the same assumption holds whether
 *  the anatomy is projected or sectioned. */
export const ENVELOPE_PART = 'Skin';
export const FILL_TISSUE:TissueId = 'fat';
export function isEnvelope(part:{name:string;system:SystemId}){return part.system==='integumentary' && part.name===ENVELOPE_PART;}

const RULES: [RegExp,TissueId][] = [
 [/tooth|teeth|enamel|dentine/,'tooth'],
 [/gingiva/,'soft'],
 [/cartilage|meniscus|intervertebral dis[ck]|labrum|tendon|ligament|aponeurosis|interosseous membrane|trochlea/,'cartilage'],
 [/bronch|trachea|larynx|nasal cavity|paranasal|ethmoidal sinus|frontal sinus|maxillary sinus|sphenoidal sinus|pharynx|air cell/,'air'],
 [/lung|alveol/,'lung'],
 [/cavity of (left|right) (atrium|ventricle)|lumen of/,'blood'],
 [/valve|cusp|leaflet|chorda|papillary/,'muscle'],
 [/wall of (left|right) (atrium|ventricle)|myocardium/,'muscle'],
 [/ventricle|cerebral aqueduct|interventricular foramen|subarachnoid|cistern/,'fluid'],
 [/mesocolon|mesentery|omentum|epiploic/,'fat'],
 [/taenia/,'muscle'],
 [/stomach|colon|ileum|jejunum|duodenum|rectum|appendix|cecum|caecum/,'bowel'],
 [/liver|hepatovenous segment|hepatic segment|pancreas|spleen|kidney|thymus|adrenal|thyroid|prostate|testis|ovary|gland|tonsil|pineal|pituitary/,'organ'],
 [/gallbladder|bladder|ureter|urethra|bile|biliary|duct|cyst/,'fluid'],
 [/lens of|vitreous|aqueous|eyeball|cornea|sclera/,'fluid'],
 [/fat|adipose|marrow/,'fat'],
 [/hair|eyebrow|lip/,'soft'],
];
const BY_SYSTEM: Record<SystemId,TissueId> = {
 skeletal:'bone', muscular:'muscle', arterial:'blood', venous:'blood', nervous:'brain',
 digestive:'organ', respiratory:'air', urinary:'organ', reproductive:'soft', lymphatic:'organ',
 endocrine:'organ', integumentary:'skin', connective:'cartilage', sensory:'soft', cardiac:'muscle',
};

/** Name rules win over the system fallback so that, for example, a bronchial tree inside the
 *  respiratory system reads as air while the trachea's cartilage rings do not. */
export function tissueFor(part:{name:string;system:SystemId}):TissueId{
 const name=part.name.toLowerCase();
 for(const [pattern,tissue] of RULES) if(pattern.test(name)) return tissue;
 return BY_SYSTEM[part.system] ?? 'soft';
}
export function muFor(part:{name:string;system:SystemId}){return TISSUES[tissueFor(part)].mu;}


/** Attenuation a structure adds to the beam, in cm^-1. With the body filled, a structure adds only
 *  what it has over the fill it displaces, so gas-filled airways subtract and bone adds strongly.
 *  The envelope itself is handled by the span it encloses, not by this value. */
export const FILL_MU=TISSUES[FILL_TISSUE].mu;
export function contributionFor(part:{name:string;system:SystemId},envelopePresent:boolean){
 if(isEnvelope(part)) return envelopePresent?FILL_MU:0;
 return envelopePresent ? muFor(part)-FILL_MU : muFor(part);
}

/** The beam's path through the body: the span between the first and last meeting with the shell. */
export function bodySpan(hits:Hit[],envelopeIndex:number){
 let near=Infinity,far=-Infinity;
 for(const hit of hits)if(hit.index===envelopeIndex){if(hit.distance<near)near=hit.distance;if(hit.distance>far)far=hit.distance;}
 return far>near?far-near:0;
}

export type ProjectionId = 'ap'|'pa'|'lateral'|'oblique';
/** `beam` points from the tube toward the detector. `right` and `up` span the detector, oriented so
 *  that frontal films are read as if facing the patient: the patient's right side falls on the left
 *  of the image. Axes of the atlas are +x patient left, +y superior, +z anterior. */
export interface Projection {id:ProjectionId;name:string;abbr:string;description:string;beam:[number,number,number];right:[number,number,number];up:[number,number,number]}
const OBLIQUE=Math.SQRT1_2;
export const PROJECTIONS: Projection[] = [
 {id:'ap',     name:'Anteroposterior', abbr:'AP',  description:'Tube in front of the patient, detector behind. The heart and anterior structures sit further from the detector and are magnified.', beam:[0,0,-1], right:[1,0,0],  up:[0,1,0]},
 {id:'pa',     name:'Posteroanterior', abbr:'PA',  description:'Tube behind the patient, detector in front. The standard erect chest projection, with less magnification of anterior structures.', beam:[0,0,1],  right:[1,0,0],  up:[0,1,0]},
 {id:'lateral',name:'Left lateral',    abbr:'LAT', description:'Tube at the patient’s right, detector against the left side. Displayed with the patient facing the left of the image.', beam:[-1,0,0], right:[0,0,-1], up:[0,1,0]},
 {id:'oblique',name:'Right anterior oblique',abbr:'RAO',description:'Tube rotated 45 degrees between the frontal and lateral positions, separating structures that overlap on a frontal film.', beam:[-OBLIQUE,0,-OBLIQUE], right:[OBLIQUE,0,-OBLIQUE], up:[0,1,0]},
];
export function projection(id:ProjectionId){const p=PROJECTIONS.find(x=>x.id===id);if(!p)throw new Error(`Unknown projection: ${id}. Expected one of ${PROJECTIONS.map(x=>x.id).join(', ')}.`);return p;}

/** One surface crossing of the beam, in the order the beam meets it. Distances are along the ray. */
export interface Crossing {index:number;entry:number;exit:number;thickness:number;attenuation:number}
export interface Hit {index:number;distance:number;front:boolean}
/** What one beam through the body found, in the order the beam met each structure. */
export interface BeamReading {total:number;crossings:Crossing[]}

/** Walk the sorted surface hits and pair each entry with its matching exit, so that a structure the
 *  beam enters and leaves several times contributes the sum of the segments actually traversed.
 *  Distances arrive in metres and the coefficients are per centimetre, hence the factor of 100. */
export function integrateBeam(hits:Hit[],contribution:(index:number)=>number){
 const ordered=[...hits].sort((a,b)=>a.distance-b.distance);
 const open=new Map<number,{depth:number;entry:number}>();
 const spans=new Map<number,{entry:number;exit:number;thickness:number}>();
 for(const hit of ordered){
  let state=open.get(hit.index);
  if(!state){state={depth:0,entry:0};open.set(hit.index,state);
   // A first hit on a back face means the ray began inside the structure.
   if(!hit.front)state.depth=1;}
  if(hit.front){if(state.depth===0)state.entry=hit.distance;state.depth++;}
  else{state.depth=Math.max(0,state.depth-1);
   if(state.depth===0){const span=spans.get(hit.index)??{entry:state.entry,exit:hit.distance,thickness:0};
    span.exit=hit.distance;span.thickness+=hit.distance-state.entry;spans.set(hit.index,span);}}
 }
 const crossings:Crossing[]=[];let total=0;
 for(const [index,span] of spans){
  const attenuation=contribution(index)*span.thickness*100;
  total+=attenuation;
  crossings.push({index,entry:span.entry,exit:span.exit,thickness:span.thickness,attenuation});
 }
 crossings.sort((a,b)=>a.entry-b.entry);
 return {total,crossings};
}

/** Beer–Lambert transmission through the accumulated attenuation. */
export function transmission(total:number){return Math.exp(-total);}

/** Radiographic greyscale. Attenuation maps to brightness, so bone reads white and air reads black,
 *  windowed the way a viewing console windows a study. */
export const DEFAULT_WINDOW={level:2.9,width:5.8};
export function displayValue(total:number,level=DEFAULT_WINDOW.level,width=DEFAULT_WINDOW.width){
 const low=level-width/2;
 return Math.min(1,Math.max(0,(total-low)/Math.max(1e-6,width)));
}

