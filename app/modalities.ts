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

/** Magnetic resonance has no absolute scale, and one acquisition carries one weighting: a T2 cannot
 *  be derived from a T1 the way a bone window can be derived from a soft-tissue one. So a sequence
 *  here means a different study, and each is labelled with the weighting measured from its own
 *  tissue signals rather than read from metadata this collection records in mixed units. */
export interface Study {id:string;path:string;label:string;subject:string;coverage:string;description:string}
export const MR_STUDIES: Study[] = [
 {id:'t1',  path:'mr-t1',  label:'T1',  subject:'s0175', coverage:'head to thigh, 108 cm',
  description:'Fat and marrow bright, urine dark against liver. The study to read anatomy from.'},
 {id:'t2',  path:'mr-t2',  label:'T2',  subject:'s0173', coverage:'abdomen, 40 cm',
  description:'Fluid and spleen bright, muscle dark, fat still bright. Where most pathology shows.'},
 {id:'stir',path:'mr-stir',label:'STIR',subject:'s0190', coverage:'chest to pelvis, 50 cm',
  description:'Inversion recovery with fat nulled, so only fluid stays bright. For oedema and marrow.'},
];
export function mrStudy(id:string){const study=MR_STUDIES.find(s=>s.id===id);if(!study)throw new Error(`Unknown study: ${id}. Expected one of ${MR_STUDIES.map(s=>s.id).join(', ')}.`);return study;}

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
