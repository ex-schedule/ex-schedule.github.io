// Zero-dependency WebCrypto Ed25519 + AES-256-GCM codec compatible with CryptPad History Keeper VALIDATE_MESSAGE.
import type { CommandOperation } from './commandReducer';

export type ChannelCredentials = {
  wsUrl: string;
  channelId: string; // 32-char hex
  encKeyBase64Url: string; // 32-byte AES-256-GCM key
  validateKeyBase64: string; // 32-byte Ed25519 public key in standard base64 (for CryptPad HK)
  editSeedBase64Url?: string; // 32-byte Ed25519 private seed (present only for editors)
  readOnly: boolean;
};

export const DEFAULT_CRYPTPAD_WS = 'wss://api.cryptpad.fr/cryptpad_websocket';

const PKCS8_ED25519_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4);
  return base64ToBytes(padded);
}

export async function deriveEd25519FromSeed(seed32: Uint8Array): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  rawPublicKey: Uint8Array;
  validateKeyBase64: string;
}> {
  if (seed32.length !== 32) throw new Error('Ed25519 seed must be 32 bytes');
  const pkcs8 = new Uint8Array(PKCS8_ED25519_PREFIX.length + 32);
  pkcs8.set(PKCS8_ED25519_PREFIX, 0);
  pkcs8.set(seed32, PKCS8_ED25519_PREFIX.length);
  const privateKey = await globalThis.crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'Ed25519' },
    true,
    ['sign']
  );
  const jwk = await globalThis.crypto.subtle.exportKey('jwk', privateKey);
  if (!jwk.x) throw new Error('Failed to derive Ed25519 public key from seed');
  const rawPublicKey = base64UrlToBytes(jwk.x);
  const publicKey = await globalThis.crypto.subtle.importKey(
    'raw',
    rawPublicKey,
    { name: 'Ed25519' },
    true,
    ['verify']
  );
  return {
    privateKey,
    publicKey,
    rawPublicKey,
    validateKeyBase64: bytesToBase64(rawPublicKey),
  };
}

export async function generateNewChannelCredentials(wsUrl = DEFAULT_CRYPTPAD_WS): Promise<ChannelCredentials> {
  const channelBytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const encKeyBytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const editSeedBytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const { validateKeyBase64 } = await deriveEd25519FromSeed(editSeedBytes);
  return {
    wsUrl,
    channelId: bytesToHex(channelBytes),
    encKeyBase64Url: bytesToBase64Url(encKeyBytes),
    validateKeyBase64,
    editSeedBase64Url: bytesToBase64Url(editSeedBytes),
    readOnly: false,
  };
}

export function formatShareHash(creds: ChannelCredentials, mode: 'edit' | 'view'): string {
  const params = new URLSearchParams();
  params.set('ch', creds.channelId);
  params.set('k', creds.encKeyBase64Url);
  if (mode === 'edit' && creds.editSeedBase64Url) {
    params.set('s', creds.editSeedBase64Url);
  } else {
    params.set('v', bytesToBase64Url(base64ToBytes(creds.validateKeyBase64)));
  }
  if (creds.wsUrl && creds.wsUrl !== DEFAULT_CRYPTPAD_WS) {
    params.set('ws', creds.wsUrl);
  }
  return '#' + params.toString();
}

export async function parseShareHash(hash: string): Promise<ChannelCredentials | null> {
  const cleaned = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!cleaned) return null;
  const params = new URLSearchParams(cleaned);
  const ch = params.get('ch');
  const k = params.get('k');
  const s = params.get('s');
  const v = params.get('v');
  const wsUrl = params.get('ws') || DEFAULT_CRYPTPAD_WS;

  if (!ch || !/^[0-9a-f]{32}$/i.test(ch) || !k) return null;
  const encBytes = base64UrlToBytes(k);
  if (encBytes.length !== 32) return null;

  if (s) {
    const seedBytes = base64UrlToBytes(s);
    if (seedBytes.length !== 32) return null;
    const { validateKeyBase64 } = await deriveEd25519FromSeed(seedBytes);
    return {
      wsUrl,
      channelId: ch.toLowerCase(),
      encKeyBase64Url: k,
      validateKeyBase64,
      editSeedBase64Url: s,
      readOnly: false,
    };
  }

  if (v) {
    const pubBytes = base64UrlToBytes(v);
    if (pubBytes.length !== 32) return null;
    return {
      wsUrl,
      channelId: ch.toLowerCase(),
      encKeyBase64Url: k,
      validateKeyBase64: bytesToBase64(pubBytes),
      readOnly: true,
    };
  }

  return null;
}

export async function createCryptoCodec(creds: ChannelCredentials) {
  const encKeyBytes = base64UrlToBytes(creds.encKeyBase64Url);
  const aesKey = await globalThis.crypto.subtle.importKey(
    'raw',
    encKeyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );

  let privateKey: CryptoKey | null = null;
  let publicKey: CryptoKey;

  if (creds.editSeedBase64Url) {
    const derived = await deriveEd25519FromSeed(base64UrlToBytes(creds.editSeedBase64Url));
    privateKey = derived.privateKey;
    publicKey = derived.publicKey;
  } else {
    const rawPub = base64ToBytes(creds.validateKeyBase64);
    publicKey = await globalThis.crypto.subtle.importKey(
      'raw',
      rawPub,
      { name: 'Ed25519' },
      false,
      ['verify']
    );
  }

  async function encryptAndSign(op: CommandOperation): Promise<string> {
    if (!privateKey) throw new Error('permission-denied: 閲覧用リンクでは編集できません。');
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(op));
    const ciphertextWithTag = new Uint8Array(
      await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintext)
    );
    const envelope = new Uint8Array(12 + ciphertextWithTag.length);
    envelope.set(iv, 0);
    envelope.set(ciphertextWithTag, 12);

    const signature = new Uint8Array(
      await globalThis.crypto.subtle.sign({ name: 'Ed25519' }, privateKey, envelope)
    );
    const signedPacket = new Uint8Array(64 + envelope.length);
    signedPacket.set(signature, 0);
    signedPacket.set(envelope, 64);
    return bytesToBase64(signedPacket);
  }

  async function verifyAndDecrypt(signedBase64: string): Promise<CommandOperation | null> {
    try {
      const packet = base64ToBytes(signedBase64);
      if (packet.length < 64 + 12 + 16) return null;
      const signature = packet.subarray(0, 64);
      const envelope = packet.subarray(64);
      const valid = await globalThis.crypto.subtle.verify(
        { name: 'Ed25519' },
        publicKey,
        signature,
        envelope
      );
      if (!valid) return null;
      const iv = envelope.subarray(0, 12);
      const ciphertextWithTag = envelope.subarray(12);
      const decrypted = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        ciphertextWithTag
      );
      return JSON.parse(new TextDecoder().decode(decrypted)) as CommandOperation;
    } catch {
      return null;
    }
  }

  return {
    creds,
    encryptAndSign,
    verifyAndDecrypt,
  };
}
