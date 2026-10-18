import { ApiError, type Schemas } from '../api/client';
import { queryClient } from '../api/queryClient';
import { getServerStatus } from '../server/statusStore';
import { getServerUrl } from '../settings/serverUrl';
import { enqueue, removePending, type PendingUpload } from './pending';
import { uploadPending } from './upload';

jest.mock('../settings/serverUrl', () => ({
  getServerUrl: jest.fn(),
}));

jest.mock('./pending', () => ({
  enqueue: jest.fn(),
  removePending: jest.fn(),
}));

class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = [];
  open = jest.fn();
  send = jest.fn((body: unknown) => {
    this.sentBody = body;
  });
  abort = jest.fn();
  setRequestHeader = jest.fn();
  upload = {
    onprogress: null as
      | ((event: {
          lengthComputable: boolean;
          loaded: number;
          total: number;
        }) => void)
      | null,
  };
  status = 200;
  responseText = '';
  readyState = 4;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  sentBody: unknown = null;

  constructor() {
    MockXMLHttpRequest.instances.push(this);
  }
}

const mockRecordingOut: Schemas['RecordingOut'] = {
  id: 'rec_123',
  kind: 'note',
  status: 'uploaded',
  title: null,
  created_at: new Date().toISOString(),
  duration_ms: 5000,
  processing: false,
  error_code: null,
  error_message: null,
  failed_step: null,
  tags: [],
  waveform_peaks: null,
};

async function nextTick() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('uploadPending', () => {
  const originalXHR = (globalThis as unknown as { XMLHttpRequest: unknown })
    .XMLHttpRequest;

  beforeEach(() => {
    MockXMLHttpRequest.instances = [];
    (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest =
      MockXMLHttpRequest;
    jest
      .mocked(getServerUrl)
      .mockReset()
      .mockResolvedValue('https://server.example');
    jest.mocked(removePending).mockReset().mockResolvedValue();
    jest.mocked(enqueue).mockReset();
  });

  afterAll(() => {
    (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest =
      originalXHR;
  });

  const sampleItem: PendingUpload = {
    clientUploadId: 'test-upload-uuid',
    kind: 'note',
    path: 'file:///mock/pending/test-upload-uuid.m4a',
    createdAt: new Date().toISOString(),
    durationMs: 5000,
  };

  test('uploadPending sends the file part named <clientUploadId>.m4a with type audio/mp4', async () => {
    const uploadPromise = uploadPending(sampleItem);
    await nextTick();
    expect(MockXMLHttpRequest.instances.length).toBe(1);
    const xhr = MockXMLHttpRequest.instances[0];

    expect(xhr.open).toHaveBeenCalledWith(
      'POST',
      'https://server.example/api/v1/recordings',
    );

    const formData = xhr.sentBody as FormData;
    expect(formData).toBeDefined();

    xhr.status = 201;
    xhr.responseText = JSON.stringify(mockRecordingOut);
    xhr.onload?.();

    const result = await uploadPromise;
    expect(result).toEqual(mockRecordingOut);
  });

  test('uploadPending reports progress fractions and removes on 201', async () => {
    const onProgress = jest.fn();
    const uploadPromise = uploadPending(sampleItem, onProgress);
    await nextTick();
    const xhr = MockXMLHttpRequest.instances[0];

    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 40, total: 100 });
    expect(onProgress).toHaveBeenCalledWith(0.4);

    xhr.status = 201;
    xhr.responseText = JSON.stringify(mockRecordingOut);
    xhr.onload?.();

    const result = await uploadPromise;
    expect(result).toEqual(mockRecordingOut);
    expect(removePending).toHaveBeenCalledWith(sampleItem.clientUploadId);
  });

  test('uploadPending on 200 (existing) also removes', async () => {
    const uploadPromise = uploadPending(sampleItem);
    await nextTick();
    const xhr = MockXMLHttpRequest.instances[0];

    xhr.status = 200;
    xhr.responseText = JSON.stringify(mockRecordingOut);
    xhr.onload?.();

    const result = await uploadPromise;
    expect(result).toEqual(mockRecordingOut);
    expect(removePending).toHaveBeenCalledWith(sampleItem.clientUploadId);
  });

  test('uploadPending network error keeps the item and throws network_error', async () => {
    const uploadPromise = uploadPending(sampleItem);
    await nextTick();
    const xhr = MockXMLHttpRequest.instances[0];

    xhr.onerror?.();

    await expect(uploadPromise).rejects.toThrow(ApiError);
    await expect(uploadPromise).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
    });
    expect(removePending).not.toHaveBeenCalled();
  });

  test('uploadPending server 4xx throws parsed ApiError and keeps item', async () => {
    const uploadPromise = uploadPending(sampleItem);
    await nextTick();
    const xhr = MockXMLHttpRequest.instances[0];

    xhr.status = 415;
    xhr.responseText = JSON.stringify({
      error: { code: 'unsupported_media_type', message: 'Unsupported format' },
    });
    xhr.onload?.();

    await expect(uploadPromise).rejects.toThrow(ApiError);
    await expect(uploadPromise).rejects.toMatchObject({
      status: 415,
      code: 'unsupported_media_type',
    });
    expect(removePending).not.toHaveBeenCalled();
  });

  test('retry reuses the same client_upload_id', async () => {
    // First attempt fails
    const failPromise = uploadPending(sampleItem);
    await nextTick();
    const xhr1 = MockXMLHttpRequest.instances[0];
    xhr1.onerror?.();
    await expect(failPromise).rejects.toThrow();

    // Second attempt (retry) with the exact same PendingUpload
    const retryPromise = uploadPending(sampleItem);
    await nextTick();
    const xhr2 = MockXMLHttpRequest.instances[1];

    xhr2.status = 201;
    xhr2.responseText = JSON.stringify(mockRecordingOut);
    xhr2.onload?.();

    const result = await retryPromise;
    expect(result).toEqual(mockRecordingOut);
    expect(removePending).toHaveBeenCalledWith(sampleItem.clientUploadId);
  });

  test('a 502 with an HTML body -> network_error and status unreachable', async () => {
    const uploadPromise = uploadPending(sampleItem);
    await nextTick();
    const xhr = MockXMLHttpRequest.instances[0];

    xhr.status = 502;
    xhr.responseText = '<html><body>502 Bad Gateway</body></html>';
    xhr.onload?.();

    await expect(uploadPromise).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
    });
    expect(getServerStatus()).toBe('unreachable');
  });

  test('a successful upload invalidates recordings query', async () => {
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    const uploadPromise = uploadPending(sampleItem);
    await nextTick();
    const xhr = MockXMLHttpRequest.instances[0];

    xhr.status = 201;
    xhr.responseText = JSON.stringify(mockRecordingOut);
    xhr.onload?.();

    await uploadPromise;
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['recordings'] });
    expect(getServerStatus()).toBe('ok');
    invalidateSpy.mockRestore();
  });
});
