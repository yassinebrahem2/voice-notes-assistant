import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import type { RecordingKind } from './fanOut';

export interface PendingUpload {
  clientUploadId: string;
  kind: RecordingKind;
  path: string;
  createdAt: string;
  durationMs: number;
}

const PENDING_STORAGE_KEY = 'pending_uploads';

type AsyncStorageType = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

let storageInstance: AsyncStorageType | null = null;

function getStorage(): AsyncStorageType {
  if (!storageInstance) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-async-storage/async-storage') as {
      default: AsyncStorageType;
    };
    storageInstance = mod.default;
  }
  return storageInstance;
}

async function getStoredList(): Promise<PendingUpload[]> {
  try {
    const raw = await getStorage().getItem(PENDING_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveStoredList(items: PendingUpload[]): Promise<void> {
  await getStorage().setItem(PENDING_STORAGE_KEY, JSON.stringify(items));
}

export async function enqueue(
  uri: string,
  kind: RecordingKind,
  durationMs: number,
): Promise<PendingUpload> {
  const clientUploadId = randomUUID();
  const pendingDir = new Directory(Paths.document, 'pending');
  pendingDir.create({ idempotent: true });

  const dest = new File(pendingDir, `${clientUploadId}.m4a`);
  await new File(uri).move(dest);

  const item: PendingUpload = {
    clientUploadId,
    kind,
    path: dest.uri,
    createdAt: new Date().toISOString(),
    durationMs,
  };

  const current = await getStoredList();
  current.push(item);
  await saveStoredList(current);

  return item;
}

export async function listPending(): Promise<PendingUpload[]> {
  const items = await getStoredList();
  const valid: PendingUpload[] = [];
  let dropped = false;

  for (const item of items) {
    if (new File(item.path).exists) {
      valid.push(item);
    } else {
      dropped = true;
    }
  }

  if (dropped) {
    await saveStoredList(valid);
  }

  return valid;
}

export async function removePending(id: string): Promise<void> {
  const items = await getStoredList();
  const index = items.findIndex((item) => item.clientUploadId === id);
  if (index === -1) {
    return;
  }

  const [toRemove] = items.splice(index, 1);
  try {
    const file = new File(toRemove.path);
    if (file.exists) {
      file.delete();
    }
  } catch (error) {
    console.warn('Failed to delete pending file', error);
  }

  await saveStoredList(items);
}
