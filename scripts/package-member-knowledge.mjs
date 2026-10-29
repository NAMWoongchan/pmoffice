// One-time private migration packaging. Output MUST be outside this public repository.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {createMarkdownRenderer} from 'vitepress';import {JSDOM} from 'jsdom';import {zipSync,strToU8} from 'fflate';
const output=process.argv[2];if(!output||path.resolve(output).startsWith(path.resolve('.')+path.sep))throw Error('Choose a private output directory outside the public repository.');
fs.mkdirSync(output,{recursive:true});
const md=await createMarkdownRenderer(path.resolve('docs'),{html:true});
const paths=['project-management.md','project-management/paradigm-shift.md','microsoft-project.md','generative-ai.md','pc-management/README.md','pc-management/high-performance-power.md'];
const entries={},manifest={schema:1,documents:[],media:[]},removals=new Set(),bodyMarkers=[];
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const allowed=new Set('h1 h2 h3 h4 h5 h6 p a img figure figcaption blockquote pre code span div details summary ul ol li table thead tbody tfoot tr td th hr br strong em kbd sup sub picture source'.split(' '));
for(const file of paths){
 const original=fs.readFileSync('docs/'+file,'utf8');if(original.includes('<MemberKnowledge'))throw Error('Already converted. Use the recorded private package instead of packaging shells.');
 const front=original.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/),title=front?.[1].match(/^title:\s*["']?(.*?)["']?\s*$/m)?.[1]||file;
 const route='/'+file.replace(/\.md$/,'.html'),slug=file.replace(/\.md$/,'').replaceAll('/','-').toLowerCase();
 let body=original.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n/,'').replace(/:(src|href|srcset)="'([^']+)'"/g,'$1="$2"');
 const html=md.render(body,{});const dom=new JSDOM('<main>'+html+'</main>'),root=dom.window.document.querySelector('main');
 for(const el of root.querySelectorAll('script,style,iframe,object,embed,form,input,button'))el.remove();
 function asset(url){const normalized=new URL(url,'https://pmoffice.co.kr'+route);if(normalized.origin!=='https://pmoffice.co.kr')return null;const rel=decodeURIComponent(normalized.pathname).replace(/^\//,'');const absolute=path.resolve('docs/public',rel);if(!absolute.startsWith(path.resolve('docs/public')+path.sep)||!fs.existsSync(absolute))return null;
  const object_path='documents/'+slug+'/'+path.basename(rel),bytes=fs.readFileSync(absolute);if(!manifest.media.some(m=>m.object_path===object_path)){manifest.media.push({object_path,document_path:route,sha256:hash(bytes),original_path:rel});entries['media/'+object_path]=new Uint8Array(bytes)}removals.add(rel);return object_path;
 }
 for(const el of [...root.querySelectorAll('*')]){
  const tag=el.tagName.toLowerCase();if(!allowed.has(tag)){el.replaceWith(...el.childNodes);continue}
  const attributes=[...el.attributes];for(const a of attributes){if(!['id','class','title','alt','width','height','loading','decoding','href','src','srcset','type'].includes(a.name))el.removeAttribute(a.name)}
  if(tag==='source'){const alt=el.getAttribute('srcset');if(alt)asset(alt.split(',')[0].trim().split(' ')[0]);el.remove();continue}
  if(tag==='img'){const src=el.getAttribute('src');const obj=src&&asset(src);el.removeAttribute('src');el.removeAttribute('srcset');if(obj)el.setAttribute('data-member-media',obj);else el.remove();}
  if(tag==='a'){const href=el.getAttribute('href');if(!href)continue;if(/^(javascript:|data:|vbscript:)/i.test(href)){el.removeAttribute('href');continue}const obj=asset(href);if(obj){el.removeAttribute('href');el.setAttribute('data-member-download',obj)}else if(!href.startsWith('#')){const url=new URL(href,'https://pmoffice.co.kr'+route);if(url.origin==='https://pmoffice.co.kr'){url.pathname=url.pathname.replace(/\.md$/,'.html');el.setAttribute('href',url.pathname+url.search+url.hash)}else{el.setAttribute('target','_blank');el.setAttribute('rel','noopener noreferrer')}}}
 }
 const toc=[...root.querySelectorAll('h2,h3,h4')].filter(h=>h.id).map(h=>({id:h.id,title:h.textContent.replace(/\u200b/g,'').replace(/#$/,'').trim(),level:Number(h.tagName[1])}));
 const category=file.startsWith('pc-management/')?'테크':file.startsWith('project-management')?'프로젝트 관리':file==='microsoft-project.md'?'MS Project':'실전 AI';
 const doc={path:route,title,category,body_html:root.innerHTML,body_text:root.textContent,toc,source_sha256:hash(original)};const entry='documents/'+slug+'.json',bytes=strToU8(JSON.stringify(doc));entries[entry]=bytes;manifest.documents.push({path:route,entry,sha256:hash(bytes),source_sha256:doc.source_sha256});
 bodyMarkers.push({path:route,marker:root.querySelector('p')?.textContent?.slice(0,70)||'',source_sha256:doc.source_sha256});
}
entries['manifest.json']=strToU8(JSON.stringify(manifest));const zip=zipSync(entries,{level:6});fs.writeFileSync(path.join(output,'knowledge-private-import.zip'),zip);fs.writeFileSync(path.join(output,'knowledge-private-manifest.json'),JSON.stringify(manifest,null,2));fs.writeFileSync(path.join(output,'knowledge-removals.json'),JSON.stringify([...removals],null,2));fs.writeFileSync(path.join(output,'knowledge-body-markers.json'),JSON.stringify(bodyMarkers,null,2));console.log(JSON.stringify({documents:manifest.documents.length,media:manifest.media.length,bytes:zip.length,sha256:hash(zip)}));
