import crypto from 'node:crypto';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServerlessLinks } from './links.mjs';

const TURBO_UPLOAD_URL = 'https://upload.ardrive.io/v1/tx';
const MAX_FREE_BYTES = 105 * 1024;

function sha384(buf) {
  return crypto.createHash('sha384').update(buf).digest();
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

function deepHash(chunk) {
  if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) {
    const tag = Buffer.concat([
      Buffer.from('blob', 'utf8'),
      Buffer.from(String(chunk.byteLength), 'utf8'),
    ]);
    return sha384(Buffer.concat([sha384(tag), sha384(chunk)]));
  }
  if (Array.isArray(chunk)) {
    const tag = Buffer.concat([
      Buffer.from('list', 'utf8'),
      Buffer.from(String(chunk.length), 'utf8'),
    ]);
    let acc = sha384(tag);
    for (const item of chunk) {
      acc = sha384(Buffer.concat([acc, deepHash(item)]));
    }
    return acc;
  }
  throw new Error('Unsupported chunk type for deepHash');
}

function writeZigZagVarint(n) {
  let z = BigInt(n) << 1n;
  const bytes = [];
  while (z >= 0x80n) {
    bytes.push(Number((z & 0x7fn) | 0x80n));
    z >>= 7n;
  }
  bytes.push(Number(z));
  return Buffer.from(bytes);
}

function serializeTags(tags) {
  if (!tags || tags.length === 0) return Buffer.alloc(0);
  const chunks = [writeZigZagVarint(tags.length)];
  for (const { name, value } of tags) {
    const nameBuf = Buffer.from(name, 'utf8');
    const valBuf = Buffer.from(value, 'utf8');
    chunks.push(writeZigZagVarint(nameBuf.length), nameBuf);
    chunks.push(writeZigZagVarint(valBuf.length), valBuf);
  }
  chunks.push(Buffer.from([0x00]));
  return Buffer.concat(chunks);
}

function createSignedDataItem(dataBytes, tags, privateKey, ownerBytes) {
  const serializedTags = serializeTags(tags);
  const toSign = deepHash([
    Buffer.from('dataitem', 'utf8'),
    Buffer.from('1', 'utf8'),
    Buffer.from('1', 'utf8'),
    ownerBytes,
    Buffer.alloc(0), // target
    Buffer.alloc(0), // anchor
    serializedTags,
    dataBytes,
  ]);

  const signature = crypto.sign('sha256', toSign, {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32,
  });

  if (signature.byteLength !== 512) {
    throw new Error(`Invalid RSA-4096 signature length: ${signature.byteLength}`);
  }

  const sigTypeBuf = Buffer.from([0x01, 0x00]); // Type 1 = Arweave RSA-PSS
  const targetPresent = Buffer.from([0x00]);
  const anchorPresent = Buffer.from([0x00]);
  const numTagsBuf = Buffer.alloc(8);
  numTagsBuf.writeBigUInt64LE(BigInt(tags.length), 0);
  const numTagBytesBuf = Buffer.alloc(8);
  numTagBytesBuf.writeBigUInt64LE(BigInt(serializedTags.byteLength), 0);

  const rawItem = Buffer.concat([
    sigTypeBuf,
    signature,
    ownerBytes,
    targetPresent,
    anchorPresent,
    numTagsBuf,
    numTagBytesBuf,
    serializedTags,
    dataBytes,
  ]);

  const id = sha256(signature).toString('base64url');
  return { id, rawItem };
}

function getContentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

async function walkFiles(dir, baseDir = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkFiles(full, baseDir)));
    } else if (entry.isFile()) {
      const rel = path.relative(baseDir, full).replace(/\\/g, '/');
      results.push({ full, rel });
    }
  }
  return results;
}

async function uploadDataItem(rawItem, label) {
  if (rawItem.byteLength > MAX_FREE_BYTES) {
    throw new Error(`Item ${label} exceeds 105 KiB free tier limit: ${rawItem.byteLength} bytes`);
  }
  const res = await fetch(TURBO_UPLOAD_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      Accept: 'application/json',
    },
    body: rawItem,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Turbo upload failed for ${label} (HTTP ${res.status}): ${text}`);
  }
  return JSON.parse(text);
}

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const distDir = path.join(rootDir, 'dist');

// Ephemeral 4096-bit RSA keypair generated in memory and discarded after upload (no personal account or persistent wallet)
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 4096 });
const jwk = publicKey.export({ format: 'jwk' });
const ownerBytes = Buffer.from(jwk.n, 'base64url');
if (ownerBytes.byteLength !== 512) {
  throw new Error(`Expected 512-byte RSA modulus, got ${ownerBytes.byteLength}`);
}

const files = await walkFiles(distDir);
const manifestPaths = {};
const uploadedFiles = [];

for (const { full, rel } of files) {
  const content = await readFile(full);
  const contentType = getContentType(rel);
  const { id, rawItem } = createSignedDataItem(
    content,
    [
      { name: 'Content-Type', value: contentType },
      { name: 'App-Name', value: 'Schedule-Share-Autonomous' },
    ],
    privateKey,
    ownerBytes
  );
  const receipt = await uploadDataItem(rawItem, rel);
  const finalId = receipt.id || id;
  manifestPaths[rel] = { id: finalId };
  uploadedFiles.push({ path: rel, id: finalId, bytes: rawItem.byteLength, contentType });
  console.log(`Uploaded ${rel} -> ${finalId} (${rawItem.byteLength} bytes)`);
}

const manifestObj = {
  manifest: 'arweave/paths',
  version: '0.2.0',
  index: { path: 'index.html' },
  paths: manifestPaths,
};

const manifestBytes = Buffer.from(JSON.stringify(manifestObj), 'utf8');
const { id: localManifestId, rawItem: manifestRaw } = createSignedDataItem(
  manifestBytes,
  [
    { name: 'Content-Type', value: 'application/x.arweave-manifest+json' },
    { name: 'App-Name', value: 'Schedule-Share-Autonomous' },
  ],
  privateKey,
  ownerBytes
);

const manifestReceipt = await uploadDataItem(manifestRaw, 'manifest.json');
const manifestId = manifestReceipt.id || localManifestId;
const appBaseUrl = `https://ar-io.dev/${manifestId}/`;
const arweaveMirrorUrl = `https://arweave.net/${manifestId}/`;

const outPath = path.join(
  'C:/Users/user/Documents/Codex/2026-10-31/schedule-share-local-validation',
  'arweave-deployment-result.json'
);

let shareLinks;
try {
  const prevRecord = JSON.parse(await readFile(outPath, 'utf8'));
  const prevEditHash = new URL(prevRecord.shareLinks.edit).hash;
  const prevViewHash = new URL(prevRecord.shareLinks.view).hash;
  if (prevEditHash.startsWith('#ch=') && prevViewHash.startsWith('#ch=')) {
    const viewBase = new URL(appBaseUrl);
    viewBase.searchParams.set('readonly', '1');
    shareLinks = {
      edit: `${appBaseUrl}${prevEditHash}`,
      view: `${viewBase.toString()}${prevViewHash}`,
    };
  }
} catch {}

if (!shareLinks) {
  shareLinks = await createServerlessLinks(appBaseUrl);
}

const deploymentRecord = {
  deployedAt: new Date().toISOString(),
  manifestId,
  appBaseUrl,
  arweaveMirrorUrl,
  shareLinks,
  uploadedFiles,
};

await writeFile(outPath, JSON.stringify(deploymentRecord, null, 2), 'utf8');
console.log(JSON.stringify(deploymentRecord, null, 2));
