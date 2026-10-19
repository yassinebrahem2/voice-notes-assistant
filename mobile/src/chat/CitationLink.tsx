import { router } from 'expo-router';
import { Text } from 'react-native';
import { useTheme } from 'react-native-paper';

import type { Schemas } from '../api/client';
import { fontFamilies } from '../theme/fonts';
import type { TapeTheme } from '../theme/paperTheme';
import { typeScale } from '../theme/tokens';
import { citationLabel, citationTime } from './citations';

export function CitationLink({
  citation,
}: {
  citation: Schemas['CitationOut'];
}): React.JSX.Element {
  const { tape } = useTheme<TapeTheme>();
  return (
    <Text
      accessibilityRole="link"
      accessibilityLabel={`Open ${citationLabel(citation)}`}
      style={{
        fontFamily: fontFamilies.mono,
        fontSize: typeScale.small,
        color: tape.signal,
      }}
      onPress={() =>
        router.push({
          pathname: '/recording/[id]',
          params: { id: citation.recording_id, segment: citation.segment_id },
        })
      }
    >
      {citationTime(citation.start_ms)}
    </Text>
  );
}
