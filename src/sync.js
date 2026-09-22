const API = 'https://api.jsonstorage.net/v1/json';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const bytesToB64 = (bytes) => {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

const b64ToBytes = (value) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const compress = async (text) => {
  const plain = encoder.encode(text);
  if (!('CompressionStream' in globalThis)) return { bytes: plain, compression: 'none' };
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  await writer.write(plain);
  await writer.close();
  return { bytes: new Uint8Array(await new Response(stream.readable).arrayBuffer()), compression: 'gzip' };
};

const decompress = async (bytes, compression) => {
  if (compression !== 'gzip' || !('DecompressionStream' in globalThis)) return decoder.decode(bytes);
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  return decoder.decode(await new Response(stream.readable).arrayBuffer());
};

const deriveKey = async (pin, salt) => {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

export const encryptState = async (state, pin) => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt);
  const packed = await compress(JSON.stringify(state));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, packed.bytes);
  return {
    schema: 'oab48-sync-v2',
    compression: packed.compression,
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    data: bytesToB64(new Uint8Array(encrypted)),
    updatedAt: new Date().toISOString(),
  };
};

export const decryptState = async (payload, pin) => {
  if (!payload || !['oab48-sync-v1', 'oab48-sync-v2'].includes(payload.schema)) {
    throw new Error('Formato de sincronização inválido.');
  }
  const salt = b64ToBytes(payload.salt);
  const iv = b64ToBytes(payload.iv);
  const encrypted = b64ToBytes(payload.data);
  const key = await deriveKey(pin, salt);
  try {
    const decrypted = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted));
    const json = payload.schema === 'oab48-sync-v1'
      ? decoder.decode(decrypted)
      : await decompress(decrypted, payload.compression || 'none');
    return JSON.parse(json);
  } catch {
    throw new Error('PIN incorreto ou dados de sincronização corrompidos.');
  }
};

export const normalizeSyncKey = (value) => {
  const clean = (value || '').trim();
  if (!clean) return '';
  if (clean.startsWith('http')) {
    const marker = '/v1/json/';
    const idx = clean.indexOf(marker);
    if (idx === -1) return '';
    return clean.slice(idx + marker.length).replace(/^\/+|\/+$/g, '');
  }
  return clean.replace(/^\/+|\/+$/g, '');
};

const uriFromKey = (syncKey) => `${API}/${normalizeSyncKey(syncKey)}`;

export const createCloudVault = async (state, pin) => {
  const bootstrap = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema: 'oab48-bootstrap', createdAt: new Date().toISOString() }),
  });
  if (!bootstrap.ok) throw new Error('Não foi possível criar o cofre remoto.');
  const result = await bootstrap.json();
  const syncKey = normalizeSyncKey(result.uri);
  if (!syncKey) throw new Error('O serviço remoto não retornou uma chave válida.');
  await saveCloudState(syncKey, state, pin);
  return syncKey;
};

export const saveCloudState = async (syncKey, state, pin) => {
  const key = normalizeSyncKey(syncKey);
  if (!key) throw new Error('Chave de sincronização inválida.');
  if (!pin || pin.length < 6) throw new Error('O PIN deve ter pelo menos 6 caracteres.');
  const encrypted = await encryptState(state, pin);
  const response = await fetch(uriFromKey(key), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(encrypted),
  });
  if (!response.ok) throw new Error('Falha ao salvar os dados na nuvem.');
  return encrypted.updatedAt;
};

export const loadCloudState = async (syncKey, pin) => {
  const key = normalizeSyncKey(syncKey);
  if (!key) throw new Error('Chave de sincronização inválida.');
  const response = await fetch(uriFromKey(key), { method: 'GET' });
  if (!response.ok) throw new Error('Não foi possível localizar os dados dessa chave.');
  const payload = await response.json();
  const state = await decryptState(payload, pin);
  return { state, updatedAt: payload.updatedAt || null };
};
