// Minimal 8 bit greyscale PNG writer, so rendering needs no image dependency.
import fs from 'node:fs';
import zlib from 'node:zlib';

const table=new Int32Array(256);
for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c;}
const crc=buf=>{let c=-1;for(const b of buf)c=table[(c^b)&255]^(c>>>8);return(c^-1)>>>0;};
const chunk=(type,data)=>{
 const len=Buffer.alloc(4);len.writeUInt32BE(data.length);
 const body=Buffer.concat([Buffer.from(type,'ascii'),data]);
 const tail=Buffer.alloc(4);tail.writeUInt32BE(crc(body));
 return Buffer.concat([len,body,tail]);
};
export function writeGreyPng(file,width,height,grey){
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=0;
 const raw=Buffer.alloc((width+1)*height);
 for(let y=0;y<height;y++){raw[y*(width+1)]=0;Buffer.from(grey.buffer,grey.byteOffset+y*width,width).copy(raw,y*(width+1)+1);}
 fs.writeFileSync(file,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]));
}
/** Block letters for orientation markers, drawn from rectangles so no font is needed. */
const GLYPHS={R:[[0,0,1,7],[0,0,3,1],[3,1,1,2],[0,3,4,1],[2,4,1,3]],L:[[0,0,1,7],[0,6,4,1]],A:[[0,2,1,5],[3,2,1,5],[1,0,2,1],[1,0,1,2],[2,0,1,2],[1,3,2,1]],
 P:[[0,0,1,7],[0,0,3,1],[3,1,1,2],[0,3,4,1]],S:[[0,0,4,1],[0,1,1,2],[0,3,4,1],[3,4,1,2],[0,6,4,1]],I:[[1,0,2,7]]};
export function drawGlyph(grey,width,height,letter,x0,y0,size,value=255){
 const shape=GLYPHS[letter];if(!shape)return;
 const s=size/7;
 for(const [gx,gy,gw,gh] of shape)
  for(let y=Math.round(y0+gy*s);y<Math.round(y0+(gy+gh)*s);y++)
   for(let x=Math.round(x0+gx*s);x<Math.round(x0+(gx+gw)*s);x++)
    if(x>=0&&y>=0&&x<width&&y<height)grey[y*width+x]=value;
}
