// Layout público de skins Minecraft: 64x64, classic/slim e conversão legacy64x32.
export const SKIN_UNIT=1.8/32;
export function skinParts(slim=false) {
  const a=slim?3:4;
  return [
    {name:'torso',bone:0,size:[8,12,4],at:[0,18,0],base:[16,16],outer:[16,32]},
    {name:'head',bone:1,size:[8,8,8],at:[0,28,0],base:[0,0],outer:[32,0]},
    {name:'armL',bone:2,size:[a,12,4],at:[-4-a/2,18,0],base:[32,48],outer:[48,48]},
    {name:'armR',bone:3,size:[a,12,4],at:[4+a/2,18,0],base:[40,16],outer:[40,32]},
    {name:'legL',bone:4,size:[4,12,4],at:[-2,6,0],base:[16,48],outer:[0,48]},
    {name:'legR',bone:5,size:[4,12,4],at:[2,6,0],base:[0,16],outer:[0,32]},
  ];
}
// Ordem BoxGeometry: direita, esquerda, topo, fundo, costas, frente (-Z).
export function skinRects([w,h,d],[x,y]) {
  return [[x,y+d,d,h],[x+d+w,y+d,d,h],[x+d,y,w,d],[x+d+w,y,w,d],[x+2*d+w,y+d,w,h],[x+d,y+d,w,h]];
}
export function skinPivots(slim=false) {
  const a=slim?3:4;
  return [[0,0,0],[0,24,0],[-4-a/2,24,0],[4+a/2,24,0],[-2,12,0],[2,12,0]].map(p=>p.map(x=>x*SKIN_UNIT));
}

export function normalizeSkinPixels(width,height,rgba) {
  if(width<64||width>1024||width%64||(height!==width&&height!==width/2)||rgba.length!==width*height*4)throw Error('Use PNG no padrão64×64 (ou legacy64×32), até1024px. A skin Kraft usa640×640.');
  const scale=width/64,out=new Uint8ClampedArray(width*width*4);out.set(rgba);
  if(height===width/2) {
    // Copia pernas e braços direitos para os esquerdos, espelhando as faces.
    for(const [from,to] of [[[0,16],[16,48]],[[40,16],[32,48]]]) {
      const a=skinRects([4,12,4],from),b=skinRects([4,12,4],to);
      for(let face=0;face<6;face++) {
        const [sx,sy,w,h]=a[face===0?1:face===1?0:face].map(v=>v*scale), [dx,dy]=b[face].map(v=>v*scale);
        for(let y=0;y<h;y++)for(let x=0;x<w;x++)out.set(rgba.subarray(((sy+y)*width+sx+w-1-x)*4,((sy+y)*width+sx+w-x)*4),((dy+y)*width+dx+x)*4);
      }
    }
  }
  // Camada corporal é opaca; transparência pertence à segunda camada.
  for(const part of skinParts(false))for(const rect of skinRects(part.size,part.base)){const [x,y,w,h]=rect.map(v=>v*scale);for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)out[(yy*width+xx)*4+3]=255;}
  return out;
}
