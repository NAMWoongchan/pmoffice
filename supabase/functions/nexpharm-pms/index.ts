import { createNexpharmFilesHandler } from './files.mjs';
import { validateNexpharmFile } from './workbook.mjs';

const supabase = Deno.env.get('SUPABASE_URL')!;
const key = Deno.env.get('SUPABASE_ANON_KEY')!;
const token = Deno.env.get('PMS_GITHUB_TOKEN')?.trim();

Deno.serve(createNexpharmFilesHandler({
  origin: Deno.env.get('PMS_ALLOWED_ORIGIN') || 'https://pmoffice.co.kr',
  dataRepo: Deno.env.get('PMS_DATA_REPO'),
  validate: validateNexpharmFile,
  async rpc(auth: string, name: string, args: object) {
    const response = await fetch(supabase + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { apikey: key, Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!response.ok) throw Object.assign(Error('프로젝트 이용 권한을 확인해 주세요.'), { status: 403 });
    return response.json();
  },
  async github(path: string, options: { method?: string; raw?: boolean; body?: object } = {}, missing = false) {
    if (!token) throw Object.assign(Error('PMS 원본 저장소 연결을 확인해 주세요.'), { status: 503 });
    const response = await fetch('https://api.github.com' + path, {
      method: options.method || 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: options.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
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
