import { ApiError, parseApiError, type Schemas } from '../api/errors';
import { getServerUrl } from '../settings/serverUrl';
import type { RecordingKind } from './fanOut';
import { enqueue, removePending, type PendingUpload } from './pending';

export async function uploadPending(
  item: PendingUpload,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Schemas['RecordingOut']> {
  let serverUrl: string | null;
  try {
    serverUrl = await getServerUrl();
  } catch {
    throw new ApiError(
      0,
      'network_error',
      'Could not load the server URL. Check Settings.',
    );
  }

  if (!serverUrl) {
    throw new ApiError(0, 'network_error', 'Set a server URL in Settings.');
  }

  const endpoint = `${serverUrl}/api/v1/recordings`;

  const formData = new FormData();
  formData.append('client_upload_id', item.clientUploadId);
  formData.append('kind', item.kind);
  formData.append('file', {
    uri: item.path,
    name: `${item.clientUploadId}.m4a`,
    type: 'audio/mp4',
  } as unknown as Blob);

  return new Promise<Schemas['RecordingOut']>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint);

    if (signal) {
      if (signal.aborted) {
        reject(new ApiError(0, 'timeout', 'Upload aborted'));
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(event.loaded / event.total);
        }
      };
    }

    xhr.onload = async () => {
      if (xhr.status === 200 || xhr.status === 201) {
        try {
          await removePending(item.clientUploadId);
        } catch (error) {
          console.warn('Failed to remove pending upload after success', error);
        }

        try {
          const body = JSON.parse(xhr.responseText) as Schemas['RecordingOut'];
          resolve(body);
        } catch {
          reject(
            new ApiError(
              xhr.status,
              'internal_error',
              'The server returned an invalid response.',
            ),
          );
        }
      } else {
        let body: unknown;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          body = null;
        }
        reject(parseApiError(xhr.status, body));
      }
    };

    xhr.onerror = () => {
      reject(new ApiError(0, 'network_error', 'Network error during upload'));
    };

    xhr.ontimeout = () => {
      reject(new ApiError(0, 'timeout', 'Upload timed out'));
    };

    xhr.onabort = () => {
      reject(new ApiError(0, 'timeout', 'Upload aborted'));
    };

    xhr.send(formData);
  });
}

export async function enqueueAndUpload(
  uri: string,
  kind: RecordingKind,
  durationMs: number,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Schemas['RecordingOut']> {
  const pending = await enqueue(uri, kind, durationMs);
  return await uploadPending(pending, onProgress, signal);
}
