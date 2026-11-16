export const isNexpharmProject = (value) => /^nexpharm-[0-9a-f]{12}$/.test(value ?? '');
const MAX_BYTES = 8 * 1024 * 1024;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLSM = 'application/vnd.ms-excel.sheet.macroEnabled.12';
const PRODUCTION = 'production_outsourcing';

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

async function readUpload(request) {
  if (Number(request.headers.get('content-length')) > MAX_BYTES) fail(413, '파일당 최대 8MiB까지 등록할 수 있습니다.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, '파일을 선택해 주세요.');
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      fail(413, '파일당 최대 8MiB까지 등록할 수 있습니다.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function toBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 32768) {
    text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  return btoa(text);
}

const validName = (name, production) => typeof name === 'string'
  && (production ? /^[^\\/\x00-\x1f\x7f]{1,180}\.(xlsx|xlsm)$/i : /^[^\\/\x00-\x1f\x7f]{1,180}\.xlsx$/i).test(name);

async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createNexpharmFilesHandler({ rpc, github, validate, recordUpload, origin, dataRepo, branch = 'main' }) {
  return async (request) => {
    const headers = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-filename, if-match',
      'Access-Control-Expose-Headers': 'ETag, X-Filename',
      'Cache-Control': 'private, no-store',
      Vary: 'Origin',
    };
    const json = (value, status = 200) => new Response(JSON.stringify(value), {
      status, headers: { ...headers, 'Content-Type': 'application/json' },
    });

    try {
      if (request.headers.get('origin') && request.headers.get('origin') !== origin) fail(403, '허용되지 않은 요청입니다.');
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      const { searchParams } = new URL(request.url);
      const project = searchParams.get('project');
      const action = searchParams.get('action') || 'meta';
      const kind = searchParams.get('kind') || 'workbook';
      if (!isNexpharmProject(project) || !['workbook', 'reference'].includes(kind)) fail(400, '프로젝트와 파일 유형을 확인해 주세요.');
      if (!(request.method === 'GET' && ['meta', 'file', 'schedule'].includes(action))
        && !(request.method === 'POST' && ['publish', 'remove'].includes(action))) fail(405, '지원하지 않는 요청입니다.');

      const auth = request.headers.get('authorization') || '';
      if (!auth) fail(403, '넥스팜 PMS에 로그인해 주세요.');
      const writing = request.method === 'POST';
      const check = async () => {
        const access = await rpc(auth, 'nexpharm_access', { p_slug: project });
        if (access?.canRead !== true || (writing && access.canManage !== true)) fail(403, '프로젝트 또는 파일 관리 권한을 확인해 주세요.');
        return access;
      };
      let access = await check();
      const production = kind === 'workbook' && access.project?.template === PRODUCTION;
      if (kind === 'reference' && access.project?.template === PRODUCTION) fail(404, '생산 일정에는 별도 참고 파일이 없습니다.');
      if (action === 'schedule' && !production) fail(400, '생산위수탁관리 일정에만 사용할 수 있습니다.');
      if (production && action === 'file' && access.canManage !== true) fail(403, '공정표 원본은 관리자만 내려받을 수 있습니다.');
      if (!dataRepo || !/^[-\w]+\/[-\w.]+$/.test(dataRepo)) fail(503, '비공개 원본 저장소 연결이 필요합니다.');
      if ((await github('/repos/' + dataRepo)).private !== true) fail(503, '비공개 원본 저장소 연결이 필요합니다.');

      const storageName = production ? 'production-schedule' : kind;
      const path = '/repos/' + dataRepo + '/contents/projects/' + project + '/' + storageName + '.json';
      const ref = path + '?ref=' + encodeURIComponent(branch);
      const current = await github(ref, {}, true);
      if (!writing) {
        if (!current) {
          if (action !== 'meta') fail(404, '등록된 파일이 없습니다.');
          access = await check();
          return json({ current: null, canManage: access.canManage === true });
        }
        const payload = await github(ref, { raw: true }, true);
        if (!payload || (await github(ref, {}, true))?.sha !== current.sha) fail(409, '파일이 변경되었습니다. 새로고침해 주세요.');
        if (payload.schema !== (production ? 2 : 1) || !validName(payload.name, production) || typeof payload.content !== 'string'
          || !Number.isInteger(payload.size) || payload.size < 4 || payload.size > MAX_BYTES
          || payload.content.length !== 4 * Math.ceil(payload.size / 3)) fail(502, '등록된 파일 정보를 읽을 수 없습니다.');
        access = await check();
        if (production && action === 'file' && access.canManage !== true) fail(403, '공정표 원본은 관리자만 내려받을 수 있습니다.');
        if (production && (!Array.isArray(payload.schedule?.tasks) || !Array.isArray(payload.schedule?.days))) {
          fail(502, '등록된 생산 일정 정보를 읽을 수 없습니다.');
        }
        if (action === 'meta') return json({
          current: { etag: current.sha, name: payload.name, at: payload.at, size: payload.size,
            ...(access.canManage && payload.sha256 ? { sha256: payload.sha256 } : {}),
            ...(production ? { start: payload.schedule.start, finish: payload.schedule.finish } : {}) },
          canManage: access.canManage === true,
        });
        if (action === 'schedule') return json({ etag: current.sha, schedule: payload.schedule });
        const bytes = Uint8Array.from(atob(payload.content), (value) => value.charCodeAt(0));
        if (bytes.length !== payload.size || bytes[0] !== 80 || bytes[1] !== 75) fail(502, '등록된 파일을 확인할 수 없습니다.');
        return new Response(bytes, { headers: { ...headers, 'Content-Type': /\.xlsm$/i.test(payload.name) ? XLSM : XLSX, ETag: current.sha,
          'X-Content-Type-Options': 'nosniff', 'X-Filename': encodeURIComponent(payload.name) } });
      }

      if (request.headers.get('if-match') !== (current?.sha || 'seed')) fail(409, '다른 변경이 있습니다. 최신 파일을 확인해 주세요.');
      let result, details;
      const expectedDigest = kind === 'workbook' && access.project?.status === 'draft' ? access.project.sourceSha256 : null;
      let actualDigest;
      if (action === 'remove') {
        if (expectedDigest) fail(409, '등록 진행 중인 공정표는 제거할 수 없습니다.');
        if (!current) fail(404, '제거할 파일이 없습니다.');
        await check();
        result = await github(path, { method: 'DELETE', body: {
          message: 'Remove current Nexpharm ' + kind, branch, sha: current.sha,
        } });
        details = { commit: result.commit.sha, previous: current.sha };
      } else {
        let name;
        try { name = decodeURIComponent(request.headers.get('x-filename') || ''); }
        catch { fail(400, '파일명을 확인해 주세요.'); }
        if (!validName(name, production)) fail(400, production ? 'xlsx 또는 xlsm 파일을 선택해 주세요.' : 'xlsx 파일을 선택해 주세요.');
        const bytes = await readUpload(request);
        if (bytes[0] !== 80 || bytes[1] !== 75) fail(400, '올바른 Excel 통합문서를 선택해 주세요.');
        let schedule;
        try { schedule = await validate(bytes, name, kind, production ? PRODUCTION : 'rd'); }
        catch (error) { fail(400, error.message); }
        if (expectedDigest && !recordUpload) fail(503, '프로젝트 게시 확인 연결이 필요합니다.');
        actualDigest = await sha256(bytes);
        if (expectedDigest && actualDigest !== expectedDigest) fail(409, '임시 등록에 사용한 동일 파일을 선택해 주세요.');

        const at = new Date().toISOString();
        const payload = { schema: production ? 2 : 1, name, size: bytes.length, at, content: toBase64(bytes), sha256: actualDigest,
          ...(production ? { schedule } : {}) };
        await check();
        const existing = current && expectedDigest ? await github(ref, { raw: true }, true) : null;
        if (existing?.sha256 === actualDigest && (await github(ref, {}, true))?.sha === current.sha) {
          result = { content: { sha: current.sha } };
        } else {
          result = await github(path, { method: 'PUT', body: {
            message: 'Publish Nexpharm ' + kind, branch,
            content: toBase64(new TextEncoder().encode(JSON.stringify(payload))),
            ...(current ? { sha: current.sha } : {}),
          } });
        }
        details = { commit: result.commit?.sha ?? null, blob: result.content.sha, name, size: bytes.length };
      }
      let auditRecorded = true;
      try {
        if (expectedDigest && action === 'publish') {
          await check();
          await recordUpload(project, actualDigest, result.content.sha);
        }
        await rpc(auth, 'nexpharm_file_audit', { p_slug: project, p_action: kind + '.' + action, p_details: details });
      } catch { auditRecorded = false; }
      return json({ etag: result.content?.sha ?? null, audit_recorded: auditRecorded });
    } catch (error) {
      const status = [400, 401, 403, 404, 405, 409, 413, 502, 503].includes(error.status) ? error.status : 502;
      return json({ error: error.status === status ? error.message : '파일 요청을 완료하지 못했습니다. 다시 확인해 주세요.' }, status);
    }
  };
}
