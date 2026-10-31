import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.mjs';
import { accessLinks } from '../scripts/links.mjs';
import { validateTeamConfig } from '../scripts/team-config.mjs';

test('a new shared installation creates stable access links and enforces their roles after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'schedule-share-dist-'));
  let server;
  try {
    server = await startServer({ port: 0, dataDir: dir, accessMode: 'link' });
    const origin = 'http://127.0.0.1:'+server.port;
    const first = accessLinks(dir, origin);
    const key = new URLSearchParams(new URL(first.edit).hash.slice(1)).get('key');
    const response = await fetch(origin+'/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const viewKey = new URLSearchParams(new URL(first.view).hash.slice(1)).get('key');
    const viewResponse = await fetch(origin+'/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: viewKey }) });
    const viewCookie = viewResponse.headers.get('set-cookie').split(';')[0];
    const denied = await fetch(origin+'/api/commit', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: viewCookie }, body: JSON.stringify({writes:[]}) });
    assert.equal(denied.status, 403);
    const backup = await fetch(origin+'/api/backup', { headers: { cookie } }).then(r=>r.json());
    const team = JSON.parse(await readFile(new URL('../config/team.json', import.meta.url), 'utf8'));
    const month = backup.documents.find(x => x.collection === 'months');
    assert.deepEqual(Object.keys(month.data.schedule), team.members);
    assert.deepEqual(month.data.projects, []);
    assert.ok(Object.values(month.data.schedule).flat().every(x=>x.type==='rest' && x.detail===''));
    await server.close(); server = undefined;
    server = await startServer({ port: 0, dataDir: dir, accessMode: 'link' });
    const second = accessLinks(dir, origin);
    assert.deepEqual(second, first);
    assert.throws(()=>accessLinks(dir, 'https://example.com/subpath'), /ルートURL/);
  } finally { await server?.close(); await rm(dir,{recursive:true,force:true}); }
});

test('invalid team configuration fails clearly instead of silently losing members', () => {
  const valid = { members: ['Member.A', 'Member B'], leadMembers: ['Member.A'], trainingLabels: {}, trainingLocations: {} };
  assert.equal(validateTeamConfig(valid), valid);
  for (const change of [{members:[]}, {members:['A','A']}, {members:[' A']}, {leadMembers:['unknown']}, {members:['constructor']}]) {
    assert.throws(()=>validateTeamConfig({...valid,...change}), /team.json/);
  }
});
