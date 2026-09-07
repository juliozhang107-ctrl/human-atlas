/** What the app offers, and how a CT study is windowed.
 *
 *  CT and MRI are real acquisitions rather than models, so the tissue constants that once shaded
 *  synthetic sections are gone: a CT already carries Hounsfield units, and an MR study is one
 *  acquisition with no absolute scale to convert. What remains is the modality list and the window
 *  presets a console keeps. */
/** Windows a reading room keeps on the console. Width and level are in Hounsfield units. */
export interface Window {id:string;name:string;width:number;level:number}
export const CT_WINDOWS: Window[] = [
 {id:'soft',       name:'Soft tissue', width:400,  level:40},
 {id:'lung',       name:'Lung',        width:1500, level:-600},
 {id:'bone',       name:'Bone',        width:2000, level:400},
 {id:'brain',      name:'Brain',       width:80,   level:40},
 {id:'liver',      name:'Liver',       width:150,  level:60},
 {id:'mediastinum',name:'Mediastinum', width:350,  level:50},
];
export function ctWindow(id:string){const w=CT_WINDOWS.find(x=>x.id===id);if(!w)throw new Error(`Unknown window: ${id}. Expected one of ${CT_WINDOWS.map(x=>x.id).join(', ')}.`);return w;}
/** Map a value to 0..1 through a width and level, the way a console maps a study to the display. */
export function windowed(value:number,width:number,level:number){
 return Math.min(1,Math.max(0,(value-(level-width/2))/Math.max(1e-6,width)));
}

/** The studies on offer, by modality.
 *
 *  No single clinical study covers a whole body: CT and MRI are acquired per region, and even a
 *  protocol called whole body stops at the thighs. So the body arrives in two studies of two
 *  patients, one running from the neck to the feet and one covering the head and neck, which
 *  overlap at the shoulders.
 *
 *  A magnetic resonance sequence is a study too, not a display setting. One acquisition carries one
 *  weighting: a T2 cannot be derived from a T1 the way a bone window is derived from a soft-tissue
 *  one. Each is labelled with the weighting measured from its own tissue signals rather than read
 *  from metadata this collection records in mixed units. */
export interface Study {modality:'ct'|'mr';id:string;path:string;label:string;subject:string;coverage:string;description:string}
export const STUDIES: Study[] = [
 {modality:'ct',id:'body',path:'ct',      label:'Body', subject:'s0287', coverage:'neck to feet, 125 cm',
  description:'A contrast angiogram of the trunk and legs. The widest study in the collection that also covers the trunk.'},
 {modality:'ct',id:'head',path:'ct-head', label:'Head', subject:'s0643', coverage:'head to upper chest, 39 cm',
  description:'A head and neck angiogram, carrying the brain, skull and cervical spine the body study stops short of.'},
 {modality:'mr',id:'t1',  path:'mr-t1',  label:'T1',  subject:'s0175', coverage:'head to thigh, 108 cm',
  description:'Fat and marrow bright, urine dark against liver. The study to read anatomy from.'},
 {modality:'mr',id:'t1fs',path:'mr-t1fs',label:'T1 FS',subject:'s0187', coverage:'abdomen and pelvis, 45 cm',
  description:'T1 with fat suppressed, and the only study acquired near-isotropically, so it stays sharp reformatted into any plane.'},
 {modality:'mr',id:'t2',  path:'mr-t2',  label:'T2',  subject:'s0173', coverage:'abdomen, 40 cm',
  description:'Fluid and spleen bright, muscle dark, fat still bright. Where most pathology shows.'},
 {modality:'mr',id:'stir',path:'mr-stir',label:'STIR',subject:'s0190', coverage:'chest to pelvis, 50 cm',
  description:'Inversion recovery with fat nulled, so only fluid stays bright. For oedema and marrow.'},
];
export function studiesFor(modality:string){return STUDIES.filter(s=>s.modality===modality);}
export function study(modality:string,id:string){
 const found=STUDIES.find(s=>s.modality===modality&&s.id===id)??studiesFor(modality)[0];
 if(!found)throw new Error(`No study for ${modality}. Expected one of ${STUDIES.map(s=>`${s.modality}/${s.id}`).join(', ')}.`);
 return found;
}

export type ModalityId = 'radiograph'|'ct'|'mr'|'us';
/** `interactive` marks the modalities the browser offers. Ultrasound stays in the renderer and its
 *  physics stays tested, but it is not offered in the app: a sector traced through surface meshes
 *  teaches shadowing and enhancement honestly and little else, and real ultrasound is dominated by
 *  speckle and tissue microstructure that this geometry cannot carry. */
export interface Modality {id:ModalityId;name:string;abbr:string;cross:boolean;interactive:boolean;description:string}
export const MODALITIES: Modality[] = [
 {id:'radiograph',name:'Radiography',abbr:'XR',cross:false,interactive:true,description:'A projection: attenuation summed along every ray from the tube to the detector.'},
 {id:'ct',        name:'Computed tomography',abbr:'CT',cross:true,interactive:true,description:'A cross-section of the same attenuation, expressed in Hounsfield units and windowed.'},
 {id:'mr',        name:'Magnetic resonance imaging',abbr:'MRI',cross:true,interactive:true,description:'A cross-section of spin echo signal from proton density and the T1 and T2 of each tissue.'},
 {id:'us',        name:'Ultrasound',abbr:'US',cross:true,interactive:false,description:'A sector scan: echoes from impedance mismatches, attenuated with depth, with shadowing behind bone and gas.'},
];
export function modality(id:ModalityId){const m=MODALITIES.find(x=>x.id===id);if(!m)throw new Error(`Unknown modality: ${id}. Expected one of ${MODALITIES.map(x=>x.id).join(', ')}.`);return m;}
