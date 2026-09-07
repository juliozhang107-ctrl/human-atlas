import type {TissueId} from './radiograph';

/** Relaxation constants at 1.5 T and acoustic properties for the tissues the atlas can represent.
 *  These are reference values for normal tissue, not measurements from this anatomy: the images
 *  built from them are synthetic phantoms that show where structures lie and roughly how each
 *  modality would render them, not acquired studies. Nothing here models pathology, noise beyond a
 *  speckle texture, partial volume within a structure, flow, susceptibility or chemical shift. */
export interface Relaxation {pd:number;t1:number;t2:number}
export const RELAXATION: Record<TissueId,Relaxation> = {
 air:      {pd:.00, t1:1,    t2:1},
 lung:     {pd:.10, t1:1200, t2:50},
 bowel:    {pd:.75, t1:900,  t2:100},
 fat:      {pd:1.0, t1:260,  t2:80},
 fluid:    {pd:1.0, t1:3500, t2:1500},
 soft:     {pd:.90, t1:800,  t2:70},
 brain:    {pd:.83, t1:780,  t2:90},
 muscle:   {pd:.85, t1:870,  t2:45},
 blood:    {pd:.90, t1:1400, t2:250},
 organ:    {pd:.85, t1:550,  t2:50},
 skin:     {pd:.90, t1:800,  t2:60},
 cartilage:{pd:.50, t1:1000, t2:30},
 bone:     {pd:.60, t1:350,  t2:60},
 tooth:    {pd:.03, t1:1,    t2:1},
};

export type SequenceId = 't1'|'t2'|'pd'|'flair'|'stir';
/** Inversion times are chosen to null a tissue: STIR nulls fat at roughly 0.693 times its T1, and
 *  FLAIR nulls free fluid the same way. */
export interface Sequence {id:SequenceId;name:string;abbr:string;description:string;tr:number;te:number;ti?:number}
export const SEQUENCES: Sequence[] = [
 {id:'t1',   name:'T1 weighted',   abbr:'T1',    description:'Short TR and TE. Fat and marrow are bright, fluid is dark. Best for anatomy.', tr:500,  te:12},
 {id:'t2',   name:'T2 weighted',   abbr:'T2',    description:'Long TR and TE. Fluid is bright, muscle dark. Best for oedema and most pathology.', tr:4000, te:100},
 {id:'pd',   name:'Proton density',abbr:'PD',    description:'Long TR, short TE. Contrast follows the number of mobile protons.', tr:3000, te:15},
 {id:'flair',name:'FLAIR',         abbr:'FLAIR', description:'T2 weighting with free fluid nulled by inversion, so periventricular signal stands out.', tr:9000, te:120, ti:2500},
 {id:'stir', name:'STIR',          abbr:'STIR',  description:'Inversion recovery with fat nulled, so marrow oedema and soft-tissue fluid stand out.', tr:4000, te:40, ti:160},
];
export function sequence(id:SequenceId){const s=SEQUENCES.find(x=>x.id===id);if(!s)throw new Error(`Unknown sequence: ${id}. Expected one of ${SEQUENCES.map(x=>x.id).join(', ')}.`);return s;}

/** Spin echo, or inversion recovery when the sequence sets an inversion time. */
export function mrSignal(t:Relaxation,s:Sequence){
 if(!t.pd)return 0;
 const longitudinal=s.ti===undefined
  ? 1-Math.exp(-s.tr/t.t1)
  : Math.abs(1-2*Math.exp(-s.ti/t.t1)+Math.exp(-s.tr/t.t1));
 return t.pd*longitudinal*Math.exp(-s.te/t.t2);
}

/** Acoustic impedance in MRayl and attenuation in dB per centimetre per megahertz. The impedance
 *  mismatch at an interface sets how much of the beam returns as echo; what is left carries on and
 *  is attenuated. Bone and gas reflect almost everything, which is why they cast shadows. */
export interface Acoustic {z:number;alpha:number}
export const ACOUSTIC: Record<TissueId,Acoustic> = {
 air:      {z:.0004, alpha:12},
 lung:     {z:.26,   alpha:40},
 bowel:    {z:1.35,  alpha:1.0},
 fat:      {z:1.38,  alpha:.6},
 fluid:    {z:1.48,  alpha:.02},
 soft:     {z:1.63,  alpha:.7},
 brain:    {z:1.56,  alpha:.6},
 muscle:   {z:1.70,  alpha:1.1},
 blood:    {z:1.68,  alpha:.15},
 organ:    {z:1.65,  alpha:.9},
 skin:     {z:1.62,  alpha:2.0},
 cartilage:{z:1.75,  alpha:1.5},
 bone:     {z:7.80,  alpha:20},
 tooth:    {z:8.00,  alpha:25},
};
/** Fraction of intensity reflected at a boundary between two impedances. */
export function reflection(a:number,b:number){const d=(b-a)/(b+a);return d*d;}

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
