import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import type { Schemas } from '../api/client';
import { listPending, removePending, type PendingUpload } from './pending';
import { uploadPending } from './upload';

export interface UsePendingUploadsResult {
  items: PendingUpload[];
  retry: (
    id: string,
    onProgress?: (fraction: number) => void,
  ) => Promise<Schemas['RecordingOut'] | undefined>;
  remove: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function usePendingUploads(): UsePendingUploadsResult {
  const [items, setItems] = useState<PendingUpload[]>([]);
  const itemsRef = useRef<PendingUpload[]>([]);

  const refresh = useCallback(async () => {
    try {
      const list = await listPending();
      itemsRef.current = list;
      setItems(list);
    } catch (error) {
      console.warn('Failed to list pending uploads', error);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void listPending().then(
        (list) => {
          if (active) {
            itemsRef.current = list;
            setItems(list);
          }
        },
        (error: unknown) => {
          console.warn('Failed to list pending uploads', error);
        },
      );
      return () => {
        active = false;
      };
    }, []),
  );

  const retry = useCallback(
    async (id: string, onProgress?: (fraction: number) => void) => {
      const target = itemsRef.current.find(
        (item) => item.clientUploadId === id,
      );
      if (!target) {
        return undefined;
      }
      try {
        const result = await uploadPending(target, onProgress);
        await refresh();
        return result;
      } catch (error) {
        await refresh();
        throw error;
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await removePending(id);
      await refresh();
    },
    [refresh],
  );

  return { items, retry, remove, refresh };
}
