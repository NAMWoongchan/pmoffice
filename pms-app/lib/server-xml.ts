import {SaxesParser} from 'saxes';
import {address,colName,type Cell,type Change} from './workbook';
// A streaming parser builds only worksheet values; it never creates a full DOM per cell.
export function readSheet(text:string,strings:string[]){
 if(/<!DOCTYPE|<!ENTITY|<\w+:c[\s>]/i.test(text))throw Error('지원하지 않는 Excel XML 형식입니다.');
 const cells:Record<string,Cell>={},widths:Record<number,number>={},heights:Record<number,number>={},hiddenCols:number[]=[],merges:string[]=[];
 let rows=0,cols=0,current:any=null,mode='',value='',formula='',inline='';
 const p=new SaxesParser({xmlns:false});
 p.on('opentag',(tag:any)=>{const a=tag.attributes,n=tag.name;
  if(n==='c'){current={a:a.r,t:a.t||'',s:Number(a.s||0)};value='';formula='';inline='';}
  else if(current&&['v','f','t'].includes(n))mode=n;
  else if(n==='col'){for(let i=Number(a.min);i<=Math.min(300,Number(a.max));i++){widths[i]=Number(a.width||10)*7+5;if(a.hidden==='1')hiddenCols.push(i);}}
  else if(n==='row'&&a.ht)heights[Number(a.r)]=Number(a.ht)*1.25;
  else if(n==='mergeCell'){merges.push(a.ref);const end=address(a.ref.split(':').at(-1));rows=Math.max(rows,end.r);cols=Math.max(cols,end.c);}
 });
 const textValue=(s:string)=>{if(mode==='v')value+=s;else if(mode==='f')formula+=s;else if(mode==='t')inline+=s};p.on('text',textValue);p.on('cdata',textValue);
 p.on('closetag',(tag:any)=>{const n=tag.name;if(['v','f','t'].includes(n)){mode='';return;}if(n!=='c'||!current)return;
  let v:any=value;if(current.t==='s')v=strings[Number(value)]??'';else if(current.t==='inlineStr')v=inline;else if(current.t==='b')v=value==='1';else if(current.t!=='str'&&current.t!=='e'&&v!=='')v=Number(v);
  if(!/^[A-Z]+[1-9][0-9]*$/.test(current.a))throw Error('Excel 셀 주소가 올바르지 않습니다.');
  if(cells[current.a])throw Error('Excel 셀 주소가 중복되었습니다.');cells[current.a]={v,f:formula||undefined,s:current.s,t:current.t};
  if(v!==''||formula){const a=address(current.a);rows=Math.max(rows,a.r);cols=Math.max(cols,a.c);}current=null;
 });p.write(text).close();return {cells,rows,cols,widths,heights,hiddenCols,merges};
}
const esc=(s:any)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
function cellXml(ch:Change,attrs=''){
 attrs=attrs.replace(/\s+(r|t|s)=("[^"]*"|'[^']*')/g,(_,n,v)=>n==='s'&&ch.style===undefined?' s='+v:'');
 const start='<c r="'+ch.address+'"'+attrs+(ch.style===undefined?'':' s="'+ch.style+'"');const f=ch.formula?'<f>'+esc(ch.formula.replace(/^=/,''))+'</f>':'';
 if(typeof ch.value==='string')return start+(ch.formula?' t="str">'+f+'<v>'+esc(ch.value)+'</v>':' t="inlineStr"><is><t xml:space="preserve">'+esc(ch.value)+'</t></is>')+'</c>';
 return start+'>'+f+'<v>'+esc(ch.value??'')+'</v></c>';
}
export function patchSheet(text:string,updates:Change[]){
 const pending=new Map(updates.map(x=>[x.address,x]));
 text=text.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,(whole,attrs)=>{const a=attrs.match(/\br=("([^"]+)"|'([^']+)')/);const key=a?.[2]||a?.[3],ch=pending.get(key);if(!ch)return whole;pending.delete(key);return cellXml(ch,' '+attrs.trim());});
 const byRow=new Map<number,Change[]>();for(const ch of pending.values()){const r=address(ch.address).r;byRow.set(r,[...(byRow.get(r)||[]),ch]);}
 text=text.replace(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g,(whole,attrs,body='')=>{const match=attrs.match(/\br=["']([0-9]+)["']/);const r=Number(match?.[1]),more=byRow.get(r);if(!more)return whole;byRow.delete(r);more.sort((a,b)=>address(a.address).c-address(b.address).c);
  let i=0;body=body.replace(/<c\b[^>]*?\br=["']([A-Z]+[0-9]+)["'][^>]*(?:\/>|>[\s\S]*?<\/c>)/g,(cell,a)=>{let before='';while(i<more.length&&address(more[i].address).c<address(a).c)before+=cellXml(more[i++]);return before+cell;});
  const tail=more.slice(i).map(ch=>cellXml(ch)).join('');body=body.includes('<extLst')?body.replace('<extLst',tail+'<extLst'):body+tail;return '<row'+attrs+'>'+body+'</row>';
 });
 for(const [r,more]of [...byRow.entries()].sort((a,b)=>a[0]-b[0])){const row='<row r="'+r+'">'+more.sort((a,b)=>address(a.address).c-address(b.address).c).map(ch=>cellXml(ch)).join('')+'</row>';const positions=[...text.matchAll(/<row\b[^>]*?\br=["']([0-9]+)["']/g)];const before=positions.find(m=>Number(m[1])>r);if(before)text=text.slice(0,before.index)+row+text.slice(before.index);else text=text.replace('</sheetData>',row+'</sheetData>');}
 const dim=text.match(/<dimension\b[^>]*?\bref=["']([^"']+)["']/);if(dim){const last=address(dim[1].split(':').at(-1)!);for(const ch of updates){const a=address(ch.address);last.c=Math.max(last.c,a.c);last.r=Math.max(last.r,a.r);}text=text.replace(dim[0],dim[0].replace(dim[1],'A1:'+colName(last.c)+last.r));}
 return text;
}
