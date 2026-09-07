import {useEffect,useRef} from 'react';
import * as T from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {createExplosionLayout} from './explosion-layout';
import {decodeModelResponse} from './model-download';
import {PointerTap} from './pointer-tap';
import {SYSTEMS,type Atlas,type SceneState} from './anatomy';
import {contributionFor,integrateBeam,bodySpan,isEnvelope,FILL_MU,type BeamReading,type Crossing,type Hit} from './radiograph';
import {ctWindow} from './modalities';
import {loadVolume,extractSection,sliceCount,type Section,type Volume,type VolumeManifest} from './volume';
/** Two millimetres a notch, matching the position slider. */
export const SLICE_STEP=.002;
interface Props {atlas:Atlas;state:SceneState;onSelect:(id:string)=>void;onProgress:(n:number)=>void;onError:(s:string)=>void;onBeam:(reading:BeamReading|null)=>void;onSlice:(index:number)=>void;onStructure:(name:string)=>void;onVolume:(manifest:VolumeManifest|null)=>void}
export default function AnatomyScene({atlas,state,onSelect,onProgress,onError,onBeam,onSlice,onStructure,onVolume}:Props){
 const host=useRef<HTMLDivElement>(null),latest=useRef(state),select=useRef(onSelect),beam=useRef(onBeam),step=useRef(onSlice),structure=useRef(onStructure),volume=useRef(onVolume);
 latest.current=state;select.current=onSelect;beam.current=onBeam;step.current=onSlice;structure.current=onStructure;volume.current=onVolume;
 useEffect(()=>{
  const el=host.current!;let disposed=false,frame=0,dirty=true,ready=false,lastView='',lastReset=-1,lastIsolate='',layoutKey='',amount=0;
  let lastState:SceneState|null=null;
  const abort=new AbortController();
  let renderer:T.WebGLRenderer;
  try{renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});}catch{onError('This browser could not start the 3D viewer. Please try a browser with WebGL enabled.');return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth<768?1.5:2));renderer.setClearColor('#f2f3f3');renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;el.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label','Interactive human anatomy. Left-drag to orbit, right-drag to pan, scroll or pinch to zoom, and left-click a structure to inspect it.');
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(34,1,.005,100),controls=new OrbitControls(camera,renderer.domElement);
  camera.position.set(1.4,1.05,3.6);controls.target.set(0,.85,0);controls.enableDamping=true;controls.dampingFactor=.085;controls.minDistance=.07;controls.maxDistance=40;controls.maxPolarAngle=Math.PI*.96;controls.addEventListener('change',()=>{dirty=true;});
  const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment(),env=pmrem.fromScene(room,.04);scene.environment=env.texture;room.dispose();pmrem.dispose();
  scene.add(new T.HemisphereLight(0xffffff,0xa7acb2,1.05));
  const key=new T.DirectionalLight(0xfffaf4,2.3);key.position.set(-2,4,3);scene.add(key);
  const rim=new T.DirectionalLight(0xe9f0ff,1.8);rim.position.set(2,2,-3);scene.add(rim);
  const ground=new T.Mesh(new T.CircleGeometry(30,96),new T.MeshStandardMaterial({color:0xd5d9dc,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.019;scene.add(ground);
  const platform=new T.Mesh(new T.CylinderGeometry(.68,.7,.028,100),new T.MeshStandardMaterial({color:0xeeeeec,metalness:.12,roughness:.67}));platform.position.y=-.016;scene.add(platform);
  const ring=new T.Mesh(new T.RingGeometry(.63,.632,128),new T.MeshBasicMaterial({color:0x8c969f,transparent:true,opacity:.4,side:T.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=.001;scene.add(ring);
  const innerRing=new T.Mesh(new T.RingGeometry(.55,.551,128),new T.MeshBasicMaterial({color:0xa4aeb8,transparent:true,opacity:.16,side:T.DoubleSide}));innerRing.rotation.x=-Math.PI/2;innerRing.position.y=.001;scene.add(innerRing);
  const width=T.MathUtils.ceilPowerOfTwo(atlas.parts.length),data=new Float32Array(width*4),partTexture=new T.DataTexture(data,width,1,T.RGBAFormat,T.FloatType);partTexture.needsUpdate=true;
  const selectedData=new Uint8Array(width*4),selectionTexture=new T.DataTexture(selectedData,width,1);selectionTexture.needsUpdate=true;
  const envelopeIndex=atlas.parts.findIndex(isEnvelope),envelopePresent=envelopeIndex>=0;
  const attenuationData=new Float32Array(width*4),attenuationTexture=new T.DataTexture(attenuationData,width,1,T.RGBAFormat,T.FloatType);
  // The envelope is left out of the accumulation because its fill comes from the span it encloses,
  // which the body pass below measures separately.
  atlas.parts.forEach((p,i)=>{attenuationData[i*4]=isEnvelope(p)?0:contributionFor(p,envelopePresent);});attenuationTexture.needsUpdate=true;
  const body=new T.Group();scene.add(body);
  // Geometry is merged per system within each chunk, so a system spanning several chunks yields
  // several meshes. The envelope spans two, and keeping only the last would leave the body pass
  // measuring eyebrows and hair instead of skin.
  const envelopeMeshes:T.Mesh[]=[];
  // The beam pass accumulates a signed distance along each ray: surfaces the beam enters subtract
  // and surfaces it leaves add, so every closed mesh contributes its own coefficient multiplied by
  // the path length actually traversed. Float blending sums those contributions across all tissue.
  const floatType=renderer.extensions.has('EXT_color_buffer_float')?T.FloatType:T.HalfFloatType;
  const beamTarget=new T.WebGLRenderTarget(1,1,{type:floatType,format:T.RGBAFormat,minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:false,stencilBuffer:false});
  const beamMaterial=new T.ShaderMaterial({
   uniforms:{partState:{value:partTexture},attenuation:{value:attenuationTexture},stateWidth:{value:width}},
   vertexShader:`attribute float partIndex; uniform sampler2D partState; uniform sampler2D attenuation; uniform float stateWidth;
    varying float vMu; varying float vDistance; varying float vVisible;
    void main(){ vec2 stateUv=vec2((partIndex+0.5)/stateWidth,0.5); vec4 state=texture2D(partState,stateUv);
     vVisible=state.w; vMu=texture2D(attenuation,stateUv).r;
     vec4 mv=modelViewMatrix*vec4(position+state.xyz,1.0); vDistance=length(mv.xyz); gl_Position=projectionMatrix*mv; }`,
   fragmentShader:`varying float vMu; varying float vDistance; varying float vVisible;
    void main(){ if(vVisible<0.5) discard; float facing=gl_FrontFacing?-1.0:1.0;
     gl_FragColor=vec4(facing*vMu*vDistance*100.0,0.0,0.0,0.0); }`,
   side:T.DoubleSide,depthTest:false,depthWrite:false,transparent:true,
   blending:T.CustomBlending,blendEquation:T.AddEquation,blendSrc:T.OneFactor,blendDst:T.OneFactor,
   blendEquationAlpha:T.AddEquation,blendSrcAlpha:T.OneFactor,blendDstAlpha:T.OneFactor});
  // The skin is a shell, so the tissue in the beam is the span between the nearest and furthest
  // point of that shell. Minimum blending on the colour channels and maximum blending on alpha
  // record both in one pass; a priming quad sets the starting values because a clear cannot.
  const bodyTarget=new T.WebGLRenderTarget(1,1,{type:floatType,format:T.RGBAFormat,minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:false,stencilBuffer:false});
  const bodyMaterial=new T.ShaderMaterial({
   uniforms:{partState:{value:partTexture},stateWidth:{value:width}},
   vertexShader:`attribute float partIndex; uniform sampler2D partState; uniform float stateWidth; varying float vDistance;
    void main(){ vec4 state=texture2D(partState,vec2((partIndex+0.5)/stateWidth,0.5));
     vec4 mv=modelViewMatrix*vec4(position+state.xyz,1.0); vDistance=length(mv.xyz); gl_Position=projectionMatrix*mv; }`,
   fragmentShader:`varying float vDistance; void main(){ gl_FragColor=vec4(vDistance,vDistance,vDistance,vDistance); }`,
   side:T.DoubleSide,depthTest:false,depthWrite:false,transparent:true,
   blending:T.CustomBlending,blendEquation:T.MinEquation,blendSrc:T.OneFactor,blendDst:T.OneFactor,
   blendEquationAlpha:T.MaxEquation,blendSrcAlpha:T.OneFactor,blendDstAlpha:T.OneFactor});
  const primeScene=new T.Scene();
  const prime=new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({depthTest:false,depthWrite:false,blending:T.NoBlending,
   vertexShader:`void main(){ gl_Position=vec4(position.xy,0.0,1.0); }`,
   fragmentShader:`void main(){ gl_FragColor=vec4(1000.0,1000.0,1000.0,0.0); }`}));
  prime.frustumCulled=false;primeScene.add(prime);
  const filmUniforms={beam:{value:beamTarget.texture},bodyDepth:{value:bodyTarget.texture},fill:{value:FILL_MU},level:{value:1},band:{value:2}};
  const filmScene=new T.Scene(),filmCamera=new T.OrthographicCamera(-1,1,1,-1,0,1);
  const filmMaterial=new T.ShaderMaterial({uniforms:filmUniforms,depthTest:false,depthWrite:false,
   vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`,
   fragmentShader:`uniform sampler2D beam; uniform sampler2D bodyDepth; uniform float fill; uniform float level; uniform float band; varying vec2 vUv;
    void main(){ vec4 body=texture2D(bodyDepth,vUv); float span=max(0.0,body.a-body.r);
     float a=texture2D(beam,vUv).r+fill*span*100.0;
     float g=clamp((a-(level-band*0.5))/max(band,1e-4),0.0,1.0);
     gl_FragColor=vec4(vec3(g),1.0); }`});
  const film=new T.Mesh(new T.PlaneGeometry(2,2),filmMaterial);film.frustumCulled=false;filmScene.add(film);
  const pickMaterial=new T.MeshBasicMaterial({side:T.DoubleSide});
  const materials:T.Material[]=[],geometries:T.BufferGeometry[]=[],pickers:(T.Mesh|undefined)[]=[],centers=atlas.parts.map(p=>new T.Vector3().fromArray(p.bounds[0]).add(new T.Vector3().fromArray(p.bounds[1])).multiplyScalar(.5));
  const offsets:T.Vector3[]=[],bounds=atlas.parts.map(p=>new T.Box3(new T.Vector3().fromArray(p.bounds[0]),new T.Vector3().fromArray(p.bounds[1])));
  let packingWidth=1,packingHeight=1;
  const markerPositions=new Float32Array(atlas.parts.length*3),markerGeometry=new T.BufferGeometry();markerGeometry.setAttribute('position',new T.BufferAttribute(markerPositions,3));
  const markerMaterial=new T.PointsMaterial({color:0x64748b,size:5,sizeAttenuation:false,transparent:true,opacity:.72,depthTest:false});
  markerMaterial.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif (distance(gl_PointCoord, vec2(0.5)) > 0.5) discard;');};
  const markers=new T.Points(markerGeometry,markerMaterial);markers.frustumCulled=false;markers.renderOrder=10;markers.visible=false;scene.add(markers);
  const hover=document.createElement('div');hover.className='part-hover';hover.setAttribute('role','tooltip');hover.hidden=true;el.appendChild(hover);
  type Target={index:number;x:number;y:number;left:number;right:number;top:number;bottom:number};let targets:Target[]=[];
  const projected=new T.Vector3();
  const findTarget=(x:number,y:number,radius:number)=>{
   let best=-1,score=Infinity;
   for(const t of targets){const dx=Math.max(t.left-x,0,x-t.right),dy=Math.max(t.top-y,0,y-t.bottom),distance=Math.hypot(dx,dy);if(distance>radius)continue;const candidate=distance+Math.hypot(t.x-x,t.y-y)*.025;if(candidate<score){score=candidate;best=t.index;}}
   return best;
  };
  const materialFor=(system:string)=>{
   const m=new T.MeshStandardMaterial({color:SYSTEMS.find(s=>s.id===system)?.color??'#aebbb8',metalness:.08,roughness:.53,side:T.DoubleSide,transparent:system==='integumentary',opacity:system==='integumentary'?.1:1,depthWrite:system!=='integumentary'});
   m.onBeforeCompile=shader=>{
    shader.uniforms.partState={value:partTexture};shader.uniforms.selectionState={value:selectionTexture};shader.uniforms.stateWidth={value:width};
    shader.vertexShader='attribute float partIndex; uniform sampler2D partState; uniform sampler2D selectionState; uniform float stateWidth; varying float partVisible; varying float partSelected;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvec2 stateUv = vec2((partIndex + 0.5) / stateWidth, 0.5); vec4 state = texture2D(partState, stateUv); transformed += state.xyz; partVisible = state.w; partSelected = texture2D(selectionState, stateUv).r;');
    shader.fragmentShader='varying float partVisible; varying float partSelected;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif (partVisible < 0.5) discard;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.85, 0.78), partSelected * 0.75);');
   };materials.push(m);return m;
  };
  const mats=new Map(SYSTEMS.map(s=>[s.id,materialFor(s.id)]));
  let loaded=0;
  const loadChunk=async(ci:number)=>{
   const chunk=atlas.chunks[ci],compressed=!!chunk.gzip&&typeof DecompressionStream!=='undefined';const response=await fetch(compressed?chunk.gzip!:chunk.url,{signal:abort.signal});const buffer=await decodeModelResponse(response,chunk.bytes,compressed);if(disposed)return;
   const groups=new Map<string,T.BufferGeometry[]>();
   atlas.parts.forEach((p,i)=>{
    if(p.chunk!==ci)return;
    const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(new Float32Array(buffer,p.positions,p.vertexCount*3),3));
    // GPU normalized signed-short normals keep the complete atlas compact in memory.
    g.setAttribute('normal',new T.BufferAttribute(new Int16Array(buffer,p.normals,p.vertexCount*3),3,true));g.setIndex(new T.BufferAttribute(new Uint32Array(buffer,p.indices,p.indexCount),1));
    g.boundingBox=bounds[i].clone();g.computeBoundingSphere();const pick=new T.Mesh(g,pickMaterial);pick.matrixAutoUpdate=false;pickers[i]=pick;geometries.push(g);
    g.setAttribute('partIndex',new T.BufferAttribute(new Float32Array(p.vertexCount).fill(i),1));
    const list=groups.get(p.system)??[];list.push(g);groups.set(p.system,list);
   });
   groups.forEach((gs,system)=>{const geometry=mergeGeometries(gs,false);if(!geometry)throw new Error('Could not assemble anatomy geometry.');geometries.push(geometry);const mesh=new T.Mesh(geometry,mats.get(system as never));mesh.frustumCulled=false;if(system==='integumentary')envelopeMeshes.push(mesh);body.add(mesh);});
   lastState=null;loaded++;onProgress(Math.round(loaded/atlas.chunks.length*100));dirty=true;
  };
  (async()=>{try{let cursor=0;await Promise.all(Array.from({length:3},async()=>{while(cursor<atlas.chunks.length){const i=cursor++;await loadChunk(i);}}));if(!disposed){ready=true;dirty=true;}}catch(e){if(!disposed)onError(e instanceof Error?e.message:'Could not load the anatomy.');}})();
  const fit=(view:string,extent=0)=>{
   const aspect=camera.aspect,mobile=el.clientWidth<768,normalDistance=mobile?Math.max(4.5,1.8*el.clientHeight/Math.max(160,el.clientHeight-350)/(2*Math.tan(T.MathUtils.degToRad(camera.fov/2)))):4;
   const reservedHeight=mobile?350:270;const availableAspect=Math.max(.35,(el.clientWidth-(mobile?40:340))/Math.max(160,el.clientHeight-reservedHeight));const atlasDistance=Math.max(packingHeight,packingWidth/availableAspect)/(2*Math.tan(T.MathUtils.degToRad(camera.fov/2)))*(el.clientHeight/Math.max(160,el.clientHeight-reservedHeight))*1.08;
   const distance=T.MathUtils.lerp(normalDistance,Math.max(.2,atlasDistance),extent);if(extent>.8)view='front';
   const direction=view==='front'?new T.Vector3(0,.02,1):view==='back'?new T.Vector3(0,.02,-1):view==='side'?new T.Vector3(1,.02,0):new T.Vector3(.35,.06,1).normalize();
   controls.target.set(extent>.1&&el.clientWidth>767?-packingWidth*.12:0,extent>.1||mobile?.85:.68,0);camera.position.copy(controls.target).addScaledVector(direction,distance);controls.update();dirty=true;
  };
  const resize=()=>{layoutKey='';lastState=null;renderer.setPixelRatio(Math.min(devicePixelRatio,el.clientWidth<768||el.clientHeight<600?1.5:2));camera.aspect=el.clientWidth/el.clientHeight;camera.updateProjectionMatrix();renderer.setSize(el.clientWidth,el.clientHeight);const buffer=renderer.getDrawingBufferSize(new T.Vector2());beamTarget.setSize(Math.max(1,buffer.x),Math.max(1,buffer.y));bodyTarget.setSize(Math.max(1,buffer.x),Math.max(1,buffer.y));fit(latest.current.view,amount);};const observer=new ResizeObserver(resize);observer.observe(el);
  const raycaster=new T.Raycaster(),pointer=new T.Vector2(),tap=new PointerTap(),worldBox=new T.Box3(),hitPoint=new T.Vector3();
  const down=(e:PointerEvent)=>{hover.hidden=true;tap.down(e.pointerId,e.clientX,e.clientY,e.pointerType==='touch'?12:5);};
  const move=(e:PointerEvent)=>{tap.move(e.pointerId,e.clientX,e.clientY);if(e.buttons||amount<.5||e.pointerType==='touch'){hover.hidden=true;return;}const rect=el.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top,index=findTarget(x,y,12);hover.hidden=index<0;renderer.domElement.style.cursor=index<0?'grab':'pointer';if(index>=0){hover.textContent=atlas.parts[index].name;hover.style.left=`${Math.max(8,Math.min(x+14,el.clientWidth-260))}px`;hover.style.top=`${Math.max(8,Math.min(y+18,el.clientHeight-55))}px`;}};
  const cancel=(e:PointerEvent)=>tap.cancel(e.pointerId);
  const up=(e:PointerEvent)=>{
   const validTap=tap.up(e.pointerId,e.clientX,e.clientY);if(!validTap||!ready)return;const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);
   if(latest.current.mode==='radiograph'){
    // Every surface the ray meets, not just the nearest, so the reading covers the whole beam.
    const hits:Hit[]=[];
    pickers.forEach((mesh,i)=>{
     // The envelope is read whether or not its layer is switched on, so the reading agrees with the
     // image, where the body is always in the beam.
     if(!mesh||(data[i*4+3]<.5&&i!==envelopeIndex))return;
     worldBox.copy(bounds[i]).translate(mesh.position);
     if(!raycaster.ray.intersectBox(worldBox,hitPoint))return;
     for(const crossing of raycaster.intersectObject(mesh,false))
      if(crossing.face)hits.push({index:i,distance:crossing.distance,front:crossing.face.normal.dot(raycaster.ray.direction)<0});
    });
    if(!hits.length){beam.current(null);return;}
    // The envelope is reported as the tissue it encloses rather than as its own rim.
    const span=bodySpan(hits,envelopeIndex);
    const reading=integrateBeam(hits.filter(h=>h.index!==envelopeIndex),i=>contributionFor(atlas.parts[i],envelopePresent));
    if(span>0&&envelopeIndex>=0){
     const skin=hits.filter(h=>h.index===envelopeIndex).map(h=>h.distance);
     const entry=Math.min(...skin),fill:Crossing={index:envelopeIndex,entry,exit:entry+span,thickness:span,attenuation:FILL_MU*span*100};
     reading.crossings.unshift(fill);reading.total+=fill.attenuation;
    }
    beam.current(reading);
    return;
   }
   let nearest=Infinity,found=-1;const hasSolid=atlas.parts.some((p,i)=>p.system!=='integumentary'&&data[i*4+3]>.5);
   pickers.forEach((mesh,i)=>{if(!mesh||data[i*4+3]<.5||(hasSolid&&atlas.parts[i].system==='integumentary'))return;worldBox.copy(bounds[i]).translate(mesh.position);if(!raycaster.ray.intersectBox(worldBox,hitPoint))return;const hits=raycaster.intersectObject(mesh,false);if(hits[0]&&hits[0].distance<nearest){nearest=hits[0].distance;found=i;}});
   if(found<0&&amount>.45)found=findTarget(e.clientX-rect.left,e.clientY-rect.top,e.pointerType==='touch'?24:16);if(found>=0){hover.hidden=true;select.current(atlas.parts[found].id);}
  };
  renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointermove',move);renderer.domElement.addEventListener('pointerup',up);renderer.domElement.addEventListener('pointercancel',cancel);
  // ── Cross-sections ────────────────────────────────────────────────────────────────────────────
  // Sections come from a real study rather than from these meshes: an intensity volume and a label
  // volume of the same shape, where every voxel carries the index of the structure that owns it.
  // Slicing is then an indexing operation, and the label under the pointer names the anatomy
  // exactly, because a radiologist drew it rather than a model inferring it.
  const sliceCanvas=document.createElement('canvas');sliceCanvas.className='section-view';sliceCanvas.hidden=true;
  sliceCanvas.setAttribute('aria-label','Cross-sectional image from a real study. Scroll to move through the stack, and tap a structure to name it.');
  el.appendChild(sliceCanvas);
  const sliceContext=sliceCanvas.getContext('2d')!;
  const sliceBuffer=document.createElement('canvas'),sliceBufferContext=sliceBuffer.getContext('2d')!;
  const studies=new Map<string,Volume>();
  let study:Volume|null=null,loading='',section:Section|null=null;
  let sliceKey='',drawKey='',sliceActive=false,sliceCrop={x:0,y:0,w:0,h:0},sliceDraw={x:0,y:0,w:0,h:0};

  const wanted=(mode:string)=>mode==='ct'||mode==='mr';
  const ensureStudy=(mode:string)=>{
   const held=studies.get(mode);
   if(held){if(study!==held){study=held;sliceKey='';volume.current(held.manifest);}return true;}
   if(loading===mode)return false;
   loading=mode;study=null;section=null;volume.current(null);
   loadVolume(`/imaging/${mode}`,abort.signal).then(loaded=>{
    if(disposed)return;
    studies.set(mode,loaded);
    if(latest.current.mode===mode){study=loaded;sliceKey='';volume.current(loaded.manifest);dirty=true;}
   }).catch(e=>{if(!disposed&&e.name!=='AbortError')onError(e instanceof Error?e.message:'The imaging study could not be loaded.');})
    .finally(()=>{if(loading===mode)loading='';});
   return false;
  };

  const buildSlice=(s:SceneState)=>{
   if(!study)return;
   const window=s.mode==='ct'?ctWindow(s.ctWindow):{width:s.mrWindow,level:s.mrLevel};
   section=extractSection(study,s.plane,s.slice,window.width,window.level);
   sliceBuffer.width=section.width;sliceBuffer.height=section.height;
   const image=sliceBufferContext.createImageData(section.width,section.height);
   for(let i=0,o=0;i<section.grey.length;i++,o+=4){
    image.data[o]=image.data[o+1]=image.data[o+2]=section.grey[i];image.data[o+3]=255;
   }
   sliceBufferContext.putImageData(image,0,0);
  };

  /** The space the panels leave free. A section is a flat image with nothing to orbit, so rather
   *  than filling the viewport and sliding underneath the panels it is fitted into what is left.
   *  Measuring the panels keeps this right across the breakpoints and when the inspector opens. */
  const sectionArea=()=>{
   const host=el.getBoundingClientRect(),gap=14;
   let left=8,right=el.clientWidth-8,top=92,bottom=el.clientHeight-8;
   const box=(selector:string)=>{
    const node=document.querySelector(selector);
    if(!(node instanceof HTMLElement))return null;
    const style=getComputedStyle(node);
    if(style.display==='none'||style.visibility==='hidden')return null;
    const r=node.getBoundingClientRect();
    return r.width>4&&r.height>4?{left:r.left-host.left,right:r.right-host.left,top:r.top-host.top,bottom:r.bottom-host.top}:null;
   };
   const layers=box('.layers-panel');
   if(layers&&layers.right<el.clientWidth*.5)left=Math.max(left,layers.right+gap);
   for(const selector of ['.radiograph-panel','.detail-sheet']){
    const panel=box(selector);
    if(!panel)continue;
    if(panel.left>el.clientWidth*.5)right=Math.min(right,panel.left-gap);
    else if(panel.top>el.clientHeight*.4)bottom=Math.min(bottom,panel.top-gap);
   }
   const dock=box('.bottom-dock');
   if(dock)bottom=Math.min(bottom,dock.top-gap);
   if(right-left<200){left=8;right=el.clientWidth-8;}
   if(bottom-top<200){top=8;bottom=el.clientHeight-8;}
   return {left,right,top,bottom};
  };

  const drawSlice=(area:{left:number;right:number;top:number;bottom:number})=>{
   if(!section)return;
   sliceCrop={x:0,y:0,w:section.width,h:section.height};
   const ratioX=sliceCanvas.width/Math.max(1,el.clientWidth),ratioY=sliceCanvas.height/Math.max(1,el.clientHeight);
   const availableWidth=(area.right-area.left)*ratioX,availableHeight=(area.bottom-area.top)*ratioY;
   // Voxels are not cubic, so the image is drawn at the aspect its spacing implies rather than
   // one screen pixel per voxel, which would squash a coronal image of an anisotropic study.
   const trueWidth=section.width*section.pixelWidth,trueHeight=section.height*section.pixelHeight;
   const scale=Math.min(availableWidth/trueWidth,availableHeight/trueHeight)*.96;
   const w=trueWidth*scale,h=trueHeight*scale;
   sliceDraw={x:area.left*ratioX+(availableWidth-w)/2,y:area.top*ratioY+(availableHeight-h)/2,w,h};
   sliceContext.fillStyle='#05070a';sliceContext.fillRect(0,0,sliceCanvas.width,sliceCanvas.height);
   sliceContext.imageSmoothingEnabled=true;sliceContext.imageSmoothingQuality='high';
   sliceContext.drawImage(sliceBuffer,0,0,section.width,section.height,sliceDraw.x,sliceDraw.y,w,h);
  };

  const resizeSlice=()=>{
   const ratio=Math.min(devicePixelRatio,2);
   sliceCanvas.width=Math.max(1,Math.round(el.clientWidth*ratio));
   sliceCanvas.height=Math.max(1,Math.round(el.clientHeight*ratio));
   sliceCanvas.style.width=`${el.clientWidth}px`;sliceCanvas.style.height=`${el.clientHeight}px`;
  };

  /** Which structure lies under a point on the section, or nothing outside the image. */
  const structureAt=(clientX:number,clientY:number)=>{
   if(!section||!study)return null;
   const rect=sliceCanvas.getBoundingClientRect();
   if(!rect.width||!rect.height)return null;
   const ratio=sliceCanvas.width/rect.width;
   const x=((clientX-rect.left)*ratio-sliceDraw.x)/sliceDraw.w*section.width;
   const y=((clientY-rect.top)*ratio-sliceDraw.y)/sliceDraw.h*section.height;
   if(x<0||y<0||x>=section.width||y>=section.height)return null;
   const label=section.labels[Math.floor(y)*section.width+Math.floor(x)];
   return label?study.named.get(label)??null:null;
  };
  const sliceHover=(e:PointerEvent)=>{
   const found=structureAt(e.clientX,e.clientY);
   hover.hidden=!found;sliceCanvas.style.cursor=found?'pointer':'default';
   if(!found)return;
   const rect=el.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;
   hover.textContent=found.name;
   hover.style.left=`${Math.max(8,Math.min(x+14,el.clientWidth-260))}px`;
   hover.style.top=`${Math.max(8,Math.min(y+18,el.clientHeight-55))}px`;
  };
  const sliceTap=(e:PointerEvent)=>{const found=structureAt(e.clientX,e.clientY);if(found)structure.current(found.name);};
  const sliceLeave=()=>{hover.hidden=true;};
  /** The wheel walks the stack, as it does on a reading workstation. */
  const sliceWheel=(e:PointerEvent|WheelEvent)=>{
   const s=latest.current;
   if(!wanted(s.mode)||!study)return;
   const wheel=e as WheelEvent;
   e.preventDefault();
   const direction=wheel.deltaY>0?-1:wheel.deltaY<0?1:0;
   if(!direction)return;
   const next=Math.min(sliceCount(study,s.plane)-1,Math.max(0,s.slice+direction));
   if(next!==s.slice)step.current(next);
  };
  sliceCanvas.addEventListener('pointermove',sliceHover);
  sliceCanvas.addEventListener('pointerup',sliceTap);
  sliceCanvas.addEventListener('pointerleave',sliceLeave);
  sliceCanvas.addEventListener('wheel',sliceWheel as EventListener,{passive:false});

  const clock=new T.Clock();let lastExtent=-1;
  const animate=()=>{
   if(disposed)return;frame=requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05),s=latest.current;
   // A section replaces the three-dimensional view entirely, and is rebuilt only when something it
   // depends on changes rather than every frame.
   const cross=wanted(s.mode);
   if(cross!==sliceActive){sliceActive=cross;sliceCanvas.hidden=!cross;renderer.domElement.style.visibility=cross?'hidden':'visible';hover.hidden=true;}
   if(cross){
    if(!ensureStudy(s.mode))return;
    const build=[s.mode,s.plane,s.slice,s.ctWindow,s.mrLevel,s.mrWindow].join('|');
    if(build!==sliceKey){sliceKey=build;buildSlice(s);drawKey='';}
    // The free area is remeasured each frame, so opening the inspector or the layer panel refits
    // the image instead of leaving it underneath.
    const area=sectionArea();
    const draw=[build,el.clientWidth,el.clientHeight,Math.round(area.left),Math.round(area.right),Math.round(area.top),Math.round(area.bottom)].join('|');
    if(draw!==drawKey){drawKey=draw;resizeSlice();drawSlice(area);}
    return;
   }
   sliceKey='';
   const changed=lastState?.visible!==s.visible||lastState?.selected!==s.selected||lastState?.isolate!==s.isolate;
   const moving=Math.abs(amount-s.explode)>.0001;
   if(moving){amount=T.MathUtils.damp(amount,s.explode,8,dt);dirty=true;}
   if(changed||moving||lastExtent<0){
    const visible=new Set(s.visible),selection=new Set(s.selected);
    const visibleParts=atlas.parts.filter(p=>s.isolate?selection.has(p.id):visible.has(p.system)||selection.has(p.id));
    const nextLayoutKey=visibleParts.map(p=>p.id).join(',')+':'+camera.aspect.toFixed(3);
    if(nextLayoutKey!==layoutKey){const layout=createExplosionLayout(visibleParts,camera.aspect);packingWidth=layout.width;packingHeight=layout.height;atlas.parts.forEach((p,i)=>{const cell=layout.cells.get(p.id);offsets[i]=cell?new T.Vector3(cell.x,cell.y+.85,0):centers[i].clone();});layoutKey=nextLayoutKey;if(amount>.05&&!s.isolate)fit(s.view,Math.max(0,(amount-.3)/.7));}

    atlas.parts.forEach((p,i)=>{
     const c=centers[i],destination=offsets[i];let dx=0,dy=0,dz=0;
     if(amount<=.45){const t=amount/.45;const group=SYSTEMS.findIndex(sys=>sys.id===p.system);const angle=group/SYSTEMS.length*Math.PI*2;dx=Math.sin(angle)*t*.48;dy=(c.y-.85)*t*.28;dz=Math.cos(angle)*t*.48;}
     else {const t=(amount-.45)/.55,group=SYSTEMS.findIndex(sys=>sys.id===p.system),angle=group/SYSTEMS.length*Math.PI*2;dx=T.MathUtils.lerp(Math.sin(angle)*.48,destination.x-c.x,t);dy=T.MathUtils.lerp((c.y-.85)*.28,destination.y-c.y,t);dz=T.MathUtils.lerp(Math.cos(angle)*.48,-c.z,t);}
     const selected=selection.has(p.id);data.set([dx,dy,dz,(s.isolate?selected:visible.has(p.system)||selected)?1:0],i*4);selectedData[i*4]=selected?255:0;
     markerPositions.set(data[i*4+3]>.5?[c.x+dx,c.y+dy,c.z+dz]:[10000,10000,10000],i*3);const mesh=pickers[i];if(mesh){mesh.position.set(dx,dy,dz);mesh.updateMatrix();mesh.updateMatrixWorld(true);}
    });partTexture.needsUpdate=true;selectionTexture.needsUpdate=true;markerGeometry.attributes.position.needsUpdate=true;lastState=s;lastExtent=amount;dirty=true;
   }
   if(s.view!==lastView||s.reset!==lastReset){fit(s.view,amount);lastView=s.view;lastReset=s.reset;}
   if(moving&&!s.isolate)fit(amount>.5?'front':s.view,Math.max(0,(amount-.3)/.7));
   const isolateKey=s.isolate?s.selected.join(',')+':'+s.reset+':'+s.inspectorOpen+':'+camera.aspect:'';
   if(isolateKey!==lastIsolate||(s.isolate&&moving)){
    if(s.isolate){const box=new T.Box3();atlas.parts.forEach((p,i)=>{if(s.selected.includes(p.id))box.union(bounds[i].clone().translate(new T.Vector3(data[i*4],data[i*4+1],data[i*4+2])));});
     if(!box.isEmpty()){const center=box.getCenter(new T.Vector3()),size=box.getSize(new T.Vector3());const w=el.clientWidth,h=el.clientHeight,mobile=w<768,landscape=w>h&&h<=600;let left=20,right=w-20,top=mobile?175:110,bottom=h-170;if(s.inspectorOpen){if(landscape){right=w-335;top=100;bottom=h-125;}else if(mobile){const sheet=document.querySelector('.detail-sheet')?.getBoundingClientRect(),header=document.querySelector('.identity')?.getBoundingClientRect();top=(header?.bottom??94)+16;bottom=(sheet?.top??h*.58-139)-16;}else{right=w-370;left=w>1100?285:25;}}const availableWidth=Math.max(150,right-left),availableHeight=Math.max(40,bottom-top);camera.setViewOffset(w,h,w/2-(left+right)/2,h/2-(top+bottom)/2,w,h);const distance=Math.max(.07,Math.max(size.y*h/availableHeight,size.x*w/availableWidth/camera.aspect,size.z)/(2*Math.tan(T.MathUtils.degToRad(camera.fov/2)))*1.35);controls.maxDistance=Math.max(40,distance*2);controls.target.copy(center);camera.position.copy(center).add(new T.Vector3(.2,.1,1).normalize().multiplyScalar(distance));controls.update();dirty=true;}
    }else if(lastIsolate){camera.clearViewOffset();fit(s.view,amount);}
    lastIsolate=isolateKey;
   }
   controls.enableRotate=amount<.8;controls.mouseButtons.LEFT=amount<.8?T.MOUSE.ROTATE:T.MOUSE.PAN;controls.touches.ONE=amount<.8?T.TOUCH.ROTATE:T.TOUCH.PAN;ground.visible=platform.visible=ring.visible=innerRing.visible=amount<.5&&!s.isolate;markers.visible=amount>.75;controls.autoRotate=s.rotate&&!s.isolate&&amount<.4;controls.autoRotateSpeed=.65;controls.update();if(controls.autoRotate)dirty=true;
   if(dirty){
    if(s.mode==='radiograph'){
     const studio=[ground.visible,platform.visible,ring.visible,innerRing.visible,markers.visible];
     ground.visible=platform.visible=ring.visible=innerRing.visible=markers.visible=false;
     // The body span, from the envelope alone. It stays in the beam whatever the layer switches
     // say, because it is the patient rather than a layer.
     const hiddenLayers:T.Object3D[]=[];
     if(envelopeMeshes.length){
      body.children.forEach(child=>{if(!envelopeMeshes.includes(child as T.Mesh)){hiddenLayers.push(child);child.visible=false;}});
      renderer.setRenderTarget(bodyTarget);renderer.autoClear=false;
      renderer.render(primeScene,filmCamera);
      scene.overrideMaterial=bodyMaterial;renderer.render(scene,camera);
      scene.overrideMaterial=null;renderer.autoClear=true;
      hiddenLayers.forEach(child=>{child.visible=true;});
     }
     scene.overrideMaterial=beamMaterial;renderer.setRenderTarget(beamTarget);renderer.setClearColor(0x000000,0);renderer.clear();
     renderer.render(scene,camera);
     scene.overrideMaterial=null;renderer.setRenderTarget(null);renderer.setClearColor('#05070a');
     filmUniforms.level.value=s.level;filmUniforms.band.value=s.window;
     renderer.render(filmScene,filmCamera);
     [ground.visible,platform.visible,ring.visible,innerRing.visible,markers.visible]=studio;
    }else{renderer.setClearColor('#f2f3f3');renderer.render(scene,camera);}
    targets=[];if(amount>.45){const hasSolid=atlas.parts.some((p,i)=>p.system!=='integumentary'&&data[i*4+3]>.5);atlas.parts.forEach((p,i)=>{if(data[i*4+3]<.5||(hasSolid&&p.system==='integumentary'))return;let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;for(let corner=0;corner<8;corner++){projected.set(p.bounds[(corner&1)?1:0][0]+data[i*4],p.bounds[(corner&2)?1:0][1]+data[i*4+1],p.bounds[(corner&4)?1:0][2]+data[i*4+2]).project(camera);const x=(projected.x+1)*el.clientWidth/2,y=(1-projected.y)*el.clientHeight/2;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}projected.copy(centers[i]).add(new T.Vector3(data[i*4],data[i*4+1],data[i*4+2])).project(camera);if(projected.z< -1||projected.z>1)return;targets.push({index:i,x:(projected.x+1)*el.clientWidth/2,y:(1-projected.y)*el.clientHeight/2,left,right,top,bottom});});}dirty=false;}

  };animate();
  const contextLost=(e:Event)=>{e.preventDefault();onError('The 3D session was paused by your device. Reload to continue.');};renderer.domElement.addEventListener('webglcontextlost',contextLost);
  return()=>{disposed=true;abort.abort();cancelAnimationFrame(frame);observer.disconnect();controls.dispose();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());scene.traverse(o=>{if(o instanceof T.Mesh&&!geometries.includes(o.geometry)){o.geometry.dispose();const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m.dispose());}});env.dispose();partTexture.dispose();selectionTexture.dispose();attenuationTexture.dispose();pickMaterial.dispose();beamTarget.dispose();beamMaterial.dispose();bodyTarget.dispose();bodyMaterial.dispose();prime.geometry.dispose();(prime.material as T.Material).dispose();filmMaterial.dispose();film.geometry.dispose();markerGeometry.dispose();markerMaterial.dispose();sliceCanvas.removeEventListener('pointermove',sliceHover);sliceCanvas.removeEventListener('pointerup',sliceTap);sliceCanvas.removeEventListener('pointerleave',sliceLeave);sliceCanvas.removeEventListener('wheel',sliceWheel as EventListener);sliceCanvas.remove();hover.remove();renderer.dispose();renderer.domElement.remove();};
 },[atlas]);
 return <div className="scene" ref={host}/>;
}
