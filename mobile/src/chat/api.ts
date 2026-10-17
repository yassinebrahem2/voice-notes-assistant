import { apiFetch, type Schemas } from '../api/client';

const json = { 'Content-Type': 'application/json' };

export function createChat(): Promise<Schemas['ChatOut']> {
  return apiFetch<Schemas['ChatOut']>('chats', { method: 'POST' });
}

export function ask(
  chatId: string,
  body: Schemas['AskIn'],
): Promise<Schemas['RunAcceptedOut']> {
  return apiFetch<Schemas['RunAcceptedOut']>(`chats/${chatId}/messages`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify(body),
  });
}

export function getRun(
  chatId: string,
  runId: string,
): Promise<Schemas['RunOut']> {
  return apiFetch<Schemas['RunOut']>(`chats/${chatId}/runs/${runId}`);
}

export function retryRun(
  chatId: string,
  runId: string,
): Promise<Schemas['RunAcceptedOut']> {
  return apiFetch<Schemas['RunAcceptedOut']>(
    `chats/${chatId}/runs/${runId}/retry`,
    { method: 'POST' },
  );
}
