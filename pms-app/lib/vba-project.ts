/** Minimal CFB/MS-OVBA source upgrade. No customer workbook is bundled in the site. */
const FREE=0xffffffff,END=0xfffffffe,FAT=0xfffffffd;
const ascii=new TextEncoder();
const u16=(b:Uint8Array,p:number)=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint16(p,true);
const u32=(b:Uint8Array,p:number)=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(p,true);
const put=(b:Uint8Array,p:number,v:number)=>new DataView(b.buffer,b.byteOffset,b.byteLength).setUint32(p,v,true);
const join=(parts:Uint8Array[])=>{const b=new Uint8Array(parts.reduce((n,x)=>n+x.length,0));let p=0;for(const x of parts){b.set(x,p);p+=x.length;}return b;};
type Entry={index:number;raw:Uint8Array;name:string;kind:number;start:number;size:number};
export class CompoundFile{
 entries:Entry[];fat:number[];mini:Uint8Array;mfat:number[];
 constructor(public data:Uint8Array){
  if(data.length<512||[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1].some((v,i)=>data[i]!==v)||u16(data,30)!==9||u16(data,32)!==6)throw Error('지원되지 않는 VBA 저장 형식입니다. 원본은 유지됩니다.');
  const ids=Array.from({length:109},(_,i)=>u32(data,76+i*4));let cur=u32(data,68);
  for(let n=0;n<u32(data,72);n++){if(n>4096)throw Error('VBA FAT 범위 오류');const a=this.sector(cur);for(let p=0;p<508;p+=4)ids.push(u32(a,p));cur=u32(a,508);}
  this.fat=ids.filter(x=>x<0xfffffffa).slice(0,u32(data,44)).flatMap(i=>Array.from({length:128},(_,n)=>u32(this.sector(i),n*4)));
  const directory=this.chain(u32(data,48),this.fat);this.entries=[];
  for(let p=0;p<directory.length;p+=128){const raw=directory.slice(p,p+128),length=u16(raw,64);if(length>64)throw Error('VBA 이름 범위 오류');this.entries.push({index:p/128,raw,name:new TextDecoder('utf-16le').decode(raw.slice(0,Math.max(0,length-2))),kind:raw[66],start:u32(raw,116),size:u32(raw,120)});}
  if(!this.entries.length||this.entries[0].kind!==5)throw Error('VBA 루트가 없습니다.');
  this.mini=this.chain(this.entries[0].start,this.fat).slice(0,this.entries[0].size);const mf=this.chain(u32(data,60),this.fat);this.mfat=Array.from({length:mf.length/4},(_,i)=>u32(mf,i*4));
 }
 sector(i:number){if((i+2)*512>this.data.length)throw Error('VBA 섹터 범위 오류');return this.data.slice((i+1)*512,(i+2)*512);}
 chain(start:number,fat:number[],mini=false){const out:Uint8Array[]=[],seen=new Set<number>();let i=start;while(i<0xfffffffa){if(seen.has(i)||i>=fat.length)throw Error('VBA 체인 오류');seen.add(i);out.push(mini?this.mini.slice(i*64,(i+1)*64):this.sector(i));i=fat[i];}return join(out);}
 stream(e:Entry){return this.chain(e.start,e.size<4096?this.mfat:this.fat,e.size<4096).slice(0,e.size);}
 get(name:string){const e=this.entries.find(e=>e.kind===2&&e.name===name);if(!e)throw Error('VBA 스트림이 없습니다: '+name);return this.stream(e);}
}
export function decompressVba(data:Uint8Array){
 if(data[0]!==1)throw Error('VBA 압축 서명 오류');const out:number[]=[];let p=1;
 while(p<data.length){if(p+2>data.length)throw Error('VBA 압축 헤더 오류');const h=u16(data,p),end=p+(h&0xfff)+3;p+=2;const start=out.length;if((h&0x7000)!==0x3000||end>data.length)throw Error('VBA 압축 범위 오류');
  if(!(h&0x8000)){out.push(...data.slice(p,end));p=end;continue;}
  while(p<end){const flags=data[p++];for(let bit=0;bit<8&&p<end;bit++){if(flags&(1<<bit)){if(p+2>end)throw Error('VBA 토큰 오류');const token=u16(data,p);p+=2;const bits=Math.max(4,Math.ceil(Math.log2(Math.max(1,out.length-start)))),mask=0xffff>>>bits,len=(token&mask)+3,offset=(token>>>(16-bits))+1;if(offset>out.length-start)throw Error('VBA 복사 범위 오류');for(let n=0;n<len;n++)out.push(out[out.length-offset]);}else out.push(data[p++]);if(out.length-start>4096)throw Error('VBA 압축 크기 오류');}}
  if(out.length>16*1024*1024)throw Error('VBA 압축 해제 크기를 초과합니다.');
 }return Uint8Array.from(out);
}
export function compressVba(data:Uint8Array){
 const result:number[]=[1];for(let base=0;base<data.length;base+=4096){const c=data.slice(base,base+4096),payload:number[]=[];let p=0;const positions=new Map<number,number[]>();
  const key=(i:number)=>(c[i]<<16)|(c[i+1]<<8)|c[i+2];const remember=(i:number)=>{if(i+2>=c.length)return;const k=key(i),a=positions.get(k)||[];a.push(i);positions.set(k,a);};
  while(p<c.length){const fi=payload.length;payload.push(0);let flags=0;for(let bit=0;bit<8&&p<c.length;bit++){const bits=Math.max(4,Math.ceil(Math.log2(Math.max(1,p)))),maxLen=Math.min((0xffff>>>bits)+3,c.length-p);let best=0,off=0;
    if(maxLen>=3)for(const start of positions.get(key(p))||[]){if(p-start>1<<bits)continue;let n=3;while(n<maxLen&&c[start+n]===c[p+n])n++;if(n>best){best=n;off=p-start;}if(best===maxLen)break;}
    if(best>=3){const token=((off-1)<<(16-bits))|(best-3);payload.push(token&255,token>>>8);flags|=1<<bit;for(let n=0;n<best;n++)remember(p+n);p+=best;}else{payload.push(c[p]);remember(p);p++;}}
   payload[fi]=flags;}
  const uncompressed=payload.length>4096;if(uncompressed&&c.length!==4096)throw Error('VBA 압축 출력 범위 오류');const h=uncompressed?0x3fff:0xb000|(payload.length-1);result.push(h&255,h>>>8,...(uncompressed?c:payload));
 }return Uint8Array.from(result);
}
function rebuild(cfb:CompoundFile,updates:Map<string,Uint8Array>,remove:Set<string>){
 const entries=cfb.entries,parents=new Map<number,number>(),walked=new Set<number>();
 function walk(i:number,parent:number){if(i===FREE)return;if(i>=entries.length||walked.has(i))throw Error('VBA 디렉터리 오류');walked.add(i);const e=entries[i];walk(u32(e.raw,68),parent);parents.set(i,parent);if(e.kind===1)walk(u32(e.raw,76),i);walk(u32(e.raw,72),parent);}
 walk(u32(entries[0].raw,76),0);
 const active=new Set(entries.filter(e=>e.kind&&!remove.has(e.name)).map(e=>e.index));const raw=entries.map(e=>active.has(e.index)?e.raw.slice():new Uint8Array(128));
 for(const i of active){put(raw[i],68,FREE);put(raw[i],72,FREE);put(raw[i],76,FREE);raw[i][67]=1;}
 for(const parent of entries.filter(e=>e.kind===1||e.kind===5).map(e=>e.index)){
  const children=[...active].filter(i=>parents.get(i)===parent).sort((a,b)=>entries[a].name.length-entries[b].name.length||(entries[a].name.toUpperCase()<entries[b].name.toUpperCase()?-1:1));const depths=new Map<number,number>();
  function tree(a:number[],depth:number):number{if(!a.length)return FREE;const mid=Math.floor(a.length/2),i=a[mid];depths.set(i,depth);put(raw[i],68,tree(a.slice(0,mid),depth+1));put(raw[i],72,tree(a.slice(mid+1),depth+1));return i;}
  put(raw[parent],76,tree(children,0));const max=Math.max(0,...depths.values());for(const [i,d]of depths)raw[i][67]=d===max&&d>0?0:1;
 }
 const sectors:Uint8Array[]=[],fat:number[]=[];function alloc(data:Uint8Array){if(!data.length)return END;const start=sectors.length,count=Math.ceil(data.length/512);for(let k=0;k<count;k++){const s=new Uint8Array(512);s.set(data.slice(k*512,(k+1)*512));sectors.push(s);fat.push(k<count-1?start+k+1:END);}return start;}
 const minis:Uint8Array[]=[],mfat:number[]=[];
 for(const e of entries){if(!active.has(e.index)||e.kind!==2)continue;const data=updates.get(e.name)||cfb.stream(e);let start:number;
  if(data.length&&data.length<4096){start=minis.length;const count=Math.ceil(data.length/64);for(let k=0;k<count;k++){const s=new Uint8Array(64);s.set(data.slice(k*64,(k+1)*64));minis.push(s);mfat.push(k<count-1?start+k+1:END);}}else start=alloc(data);
  put(raw[e.index],116,start);put(raw[e.index],120,data.length);put(raw[e.index],124,0);
 }
 const mini=join(minis);put(raw[0],116,alloc(mini));put(raw[0],120,mini.length);put(raw[0],124,0);
 const mf=new Uint8Array(Math.ceil(mfat.length*4/512)*512);mf.fill(255);mfat.forEach((v,i)=>put(mf,i*4,v));const mfStart=alloc(mf),dirStart=alloc(join(raw));const n=sectors.length;let nf=1;while(nf!==Math.ceil((n+nf)/128))nf=Math.ceil((n+nf)/128);if(nf>109)throw Error('VBA 파일 크기를 지원하지 않습니다.');
 const fatIds=Array.from({length:nf},(_,i)=>n+i);fat.push(...fatIds.map(()=>FAT));while(fat.length<nf*128)fat.push(FREE);for(let k=0;k<nf;k++){const s=new Uint8Array(512);for(let i=0;i<128;i++)put(s,i*4,fat[k*128+i]);sectors.push(s);}
 const header=cfb.data.slice(0,512);put(header,44,nf);put(header,48,dirStart);put(header,56,4096);put(header,60,mfStart);put(header,64,mf.length/512);put(header,68,END);put(header,72,0);for(let i=0;i<109;i++)put(header,76+i*4,fatIds[i]??FREE);
 const result=join([header,...sectors]),check=new CompoundFile(result);for(const e of check.entries.filter(e=>e.kind===2)){const expected=updates.get(e.name)||cfb.get(e.name),actual=check.stream(e);if(actual.length!==expected.length||actual.some((v,i)=>v!==expected[i]))throw Error('VBA 재저장 검증 실패: '+e.name);}return result;
}
export function vbaSources(data:Uint8Array){
 const cfb=new CompoundFile(data),dir=decompressVba(cfb.get('dir')),offsets:number[]=[];
 // MODULEOFFSET is a fixed six-byte record prefix; source headers validate each match.
 for(let p=0;p+10<=dir.length;p++)if(dir[p]===0x31&&dir[p+1]===0&&u32(dir,p+2)===4)offsets.push(p+6);
 const modules:{name:string;offset:number;source:Uint8Array}[]=[];
 for(const e of cfb.entries.filter(e=>e.kind===2&&!e.name.startsWith('__SRP_'))){const stream=cfb.stream(e);for(const p of offsets){const offset=u32(dir,p);if(offset>=stream.length||stream[offset]!==1)continue;try{const source=decompressVba(stream.slice(offset));if(new TextDecoder('euc-kr').decode(source.slice(0,500)).includes('Attribute VB_Name = ')){modules.push({name:e.name,offset,source});break;}}catch{ /* Non-module streams can share a leading byte with compressed source. */ }}}
 if(!modules.length||modules.length!==offsets.length)throw Error('VBA 모듈 구성을 확인할 수 없습니다. 원본은 유지됩니다.');return {cfb,dir,offsets,modules};
}
export function upgradeDashboardVba(data:Uint8Array,upgrade:(source:Uint8Array)=>Uint8Array){
 const {cfb,dir,offsets,modules}=vbaSources(data);const runtime=modules.find(m=>m.name==='DashboardRuntime');if(!runtime)throw Error('마일스톤 VBA 모듈을 확인할 수 없습니다. 원본은 유지됩니다.');const upgraded=upgrade(runtime.source);
 if(upgraded.length===runtime.source.length&&upgraded.every((v,i)=>v===runtime.source[i]))return data;
 const updates=new Map<string,Uint8Array>();for(const m of modules)updates.set(m.name,compressVba(m===runtime?upgraded:m.source));for(const p of offsets)put(dir,p,0);updates.set('dir',compressVba(dir));updates.set('_VBA_PROJECT',Uint8Array.from([0xcc,0x61,0xff,0xff,0,1,0]));
 return rebuild(cfb,updates,new Set(cfb.entries.filter(e=>e.name.startsWith('__SRP_')).map(e=>e.name)));
}
/** Replace an ASCII-delimited procedure while retaining unrelated CP949 source bytes. */
export function replaceVbaProcedure(source:Uint8Array,signature:string,kind:'Sub'|'Function',replacement:string){
 const latin=Array.from(source,b=>String.fromCharCode(b)).join(''),start=latin.indexOf(signature);if(start<0)throw Error('VBA 업그레이드 대상이 없습니다: '+signature);const end=latin.indexOf('End '+kind,start);if(end<0)throw Error('VBA 프로시저가 끝나지 않았습니다.');return join([source.slice(0,start),ascii.encode(replacement.replace(/\r?\n/g,'\r\n')),source.slice(end+('End '+kind).length)]);
}
