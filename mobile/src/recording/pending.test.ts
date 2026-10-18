import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';

import {
  enqueue,
  listPending,
  removePending,
  type PendingUpload,
} from './pending';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(),
}));

const mockFiles = new Map<string, boolean>();

function mockNormalizeUri(...parts: (string | { uri: string })[]): string {
  const raw = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
  if (raw.startsWith('file:///')) {
    return 'file:///' + raw.slice(8).replace(/\/+/g, '/');
  }
  return raw.replace(/\/+/g, '/');
}

jest.mock('expo-file-system', () => {
  class MockDirectory {
    uri: string;
    constructor(...parts: (string | MockDirectory)[]) {
      this.uri = mockNormalizeUri(...parts);
    }
    create = jest.fn();
    get exists(): boolean {
      return true;
    }
    list = jest.fn(() => {
      const prefix = this.uri.endsWith('/') ? this.uri : `${this.uri}/`;
      const result: MockFile[] = [];
      for (const uri of mockFiles.keys()) {
        if (uri.startsWith(prefix) && mockFiles.get(uri)) {
          const rest = uri.slice(prefix.length);
          if (!rest.includes('/')) {
            result.push(new MockFile(uri));
          }
        }
      }
      return result;
    });
  }

  class MockFile {
    uri: string;
    constructor(...parts: (string | MockDirectory | MockFile)[]) {
      this.uri = mockNormalizeUri(...parts);
    }
    get name(): string {
      const parts = this.uri.split('/');
      return parts[parts.length - 1];
    }
    get exists(): boolean {
      return mockFiles.get(this.uri) ?? false;
    }
    delete = jest.fn(() => {
      mockFiles.delete(this.uri);
    });
    move = jest.fn((dest: MockFile) => {
      mockFiles.delete(this.uri);
      mockFiles.set(dest.uri, true);
      this.uri = dest.uri;
      return Promise.resolve();
    });
    info = jest.fn(() => ({
      exists: this.exists,
      isDirectory: false,
      modificationTime: 1700000000000,
      size: 1000,
      uri: this.uri,
    }));
  }

  return {
    Paths: {
      document: new MockDirectory('file:///mock-document'),
    },
    Directory: MockDirectory,
    File: MockFile,
  };
});

describe('pending upload queue', () => {
  beforeEach(() => {
    mockFiles.clear();
    jest.mocked(AsyncStorage.getItem).mockReset();
    jest.mocked(AsyncStorage.setItem).mockReset();
    jest.mocked(randomUUID).mockReset();
  });

  test('enqueue moves file out of cache and indexes it', async () => {
    jest.mocked(randomUUID).mockReturnValue('uuid-1234');
    mockFiles.set('file:///cache/recording.m4a', true);
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);

    const result = await enqueue('file:///cache/recording.m4a', 'note', 4500);

    expect(result).toEqual({
      clientUploadId: 'uuid-1234',
      kind: 'note',
      path: 'file:///mock-document/pending/uuid-1234.note.m4a',
      createdAt: expect.any(String),
      durationMs: 4500,
    });
    expect(mockFiles.get('file:///cache/recording.m4a')).toBeUndefined();
    expect(
      mockFiles.get('file:///mock-document/pending/uuid-1234.note.m4a'),
    ).toBe(true);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'pending_uploads',
      JSON.stringify([result]),
    );
  });

  test('listPending drops entries with missing files', async () => {
    const existingItem: PendingUpload = {
      clientUploadId: 'uuid-1',
      kind: 'meeting',
      path: 'file:///mock-document/pending/uuid-1.meeting.m4a',
      createdAt: new Date().toISOString(),
      durationMs: 10000,
    };
    const missingItem: PendingUpload = {
      clientUploadId: 'uuid-2',
      kind: 'note',
      path: 'file:///mock-document/pending/uuid-2.note.m4a',
      createdAt: new Date().toISOString(),
      durationMs: 5000,
    };

    mockFiles.set(existingItem.path, true);
    jest
      .mocked(AsyncStorage.getItem)
      .mockResolvedValue(JSON.stringify([existingItem, missingItem]));

    const list = await listPending();

    expect(list).toEqual([existingItem]);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'pending_uploads',
      JSON.stringify([existingItem]),
    );
  });

  test('removePending deletes file and drops entry from index', async () => {
    const item1: PendingUpload = {
      clientUploadId: 'uuid-1',
      kind: 'meeting',
      path: 'file:///mock-document/pending/uuid-1.meeting.m4a',
      createdAt: new Date().toISOString(),
      durationMs: 10000,
    };
    const item2: PendingUpload = {
      clientUploadId: 'uuid-2',
      kind: 'note',
      path: 'file:///mock-document/pending/uuid-2.note.m4a',
      createdAt: new Date().toISOString(),
      durationMs: 5000,
    };

    mockFiles.set(item1.path, true);
    mockFiles.set(item2.path, true);
    jest
      .mocked(AsyncStorage.getItem)
      .mockResolvedValue(JSON.stringify([item1, item2]));

    await removePending('uuid-1');

    expect(mockFiles.get(item1.path)).toBeUndefined();
    expect(mockFiles.get(item2.path)).toBe(true);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'pending_uploads',
      JSON.stringify([item2]),
    );
  });

  test('two enqueue calls started together both end up in the index', async () => {
    let callCount = 0;
    jest.mocked(randomUUID).mockImplementation(() => {
      callCount++;
      return `uuid-${callCount}`;
    });
    mockFiles.set('file:///cache/rec1.m4a', true);
    mockFiles.set('file:///cache/rec2.m4a', true);
    let storedValue: string | null = null;
    jest
      .mocked(AsyncStorage.getItem)
      .mockImplementation(async () => storedValue);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (_key, val) => {
      storedValue = val;
    });

    const [item1, item2] = await Promise.all([
      enqueue('file:///cache/rec1.m4a', 'note', 1000),
      enqueue('file:///cache/rec2.m4a', 'meeting', 2000),
    ]);

    expect(item1.clientUploadId).toBe('uuid-1');
    expect(item2.clientUploadId).toBe('uuid-2');
    expect(mockFiles.get('file:///mock-document/pending/uuid-1.note.m4a')).toBe(
      true,
    );
    expect(
      mockFiles.get('file:///mock-document/pending/uuid-2.meeting.m4a'),
    ).toBe(true);
    expect(JSON.parse(storedValue!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ clientUploadId: 'uuid-1' }),
        expect.objectContaining({ clientUploadId: 'uuid-2' }),
      ]),
    );
  });

  test('a failed index read followed by enqueue keeps the other pending files listed', async () => {
    jest.mocked(randomUUID).mockReturnValue('uuid-new');
    mockFiles.set(
      'file:///mock-document/pending/uuid-existing.meeting.m4a',
      true,
    );
    mockFiles.set('file:///cache/rec-new.m4a', true);
    jest
      .mocked(AsyncStorage.getItem)
      .mockRejectedValue(new Error('Corrupt storage'));
    let storedValue: string | null = null;
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (_key, val) => {
      storedValue = val;
    });

    const item = await enqueue('file:///cache/rec-new.m4a', 'note', 3000);
    expect(item.clientUploadId).toBe('uuid-new');

    jest
      .mocked(AsyncStorage.getItem)
      .mockImplementation(async () => storedValue);
    const list = await listPending();
    expect(list.map((i) => i.clientUploadId)).toEqual(
      expect.arrayContaining(['uuid-existing', 'uuid-new']),
    );
  });

  test('a file in pending/ with no index entry is listed with its kind and null durationMs', async () => {
    mockFiles.set(
      'file:///mock-document/pending/uuid-unindexed.note.m4a',
      true,
    );
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify([]));

    const list = await listPending();
    expect(list).toEqual([
      expect.objectContaining({
        clientUploadId: 'uuid-unindexed',
        kind: 'note',
        path: 'file:///mock-document/pending/uuid-unindexed.note.m4a',
        durationMs: null,
      }),
    ]);
  });

  test('legacy file without kind takes kind from index and is renamed', async () => {
    const legacyItem = {
      clientUploadId: 'legacy-1',
      kind: 'meeting' as const,
      path: 'file:///mock-document/pending/legacy-1.m4a',
      createdAt: new Date().toISOString(),
      durationMs: 4000,
    };
    mockFiles.set('file:///mock-document/pending/legacy-1.m4a', true);
    jest
      .mocked(AsyncStorage.getItem)
      .mockResolvedValue(JSON.stringify([legacyItem]));

    const list = await listPending();
    expect(list).toEqual([
      expect.objectContaining({
        clientUploadId: 'legacy-1',
        kind: 'meeting',
        path: 'file:///mock-document/pending/legacy-1.meeting.m4a',
      }),
    ]);
    expect(
      mockFiles.get('file:///mock-document/pending/legacy-1.meeting.m4a'),
    ).toBe(true);
    expect(
      mockFiles.get('file:///mock-document/pending/legacy-1.m4a'),
    ).toBeUndefined();
  });

  test('legacy file without kind and no index entry is skipped', async () => {
    mockFiles.set('file:///mock-document/pending/legacy-unindexed.m4a', true);
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify([]));

    const list = await listPending();
    expect(list).toEqual([]);
  });
});
