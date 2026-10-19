/** Embed only the displayed glyphs as portable Type 3 image-mask fonts.
 * The Unicode map keeps Korean text searchable and copyable. No font CDN is
 * needed by the downloaded PDF. Masks inherit the surrounding text color.
 */
export async function embedReportFont(doc:any,lib:any,text:string,canvasFactory?:()=>any){
 const canvas=canvasFactory?canvasFactory():document.createElement('canvas');
 const unique=[...new Set(Array.from(text+' ?0123456789/.-%():[] …'))].filter(c=>!/[\n\r\t]/.test(c));
 const glyphs=new Map<string,{group:number;code:number;width:number}>(),refs:any[]=[];
 for(let offset=0;offset<unique.length;offset+=250){
  const chars=unique.slice(offset,offset+250),procs:Record<string,any>={},images:Record<string,any>={},widths:number[]=[],differences:any[]=[1];
  const mapping:string[]=[];
  for(let i=0;i<chars.length;i++){
   const char=chars[i];canvas.width=260;canvas.height=150;let ctx=canvas.getContext('2d',{willReadFrequently:true});
   ctx.font='100px "PMOffice Report", "Noto Sans KR", "Malgun Gothic", "Nanum Gothic", sans-serif';
   const advance=Math.max(1,ctx.measureText(char).width),w=Math.min(260,Math.max(4,Math.ceil(advance)+5)),h=150;
   canvas.width=w;ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.font='100px "PMOffice Report", "Noto Sans KR", "Malgun Gothic", "Nanum Gothic", sans-serif';ctx.fillStyle='#000';ctx.textBaseline='alphabetic';ctx.fillText(char,1,110);
   const rgba=ctx.getImageData(0,0,w,h).data,stride=Math.ceil(w/8),mask=new Uint8Array(stride*h).fill(255);let painted=false;
   for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(rgba[(y*w+x)*4+3]>=100){mask[y*stride+(x>>3)]&=~(1<<(7-(x&7)));painted=true;}
   if(/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/.test(char)&&(!painted||advance<10))throw Error('한글 글꼴이 아직 준비되지 않았습니다. 잠시 후 PDF를 다시 다운로드해 주세요.');
   const width=advance*10,code=i+1,name='g'+code;
   if(painted){images['M'+code]=doc.context.register(doc.context.flateStream(mask,{Type:'XObject',Subtype:'Image',Width:w,Height:h,ImageMask:true,BitsPerComponent:1,Decode:[0,1]}));}
   const proc=`${width.toFixed(3)} 0 0 -400 2600 1100 d1\n`+(painted?`q\n${w*10} 0 0 1500 0 -400 cm\n/M${code} Do\nQ\n`:'');
   procs[name]=doc.context.register(doc.context.flateStream(proc));widths.push(width);differences.push(lib.PDFName.of(name));
   const unicode=Array.from({length:char.length},(_,j)=>char.charCodeAt(j).toString(16).padStart(4,'0')).join('');mapping.push(`<${code.toString(16).padStart(2,'0')}> <${unicode}>`);
   glyphs.set(char,{group:refs.length,code,width});
  }
  let cmap='/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /PMOfficeUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n';
  for(let j=0;j<mapping.length;j+=100){const chunk=mapping.slice(j,j+100);cmap+=`${chunk.length} beginbfchar\n${chunk.join('\n')}\nendbfchar\n`;}
  cmap+='endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
  const unicode=doc.context.register(doc.context.flateStream(cmap));
  refs.push(doc.context.register(doc.context.obj({Type:'Font',Subtype:'Type3',Name:'PMOffice'+refs.length,FontBBox:[0,-400,2600,1100],FontMatrix:[0.001,0,0,0.001,0,0],FirstChar:1,LastChar:chars.length,Widths:widths,Encoding:{Type:'Encoding',Differences:differences},CharProcs:procs,Resources:{XObject:images},ToUnicode:unicode})));
 }
 const measure=(s:string,size:number)=>Array.from(s).reduce((n,c)=>n+(glyphs.get(c)||glyphs.get('?')!).width/1000*size,0);
 const pageFonts=new WeakMap<object,any[]>();
 function draw(page:any,s:string,x:number,y:number,size:number,color:any){
  let fonts=pageFonts.get(page);if(!fonts){fonts=refs.map(ref=>page.node.newFontDictionary('PMO',ref));pageFonts.set(page,fonts);}
  let group=-1,run='',runX=x;
  const flush=()=>{if(!run)return;page.pushOperators(lib.pushGraphicsState(),lib.setFillingRgbColor(color.red,color.green,color.blue),lib.beginText(),lib.setFontAndSize(fonts![group],size),lib.setTextMatrix(1,0,0,1,runX,y),lib.showText(lib.PDFHexString.of(run)),lib.endText(),lib.popGraphicsState());run='';};
  for(const c of Array.from(s.replace(/[\n\r\t]/g,' '))){const g=glyphs.get(c)||glyphs.get('?')!;if(g.group!==group){flush();group=g.group;runX=x;}run+=g.code.toString(16).padStart(2,'0');x+=g.width/1000*size;}flush();
 }
 return {measure,draw};
}
