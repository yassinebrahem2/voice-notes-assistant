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
  }

  class MockFile {
    uri: string;
    constructor(...parts: (string | MockDirectory | MockFile)[]) {
      this.uri = mockNormalizeUri(...parts);
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
      path: 'file:///mock-document/pending/uuid-1234.m4a',
      createdAt: expect.any(String),
      durationMs: 4500,
    });
    expect(mockFiles.get('file:///cache/recording.m4a')).toBeUndefined();
    expect(mockFiles.get('file:///mock-document/pending/uuid-1234.m4a')).toBe(
      true,
    );
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'pending_uploads',
      JSON.stringify([result]),
    );
  });

  test('listPending drops entries with missing files', async () => {
    const existingItem: PendingUpload = {
      clientUploadId: 'uuid-1',
      kind: 'meeting',
      path: 'file:///mock-document/pending/uuid-1.m4a',
      createdAt: new Date().toISOString(),
      durationMs: 10000,
    };
    const missingItem: PendingUpload = {
      clientUploadId: 'uuid-2',
      kind: 'note',
      path: 'file:///mock-document/pending/uuid-2.m4a',
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
      path: 'file:///mock-document/pending/uuid-1.m4a',
      createdAt: new Date().toISOString(),
      durationMs: 10000,
    };
    const item2: PendingUpload = {
      clientUploadId: 'uuid-2',
      kind: 'note',
      path: 'file:///mock-document/pending/uuid-2.m4a',
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
});
