<script setup>
import {ref} from 'vue'
import {unzipSync,strFromU8} from 'fflate'
import {memberClient,memberRpc} from './member-service.js'
const busy=ref(false),message=ref('')
const types={png:'image/png',webp:'image/webp',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',svg:'image/svg+xml',pdf:'application/pdf',zip:'application/zip',txt:'text/plain',ps1:'text/plain'}
async function hash(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('')}
async function upload(event){const file=event.target.files?.[0];event.target.value='';if(!file||busy.value)return;busy.value=true;message.value='이전 패키지 검증 중';try{
 if(file.size>100*1024*1024)throw Error('100MB 이하의 이전 ZIP을 선택해 주세요.');
 let expanded=0;const entries=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:e=>{expanded+=e.originalSize;if(expanded>150*1024*1024)throw Error('압축 해제 크기 제한을 초과했습니다.');return e.originalSize<=40*1024*1024}});const manifest=JSON.parse(strFromU8(entries['manifest.json']));
 if(manifest.schema!==1||!Array.isArray(manifest.documents)||!Array.isArray(manifest.media))throw Error('이전 패키지 형식이 올바르지 않습니다.');
 for(const m of manifest.media){const bytes=entries['media/'+m.object_path];if(!bytes||await hash(bytes)!==m.sha256||!/^documents\/[a-z0-9-]+\/[a-zA-Z0-9_.-]+\.(png|webp|jpg|jpeg|gif|svg|pdf|zip|txt|ps1)$/.test(m.object_path))throw Error('이미지·첨부 검증에 실패했습니다.');}
 const docs=[];for(const d of manifest.documents){const bytes=entries[d.entry];if(!bytes||await hash(bytes)!==d.sha256)throw Error('문서 검증에 실패했습니다.');docs.push(JSON.parse(strFromU8(bytes)));}
 for(let i=0;i<manifest.media.length;i++){const m=manifest.media[i];message.value='비공개 파일 저장 '+(i+1)+' / '+manifest.media.length;const {error}=await memberClient().storage.from('member-knowledge').upload(m.object_path,entries['media/'+m.object_path],{upsert:true,contentType:types[m.object_path.split('.').pop()]||'application/octet-stream',cacheControl:'0'});if(error)throw Error('비공개 파일 저장에 실패했습니다. 같은 패키지로 다시 시도할 수 있습니다.');}
 for(const doc of docs){await memberRpc('member_document_import',{p_doc:doc,p_media:manifest.media.filter(x=>x.document_path===doc.path)});const {data,error}=await memberClient().from('member_documents').select('source_sha256').eq('path',doc.path).single();if(error||data?.source_sha256!==doc.source_sha256)throw Error('문서 저장 결과가 일치하지 않습니다.');}
 message.value='문서 '+manifest.documents.length+'개와 비공개 파일 '+manifest.media.length+'개의 저장·재조회 검증을 완료했습니다.';
 }catch(e){message.value=e.message||'이전을 완료하지 못했습니다.'}finally{busy.value=false}}
</script><template><main class="member-page"><h1>지식 자료 관리</h1><p>기존 지식 본문과 이미지를 비공개 저장소로 가져옵니다. 자료는 활성 회원에게 읽기 전용으로 제공하며 기존 VIP 제한은 유지합니다.</p><label>검증된 이전 ZIP<input type="file" accept=".zip" @change="upload" :disabled="busy"></label><p role="status" aria-live="polite">{{message}}</p></main></template>
