import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

const subtle = webcrypto.subtle;
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function validateOrigin(origin) {
  const url = new URL(origin);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith('/')
  ) {
    throw new Error('配置先は https://example.com/ のようなURLで指定してください。');
  }
  return url;
}

export function accessLinks(dataDirectory, origin = 'http://localhost:3217/') {
  const url = new URL(origin);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('配置先は https://example.com/ のようなルートURLで指定してください。');
  }
  let keys;
  try {
    keys = JSON.parse(readFileSync(join(dataDirectory, '.access-links.json'), 'utf8'));
  } catch {
    throw new Error('先に共有サーバーをlinkモードで起動してください。');
  }
  if (
    typeof keys.edit !== 'string' ||
    typeof keys.view !== 'string' ||
    !keys.edit ||
    !keys.view ||
    keys.edit === keys.view
  ) {
    throw new Error('共有リンクの設定が不正です。');
  }
  const edit = new URL(url),
    view = new URL(url);
  edit.hash = new URLSearchParams({ key: keys.edit }).toString();
  view.searchParams.set('readonly', '1');
  view.hash = new URLSearchParams({ key: keys.view }).toString();
  return { edit: edit.href, view: view.href };
}

export async function createServerlessLinks(origin = 'http://localhost:3217/', wsUrl = '') {
  const url = validateOrigin(origin);
  const chBytes = webcrypto.getRandomValues(new Uint8Array(16));
  const channelId = Buffer.from(chBytes).toString('hex');
  const encKey = webcrypto.getRandomValues(new Uint8Array(32));
  const signSeed = webcrypto.getRandomValues(new Uint8Array(32));

  const pkcs8 = Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(signSeed)]);
  const privKey = await subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, true, ['sign']);
  const jwk = await subtle.exportKey('jwk', privKey);
  const pubBytes = Buffer.from(jwk.x, 'base64url');

  const k = Buffer.from(encKey).toString('base64url');
  const s = Buffer.from(signSeed).toString('base64url');
  const v = pubBytes.toString('base64url');

  const editParams = new URLSearchParams({ ch: channelId, k, s });
  const viewParams = new URLSearchParams({ ch: channelId, k, v });
  if (wsUrl) {
    editParams.set('ws', wsUrl);
    viewParams.set('ws', wsUrl);
  }

  const edit = new URL(url);
  const view = new URL(url);
  edit.hash = editParams.toString();
  view.searchParams.set('readonly', '1');
  view.hash = viewParams.toString();

  return {
    edit: edit.href,
    view: view.href,
    channelId,
    validateKeyBase64: pubBytes.toString('base64'),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rawArgs = process.argv.slice(2);
  const flags = new Set(rawArgs.filter(x => !x.includes('=')));
  const args = Object.fromEntries(
    rawArgs
      .filter(x => x.includes('='))
      .map(x => {
        const i = x.indexOf('=');
        return [x.slice(2, i), x.slice(i + 1)];
      })
  );
  const baseUrl = args['base-url'] || process.env.PUBLIC_ORIGIN || 'http://localhost:3217/';
  try {
    if (flags.has('--serverless')) {
      const links = await createServerlessLinks(baseUrl, args['ws'] || '');
      console.log('編集用: ' + links.edit + '\n閲覧用: ' + links.view);
    } else {
      const links = accessLinks(resolve(args['data-dir'] || process.env.DATA_DIR || '.runtime'), baseUrl);
      console.log('編集用: ' + links.edit + '\n閲覧用: ' + links.view);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
