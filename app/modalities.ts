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
 *  Magnetic resonance is not offered. Its preparation survives in `tools/` and the builder, but the
 *  only openly segmented collection is CC BY-NC-SA, which would make this whole build
 *  non-commercial and share-alike for the sake of two studies. */
export interface Study {modality:'ct'|'mr';id:string;path:string;label:string;subject:string;coverage:string;description:string}
export const STUDIES: Study[] = [
 {modality:'ct',id:'body',path:'ct',      label:'Body', subject:'s0287', coverage:'neck to feet, 125 cm',
  description:'A contrast angiogram of the trunk and legs. The widest study in the collection that also covers the trunk.'},
 {modality:'ct',id:'head',path:'ct-head', label:'Head', subject:'s0478', coverage:'head to upper chest, 36 cm',
  description:'A head and neck angiogram, carrying the brain, skull and cervical spine the body study stops short of.'},
];
export function studiesFor(modality:string){return STUDIES.filter(s=>s.modality===modality);}
export function study(modality:string,id:string){
 const found=STUDIES.find(s=>s.modality===modality&&s.id===id)??studiesFor(modality)[0];
 if(!found)throw new Error(`No study for ${modality}. Expected one of ${STUDIES.map(s=>`${s.modality}/${s.id}`).join(', ')}.`);
 return found;
}

export type ModalityId = 'radiograph'|'ct'|'us';
/** `interactive` marks the modalities the browser offers. Ultrasound stays in the renderer and its
 *  physics stays tested, but it is not offered in the app: a sector traced through surface meshes
 *  teaches shadowing and enhancement honestly and little else, and real ultrasound is dominated by
 *  speckle and tissue microstructure that this geometry cannot carry. */
export interface Modality {id:ModalityId;name:string;abbr:string;cross:boolean;interactive:boolean;description:string}
export const MODALITIES: Modality[] = [
 {id:'radiograph',name:'Radiography',abbr:'XR',cross:false,interactive:true,description:'A projection: attenuation summed along every ray from the tube to the detector.'},
 {id:'ct',        name:'Computed tomography',abbr:'CT',cross:true,interactive:true,description:'A cross-section of the same attenuation, expressed in Hounsfield units and windowed.'},
 {id:'us',        name:'Ultrasound',abbr:'US',cross:true,interactive:false,description:'A sector scan: echoes from impedance mismatches, attenuated with depth, with shadowing behind bone and gas.'},
];
export function modality(id:ModalityId){const m=MODALITIES.find(x=>x.id===id);if(!m)throw new Error(`Unknown modality: ${id}. Expected one of ${MODALITIES.map(x=>x.id).join(', ')}.`);return m;}
