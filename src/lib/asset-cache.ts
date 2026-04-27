"use client";

/**
 * IndexedDB 기반 미디어 캐시.
 * 한 번 다운로드한 영상/이미지/오디오를 브라우저에 영구 저장 — 재합성 시 즉시 사용.
 */

const DB_NAME = "shorts-studio-asset-cache";
const STORE = "assets";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unsupported"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

type CachedAsset = {
  bytes: ArrayBuffer;
  contentType: string;
  cachedAt: number;
};

export async function getCachedAsset(
  url: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(url);
      req.onsuccess = () => {
        const v = req.result as CachedAsset | undefined;
        if (!v) return resolve(null);
        resolve({
          bytes: new Uint8Array(v.bytes),
          contentType: v.contentType,
        });
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function setCachedAsset(
  url: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const value: CachedAsset = {
        bytes:
          bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
            ? (bytes.buffer as ArrayBuffer)
            : (bytes.slice().buffer as ArrayBuffer),
        contentType,
        cachedAt: Date.now(),
      };
      tx.objectStore(STORE).put(value, url);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore - best-effort
  }
}

export async function clearAssetCache(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

export async function getCacheStats(): Promise<{
  count: number;
  totalBytes: number;
}> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const countReq = store.count();
      let count = 0;
      countReq.onsuccess = () => {
        count = countReq.result;
      };
      const cursor = store.openCursor();
      let total = 0;
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c) {
          const v = c.value as CachedAsset;
          total += v.bytes.byteLength;
          c.continue();
        } else {
          resolve({ count, totalBytes: total });
        }
      };
      cursor.onerror = () => resolve({ count: 0, totalBytes: 0 });
    });
  } catch {
    return { count: 0, totalBytes: 0 };
  }
}
