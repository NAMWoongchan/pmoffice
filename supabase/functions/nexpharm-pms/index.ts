import { createNexpharmFilesHandler } from './files.mjs';
import { validateNexpharmFile } from './workbook.mjs';

const supabase = Deno.env.get('SUPABASE_URL')!;
const key = Deno.env.get('SUPABASE_ANON_KEY')!;
const token = Deno.env.get('PMS_GITHUB_TOKEN')?.trim();
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

Deno.serve(createNexpharmFilesHandler({
  origin: Deno.env.get('PMS_ALLOWED_ORIGIN') || 'https://pmoffice.co.kr',
  dataRepo: Deno.env.get('PMS_DATA_REPO'),
  validate: validateNexpharmFile,
  async recordUpload(slug: string, sha256: string, etag: string) {
    if (!serviceKey) throw Error('프로젝트 게시 확인 연결이 필요합니다.');
    const response = await fetch(supabase + '/rest/v1/rpc/nexpharm_record_typed_upload', {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_slug: slug, p_sha256: sha256, p_etag: etag }),
    });
    if (!response.ok) throw Error('프로젝트 파일 검증 기록을 저장하지 못했습니다.');
  },
  async rpc(auth: string, name: string, args: object) {
    const response = await fetch(supabase + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { apikey: key, Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!response.ok) throw Object.assign(Error('프로젝트 이용 권한을 확인해 주세요.'), { status: 403 });
    // PostgREST returns no content for successful void routines such as the audit insert.
    return response.status === 204 ? null : response.json();
  },
  async github(path: string, options: { method?: string; raw?: boolean; body?: object } = {}, missing = false) {
    if (!token) throw Object.assign(Error('PMS 원본 저장소 연결을 확인해 주세요.'), { status: 503 });
    const accept = options.raw ? 'application/vnd.github.raw+json' : !options.method && path.includes('/contents/')
      ? 'application/vnd.github.object+json' : 'application/vnd.github+json';
    const response = await fetch('https://api.github.com' + path, {
      method: options.method || 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    if (response.status === 404 && missing) return null;
    if (!response.ok) {
      const conflict = [409, 422].includes(response.status) || (response.status === 404 && options.method === 'DELETE');
      throw Object.assign(Error(conflict ? '파일이 변경되었습니다. 최신본을 확인해 주세요.' : 'PMS 원본 저장소 요청을 완료하지 못했습니다.'),
        { status: conflict ? 409 : 503 });
    }
    return response.json();
  },
}));
