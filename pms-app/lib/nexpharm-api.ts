import config from '../../docs/.vitepress/theme/inquiry-public.json';
import { auth, slug } from '../transport';
import type { NexpharmFile } from './nexpharm-book';

export type FileMeta = { etag: string; name: string; at: string; size: number };

export async function nexpharmFile(kind: NexpharmFile, action: string, options: RequestInit = {}) {
  const { data, error } = await auth.auth.getSession();
  if (error || !data.session) throw Error('넥스팜 PMS에 다시 로그인해 주세요.');
  const headers = new Headers(options.headers);
  headers.set('apikey', config.publishableKey);
  headers.set('Authorization', 'Bearer ' + data.session.access_token);
  const params = new URLSearchParams({ project: slug, action, kind });
  const response = await fetch(config.url + '/functions/v1/nexpharm-pms?' + params, { ...options, headers, cache: 'no-store' });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw Object.assign(Error(detail?.error || '파일 요청을 완료하지 못했습니다.'), { status: response.status });
  }
  return response;
}
