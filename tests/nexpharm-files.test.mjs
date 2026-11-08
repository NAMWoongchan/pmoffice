import assert from 'node:assert/strict';
import test from 'node:test';
import { createNexpharmFilesHandler } from '../supabase/functions/nexpharm-pms/files.mjs';

test('Nexpharm workbook lifecycle, separate reference, original bytes and authorization', async () => {
  const origin = 'https://pmoffice.co.kr';
  const project = 'nexpharm-001122334455';
  const dataRepo = 'test/private-data';
  const assets = new Map(), audit = [];
  let version = 0, privateRepo = true, revokeOnRead = false, revokeOnValidation = false, allowOperator = true;
  const handler = createNexpharmFilesHandler({
    origin, dataRepo,
    async rpc(auth, name, params) {
      if (name === 'nexpharm_file_audit') { audit.push(params.p_action); return null; }
      const operator = auth === 'operator' && allowOperator;
      return { canRead: params.p_slug === project && (auth === 'viewer' || operator), canManage: operator };
    },
    async validate(bytes) {
      if (bytes.length < 5) throw Error('Invalid workbook');
      if (revokeOnValidation) allowOperator = false;
    },
    async github(url, options) {
      if (url === '/repos/' + dataRepo) return { private: privateRepo };
      const path = url.split('?')[0];
      const current = assets.get(path);
      if (options.method === 'PUT') {
        assert.equal(options.body.sha, current?.sha);
        const sha = String(++version);
        assets.set(path, { sha, data: JSON.parse(Buffer.from(options.body.content, 'base64')) });
        return { content: { sha }, commit: { sha: 'commit-' + sha } };
      }
      if (options.method === 'DELETE') {
        assert.equal(options.body.sha, current.sha);
        assets.delete(path);
        return { content: null, commit: { sha: 'delete-' + current.sha } };
      }
      if (options.raw) {
        if (revokeOnRead) allowOperator = false;
        return current?.data ?? null;
      }
      return current ? { sha: current.sha } : null;
    },
  });

  const request = (action, { auth = 'operator', kind = 'workbook', etag = 'seed', bytes, slug = project } = {}) =>
    handler(new Request(origin + '/files?' + new URLSearchParams({ project: slug, action, kind }), {
      method: ['publish', 'remove'].includes(action) ? 'POST' : 'GET',
      headers: { origin, ...(auth ? { authorization: auth } : {}), 'if-match': etag, 'x-filename': encodeURIComponent('시험.xlsx') },
      body: bytes,
    }));
  const bytes = Uint8Array.from([80, 75, 3, 4, 5]);
  assert.equal((await request('file', { auth: '' })).status, 403);
  assert.equal((await request('meta', { slug: 'nexpharm-aabbccddeeff' })).status, 403);
  assert.equal((await request('publish', { auth: 'viewer', bytes })).status, 403);
  assert.equal((await request('publish', { bytes: Uint8Array.from([80, 75, 3, 4]) })).status, 400);
  assert.equal((await (await request('meta')).json()).current, null);

  const first = await (await request('publish', { bytes })).json();
  assert.equal(first.etag, '1');
  assert.equal((await request('publish', { bytes })).status, 409);
  const file = await request('file', { auth: 'viewer' });
  assert.equal(file.headers.get('cache-control'), 'private, no-store');
  assert.equal(decodeURIComponent(file.headers.get('x-filename')), '시험.xlsx');
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
  assert.equal((await request('remove', { auth: 'viewer', etag: '1' })).status, 403);

  const reference = await (await request('publish', { kind: 'reference', bytes })).json();
  assert.equal(reference.etag, '2');
  const replacement = await (await request('publish', { bytes, etag: first.etag })).json();
  assert.equal(replacement.etag, '3');
  assert.equal((await request('remove', { etag: '1' })).status, 409);
  assert.equal((await request('remove', { etag: '3' })).status, 200);
  assert.equal((await request('file')).status, 404);
  assert.equal((await request('file', { kind: 'reference' })).status, 200);

  revokeOnRead = true;
  assert.equal((await request('file', { kind: 'reference' })).status, 403);
  revokeOnRead = false; allowOperator = true; revokeOnValidation = true;
  assert.equal((await request('publish', { bytes })).status, 403);
  revokeOnValidation = false; allowOperator = true; privateRepo = false;
  assert.equal((await request('file', { kind: 'reference' })).status, 503);
  assert.deepEqual(audit, ['workbook.publish', 'reference.publish', 'workbook.publish', 'workbook.remove']);
});
