import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import type { RecordingKind } from './fanOut';

export interface PendingUpload {
  clientUploadId: string;
  kind: RecordingKind;
  path: string;
  createdAt: string;
  durationMs: number | null;
}

const PENDING_STORAGE_KEY = 'pending_uploads';
const FILENAME_REGEX = /^([a-zA-Z0-9_-]+)\.(meeting|note)\.m4a$/;
const LEGACY_FILENAME_REGEX = /^([a-zA-Z0-9_-]+)\.m4a$/;

let indexLock: Promise<unknown> = Promise.resolve();

function withIndexLock<T>(op: () => Promise<T>): Promise<T> {
  const next = indexLock.then(op, op);
  indexLock = next.catch(() => {});
  return next;
}

interface StoredIndexEntry {
  clientUploadId: string;
  kind?: RecordingKind;
  createdAt: string;
  durationMs: number | null;
  path?: string;
}

async function readRawIndex(): Promise<StoredIndexEntry[] | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function saveStoredList(items: StoredIndexEntry[]): Promise<void> {
  await AsyncStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(items));
}

function getPendingDir(): Directory {
  const dir = new Directory(Paths.document, 'pending');
  dir.create({ idempotent: true });
  return dir;
}

function rebuildIndexFromDisk(files: File[]): StoredIndexEntry[] {
  const entries: StoredIndexEntry[] = [];
  for (const file of files) {
    const match = FILENAME_REGEX.exec(file.name);
    if (match) {
      const clientUploadId = match[1];
      const kind = match[2] as RecordingKind;
      const info = file.info();
      const createdAt = new Date(
        info.modificationTime ?? Date.now(),
      ).toISOString();
      entries.push({
        clientUploadId,
        kind,
        path: file.uri,
        createdAt,
        durationMs: null,
      });
    }
  }
  return entries;
}

async function getOrRebuildIndex(
  pendingDir: Directory,
): Promise<StoredIndexEntry[]> {
  const stored = await readRawIndex();
  if (stored !== null) return stored;

  const files = pendingDir.list().filter((e): e is File => e instanceof File);
  const rebuilt = rebuildIndexFromDisk(files);
  await saveStoredList(rebuilt);
  return rebuilt;
}

export async function enqueue(
  uri: string,
  kind: RecordingKind,
  durationMs: number | null,
): Promise<PendingUpload> {
  return withIndexLock(async () => {
    const clientUploadId = randomUUID();
    const pendingDir = getPendingDir();
    const dest = new File(pendingDir, `${clientUploadId}.${kind}.m4a`);
    await new File(uri).move(dest);

    const item: PendingUpload = {
      clientUploadId,
      kind,
      path: dest.uri,
      createdAt: new Date().toISOString(),
      durationMs,
    };

    const current = await getOrRebuildIndex(pendingDir);
    current.push(item);
    await saveStoredList(current);

    return item;
  });
}

export async function listPending(): Promise<PendingUpload[]> {
  return withIndexLock(async () => {
    const pendingDir = getPendingDir();
    const entries = pendingDir
      .list()
      .filter((e): e is File => e instanceof File);
    let index = await getOrRebuildIndex(pendingDir);

    const indexById = new Map<string, StoredIndexEntry>();
    for (const item of index) {
      indexById.set(item.clientUploadId, item);
    }

    const validFiles: { file: File; id: string; kind: RecordingKind }[] = [];

    for (const file of entries) {
      const match = FILENAME_REGEX.exec(file.name);
      if (match) {
        validFiles.push({
          file,
          id: match[1],
          kind: match[2] as RecordingKind,
        });
        continue;
      }

      const legacyMatch = LEGACY_FILENAME_REGEX.exec(file.name);
      if (legacyMatch) {
        const id = legacyMatch[1];
        const entry = indexById.get(id);
        if (entry?.kind) {
          const renamed = new File(pendingDir, `${id}.${entry.kind}.m4a`);
          await file.move(renamed);
          validFiles.push({ file: renamed, id, kind: entry.kind });
        }
      }
    }

    const result: PendingUpload[] = [];
    const newIndex: StoredIndexEntry[] = [];
    const seenIds = new Set<string>();

    for (const { file, id, kind } of validFiles) {
      seenIds.add(id);
      const entry = indexById.get(id);
      const createdAt =
        entry?.createdAt ??
        new Date(file.info().modificationTime ?? Date.now()).toISOString();
      const durationMs = entry?.durationMs ?? null;

      const pendingItem: PendingUpload = {
        clientUploadId: id,
        kind,
        path: file.uri,
        createdAt,
        durationMs,
      };

      result.push(pendingItem);
      newIndex.push({
        clientUploadId: id,
        kind,
        path: file.uri,
        createdAt,
        durationMs,
      });
    }

    let needsWrite = false;
    if (newIndex.length !== index.length) {
      needsWrite = true;
    } else {
      for (const item of index) {
        if (!seenIds.has(item.clientUploadId)) {
          needsWrite = true;
          break;
        }
      }
    }

    if (needsWrite) {
      await saveStoredList(newIndex);
    }

    return result;
  });
}

export async function removePending(id: string): Promise<void> {
  return withIndexLock(async () => {
    const pendingDir = getPendingDir();
    const files = [
      new File(pendingDir, `${id}.meeting.m4a`),
      new File(pendingDir, `${id}.note.m4a`),
      new File(pendingDir, `${id}.m4a`),
    ];

    for (const file of files) {
      try {
        if (file.exists) {
          file.delete();
        }
      } catch (error) {
        console.warn('Failed to delete pending file', error);
      }
    }

    const current = await getOrRebuildIndex(pendingDir);
    const updated = current.filter((item) => item.clientUploadId !== id);
    await saveStoredList(updated);
  });
}
