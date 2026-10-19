export async function pmsFetch(path:string,options:RequestInit={}){return (await import('../transport')).pmsFetch(path,options);}
/** Never parse an authentication page, gateway error or framework HTML as JSON. */
export class ApiError extends Error {
  constructor(message:string, public readonly reconnect=false){super(message);this.name='ApiError';}
}
export async function readJsonResponse<T>(response:Response):Promise<T>{
  const type=response.headers.get('content-type')||'';
  if(response.status===401||response.status===403&&!type.includes('application/json')||response.redirected&&type.includes('text/html'))
    throw new ApiError('사이트 연결 인증을 확인해 주세요. 편집 내용은 다운로드로 보존할 수 있습니다.',true);
  if(!type.toLowerCase().includes('application/json'))
    throw new ApiError('서버에서 파일 정보 대신 웹페이지를 반환했습니다. 사이트를 다시 연결한 뒤 시도해 주세요.',true);
  let data:any;
  try{data=await response.json();}catch{throw new ApiError('서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.');}
  if(!response.ok)throw new ApiError(typeof data?.error==='string'?data.error:`요청을 처리하지 못했습니다. (${response.status})`);
  if(!data||typeof data!=='object')throw new ApiError('서버의 파일 정보 형식이 올바르지 않습니다.');
  return data as T;
}
export async function apiJson<T>(path:string,options:RequestInit={}):Promise<T>{
  return readJsonResponse<T>(await pmsFetch(path,options));
}

export async function workbookBytes(response:Response):Promise<Uint8Array>{
 if(!response.ok||/text\/html|application\/json/i.test(response.headers.get('content-type')||'')){
  await readJsonResponse(response);
  throw new ApiError('엑셀 파일을 불러오지 못했습니다.');
 }
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes[0]!==80||bytes[1]!==75)throw new ApiError('엑셀 대신 다른 응답이 반환되었습니다. 사이트를 다시 연결해 주세요.',true);
 return bytes;
}
