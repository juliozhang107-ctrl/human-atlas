/** The three cutting planes and how each is displayed. Sections themselves come from real studies,
 *  so what is left here is the convention: which anatomical axis a plane travels along, and which
 *  way round its image is read. */

export type PlaneId = 'axial'|'coronal'|'sagittal';
/** Display conventions follow the reading room. Axial slices are viewed from the feet, so the
 *  patient's right falls on the left of the image with anterior at the top. Coronal slices are
 *  viewed from the front, again with the patient's right on the left. Sagittal slices are displayed
 *  with anterior to the left. Atlas axes are +x patient left, +y superior, +z anterior. */
export interface Plane {id:PlaneId;name:string;description:string;axis:0|1|2;normal:[number,number,number];right:[number,number,number];up:[number,number,number];rightLabel:string;leftLabel:string;topLabel:string;bottomLabel:string}
export const PLANES: Plane[] = [
 {id:'axial',   name:'Axial',   description:'Viewed from the feet. The patient’s right lies on the left of the image and anterior is at the top.', axis:1, normal:[0,1,0], right:[1,0,0],  up:[0,0,1], rightLabel:'L', leftLabel:'R', topLabel:'A', bottomLabel:'P'},
 {id:'coronal', name:'Coronal', description:'Viewed from the front. The patient’s right lies on the left of the image, superior at the top.',       axis:2, normal:[0,0,1], right:[1,0,0],  up:[0,1,0], rightLabel:'L', leftLabel:'R', topLabel:'S', bottomLabel:'I'},
 {id:'sagittal',name:'Sagittal',description:'Viewed from the patient’s left, displayed with anterior to the left of the image.',                    axis:0, normal:[1,0,0], right:[0,0,-1], up:[0,1,0], rightLabel:'P', leftLabel:'A', topLabel:'S', bottomLabel:'I'},
];
export function plane(id:PlaneId){const p=PLANES.find(x=>x.id===id);if(!p)throw new Error(`Unknown plane: ${id}. Expected one of ${PLANES.map(x=>x.id).join(', ')}.`);return p;}
