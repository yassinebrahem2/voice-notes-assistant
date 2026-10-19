import React from 'react';
import { Text } from 'react-native-paper';

import type { Schemas } from '../api/client';
import { CitationLink } from './CitationLink';
import { splitAnswer } from './citations';

export function AnswerText({ message }: { message: Schemas['MessageOut'] }) {
  if (message.reply_type !== 'answer') {
    return <Text variant="bodyMedium">{message.text}</Text>;
  }

  const parts = splitAnswer(message.text, message.citations);

  return (
    <Text variant="bodyMedium">
      {parts.map((part, i) => {
        if ('citation' in part) {
          const prevPart = parts[i - 1];
          const hasPrevCitation = prevPart && 'citation' in prevPart;
          return (
            <React.Fragment key={i}>
              {hasPrevCitation ? ' · ' : null}
              <CitationLink citation={part.citation} />
            </React.Fragment>
          );
        }
        return part.text;
      })}
    </Text>
  );
}
