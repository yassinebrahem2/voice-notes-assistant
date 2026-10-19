import type React from 'react';

import type { Schemas } from '../api/client';
import { Markdown } from './Markdown';

export function AnswerText({
  message,
}: {
  message: Schemas['MessageOut'];
}): React.JSX.Element {
  if (message.reply_type !== 'answer') {
    return <Markdown text={message.text} citations={[]} />;
  }

  return <Markdown text={message.text} citations={message.citations} />;
}
