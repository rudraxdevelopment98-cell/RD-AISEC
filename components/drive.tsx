"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { Icon } from "@/components/icons";

/**
 * "Connect drive" using the browser File System Access API.
 *
 * The user grants read access to a folder (e.g. their external drive). We keep
 * the directory handle (persisted in IndexedDB) and resolve a resource's drive
 * location to a real file ON THE USER'S MACHINE — opened locally. Nothing is
 * uploaded; the cloud server never sees the files. Chromium browsers only.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DirHandle = any;

const DB_NAME = "rdaisec-drive";
const STORE = "handles";
const KEY = "root";

function supported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(): Promise<DirHandle | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
      t.onsuccess = () => resolve(t.result ?? null);
      t.onerror = () => reject(t.error);
    });
  } catch {
    return null;
  }
}

async function idbSet(handle: DirHandle): Promise<void> {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, "readwrite").objectStore(STORE).put(handle, KEY);
      t.onsuccess = () => resolve(null);
      t.onerror = () => reject(t.error);
    });
  } catch {
    /* ignore */
  }
}

async function idbClear(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise((resolve) => {
      const t = db.transaction(STORE, "readwrite").objectStore(STORE).delete(KEY);
      t.onsuccess = () => resolve(null);
      t.onerror = () => resolve(null);
    });
  } catch {
    /* ignore */
  }
}

async function verifyPermission(handle: DirHandle): Promise<boolean> {
  const opts = { mode: "read" as const };
  if ((await handle.queryPermission?.(opts)) === "granted") return true;
  if ((await handle.requestPermission?.(opts)) === "granted") return true;
  return false;
}

/** Turn a stored location label into path segments relative to the drive root. */
function toSegments(location: string): string[] {
  return location
    .trim()
    .replace(/^[A-Za-z0-9 _-]+:/, "") // strip a "SSD:" / "E:" style prefix
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function resolveFile(root: DirHandle, segments: string[]): Promise<File> {
  let dir = root;
  for (let i = 0; i < segments.length - 1; i++) {
    dir = await dir.getDirectoryHandle(segments[i]);
  }
  const fh = await dir.getFileHandle(segments[segments.length - 1]);
  return await fh.getFile();
}

type DriveContextValue = {
  supported: boolean;
  connected: boolean;
  name: string | null;
  busy: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  openLocation: (location: string) => Promise<void>;
};

const DriveContext = createContext<DriveContextValue | null>(null);

export function useDrive(): DriveContextValue {
  const ctx = useContext(DriveContext);
  if (!ctx) throw new Error("useDrive must be used within <DriveProvider>");
  return ctx;
}

export function DriveProvider({ children }: { children: React.ReactNode }) {
  const [handle, setHandle] = useState<DirHandle | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    idbGet().then((h) => {
      if (h) {
        setHandle(h);
        setName(h.name ?? "drive");
      }
    });
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    if (!supported()) {
      setError("Direct drive access needs Chrome or Edge.");
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const h = await (window as any).showDirectoryPicker({ mode: "read" });
      setHandle(h);
      setName(h.name ?? "drive");
      await idbSet(h);
    } catch {
      /* user cancelled the picker */
    }
  }, []);

  const disconnect = useCallback(async () => {
    setHandle(null);
    setName(null);
    setError(null);
    await idbClear();
  }, []);

  const openLocation = useCallback(
    async (location: string) => {
      setError(null);
      if (!supported()) {
        setError("Direct drive access needs Chrome or Edge.");
        return;
      }
      setBusy(true);
      try {
        let root = handle;
        if (!root) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          root = await (window as any).showDirectoryPicker({ mode: "read" });
          setHandle(root);
          setName(root.name ?? "drive");
          await idbSet(root);
        }
        if (!(await verifyPermission(root))) {
          setError("Permission to read the drive was denied.");
          return;
        }
        const segments = toSegments(location);
        if (segments.length === 0) {
          setError("This resource has no usable drive location.");
          return;
        }
        const file = await resolveFile(root, segments);
        const url = URL.createObjectURL(file);
        const win = window.open(url, "_blank");
        if (!win) {
          const a = document.createElement("a");
          a.href = url;
          a.download = file.name;
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch {
        setError(
          `Couldn't open "${location}" on the connected drive. Make sure the path matches a file under the connected folder.`,
        );
      } finally {
        setBusy(false);
      }
    },
    [handle],
  );

  return (
    <DriveContext.Provider
      value={{
        supported: supported(),
        connected: !!handle,
        name,
        busy,
        error,
        connect,
        disconnect,
        openLocation,
      }}
    >
      {children}
    </DriveContext.Provider>
  );
}

export function ConnectDriveButton() {
  const d = useDrive();
  if (!d.supported) {
    return (
      <span className="tag">Direct drive access needs Chrome or Edge</span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {d.connected ? (
        <>
          <span className="tag ring-emerald accent-emerald">
            <Icon name="server" className="h-3 w-3" /> Drive: {d.name}
          </span>
          <button
            onClick={d.disconnect}
            className="text-xs text-gray-500 hover:text-red-400"
          >
            Disconnect
          </button>
        </>
      ) : (
        <button onClick={d.connect} className="btn-ghost">
          <Icon name="server" className="h-4 w-4" /> Connect drive
        </button>
      )}
      {d.error && <span className="text-xs text-red-400">{d.error}</span>}
    </div>
  );
}

export function OpenFromDriveButton({ location }: { location: string }) {
  const d = useDrive();
  if (!d.supported) return null;
  return (
    <button
      onClick={() => d.openLocation(location)}
      disabled={d.busy}
      className="btn-ghost px-2 py-1 text-xs disabled:opacity-50"
      title="Open this file from the connected drive"
    >
      <Icon name="server" className="h-3 w-3" /> Open from drive
    </button>
  );
}
