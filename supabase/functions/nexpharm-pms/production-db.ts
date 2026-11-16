const bucket = 'nexpharm-production-originals';
type Rpc = (auth: string, name: string, args: object) => Promise<any>;
type Original = { etag: string; name: string; sha256: string; at: string; size: number; start: string; finish: string };

export function productionDatabase(url: string, key: string, service: string | undefined, rpc: Rpc) {
  function credentials() {
    if (!service) throw Object.assign(Error('생산 일정 저장소 연결이 필요합니다.'), { status: 503 });
    return { apikey: service, Authorization: 'Bearer ' + service };
  }

  async function serviceRpc(name: string, args: object) {
    const response = await fetch(url + '/rest/v1/rpc/' + name, {
      method: 'POST', headers: { ...credentials(), 'Content-Type': 'application/json' }, body: JSON.stringify(args),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      const status = detail?.code === '40001' ? 409 : response.status === 403 ? 403 : 503;
      throw Object.assign(Error(status === 409 ? '게시본이 변경되었습니다. 다시 확인해 주세요.' : '생산 일정을 저장하지 못했습니다.'), { status });
    }
    return response.json();
  }

  async function storage(path: string, bytes?: Uint8Array) {
    const response = await fetch(url + '/storage/v1/object/' + (bytes ? '' : 'authenticated/')
      + bucket + '/' + path.split('/').map(encodeURIComponent).join('/'), {
      method: bytes ? 'POST' : 'GET',
      headers: { ...credentials(), ...(bytes ? { 'Content-Type': 'application/octet-stream', 'x-upsert': 'false' } : {}) },
      body: bytes,
    });
    if (!response.ok) throw Object.assign(Error('비공개 공정표 원본을 확인하지 못했습니다.'), { status: 503 });
    return response;
  }

  return {
    read: (auth: string, slug: string, metaOnly = false) =>
      rpc(auth, 'nexpharm_production_snapshot', { p_slug: slug, p_meta_only: metaOnly }),
    async original(slug: string, etag: string) {
      const path = await serviceRpc('nexpharm_production_original_path', { p_slug: slug, p_etag: etag });
      if (path !== slug + '/' + etag) throw Object.assign(Error('게시본이 변경되었습니다. 다시 확인해 주세요.'), { status: 409 });
      return storage(path);
    },
    async publish(auth: string, slug: string, expected: string, meta: Original | null,
      schedule: object | null, bytes?: Uint8Array, backfill = false) {
      const user = await fetch(url + '/auth/v1/user', { headers: { apikey: key, Authorization: auth } });
      const actor = user.ok ? (await user.json()).id : null;
      if (!actor) throw Object.assign(Error('로그인 정보를 다시 확인해 주세요.'), { status: 403 });
      const path = meta ? slug + '/' + meta.etag : null;
      if (bytes && path) {
        try { await storage(path, bytes); }
        catch (error) {
          if (!backfill) throw error;
          const existing = await (await storage(path)).arrayBuffer();
          const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', existing));
          if (Array.from(digest, value => value.toString(16).padStart(2, '0')).join('') !== meta?.sha256) throw error;
        }
      }
      return serviceRpc('nexpharm_commit_production_snapshot', {
        p_slug: slug, p_actor: actor, p_expected: expected, p_meta: meta, p_schedule: schedule,
        p_path: path, p_backfill: backfill,
      });
    },
  };
}
