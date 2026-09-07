// Reads the committed atlas and its binary chunks, and hands back typed-array views of one part's
// geometry without copying: the views point straight into the chunk buffer.
import fs from 'node:fs';

export function loadAtlas(){
 const base=new URL('../public/models/',import.meta.url);
 const atlas=JSON.parse(fs.readFileSync(new URL('atlas.json',base)));
 const chunks=atlas.chunks.map(c=>fs.readFileSync(new URL(c.url.split('/').pop(),base)));
 const geometry=part=>{
  const b=chunks[part.chunk];
  return {
   positions:new Float32Array(b.buffer,b.byteOffset+part.positions,part.vertexCount*3),
   normals:new Int16Array(b.buffer,b.byteOffset+part.normals,part.vertexCount*3),
   indices:new Uint32Array(b.buffer,b.byteOffset+part.indices,part.indexCount),
  };
 };
 return {atlas,geometry};
}
export const option=(argv,name,fallback)=>{const i=argv.indexOf(`--${name}`);return i<0?fallback:argv[i+1];};
