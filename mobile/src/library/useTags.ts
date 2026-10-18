import { useQuery } from '@tanstack/react-query';

import { apiFetch, type Schemas } from '../api/client';

export function useTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: () => apiFetch<Schemas['TagOut'][]>('tags'),
  });
}
