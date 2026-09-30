import type { Edits } from "./pdf/types";

/**
 * Work-in-progress lives in IndexedDB (localStorage caps out at ~5 MB, far too small for a PDF),
 * so a refresh or an accidental tab close never loses the document or its edits.
 */
const DB = "docedit";
const STORE = "session";
const KEY = "current";

export interface Session {
  bytes: ArrayBuffer;
  fileName: string;
  edits: Edits;
  scale: number;
  currentPage: number;
  savedAt: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode: IDBTransactionMode) {
  const db = await open();
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function saveSession(s: Session) {
  try {
    const store = await tx("readwrite");
    await new Promise<void>((resolve, reject) => {
      const r = store.put(s, KEY);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  } catch {
    /* storage unavailable (private mode / quota) — editing still works, just without recovery */
  }
}

export async function loadSession(): Promise<Session | null> {
  try {
    const store = await tx("readonly");
    return await new Promise((resolve, reject) => {
      const r = store.get(KEY);
      r.onsuccess = () => resolve((r.result as Session) ?? null);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return null;
  }
}

export async function clearSession() {
  try {
    const store = await tx("readwrite");
    store.delete(KEY);
  } catch {
    /* ignore */
  }
}
