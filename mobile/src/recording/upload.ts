import {
  ApiError,
  isApiErrorEnvelope,
  isGatewayStatus,
  parseApiError,
  type Schemas,
} from '../api/errors';
import { queryClient } from '../api/queryClient';
import { reportNetworkError, reportOk } from '../server/statusStore';
import { getServerUrl } from '../settings/serverUrl';
import { removePending, type PendingUpload } from './pending';

export async function uploadPending(
  item: PendingUpload,
  onProgress?: (fraction: number) => void,
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

    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(event.loaded / event.total);
        }
      };
    }

    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        reportOk();
        try {
          await removePending(item.clientUploadId);
        } catch (error) {
          console.warn('Failed to remove pending upload after success', error);
        }

        try {
          const body = JSON.parse(xhr.responseText) as Schemas['RecordingOut'];
          void queryClient.invalidateQueries({ queryKey: ['recordings'] });
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

        if (isGatewayStatus(xhr.status) && !isApiErrorEnvelope(body)) {
          reportNetworkError();
          reject(
            new ApiError(0, 'network_error', 'Could not reach the server.'),
          );
          return;
        }

        reportOk();
        reject(parseApiError(xhr.status, body));
      }
    };

    xhr.onerror = () => {
      reportNetworkError();
      reject(new ApiError(0, 'network_error', 'Network error during upload'));
    };

    xhr.ontimeout = () => {
      reportNetworkError();
      reject(new ApiError(0, 'timeout', 'Upload timed out'));
    };

    xhr.send(formData);
  });
}
