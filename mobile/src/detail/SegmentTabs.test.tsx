import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { PaperProvider } from 'react-native-paper';

import { paperTheme } from '../theme/paperTheme';
import { SegmentTabs } from './SegmentTabs';

jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  isLoaded: () => true,
}));

describe('SegmentTabs', () => {
  test('renders primary and transcript tabs and handles selection', async () => {
    const onSelectTab = jest.fn();

    await render(
      <PaperProvider theme={paperTheme('dark')}>
        <SegmentTabs
          primaryLabel="Summary"
          activeTab="primary"
          onSelectTab={onSelectTab}
        />
      </PaperProvider>,
    );

    const transcriptTab = screen.getByLabelText('Transcript');
    fireEvent.press(transcriptTab);
    expect(onSelectTab).toHaveBeenCalledWith('transcript');

    const summaryTab = screen.getByLabelText('Summary');
    fireEvent.press(summaryTab);
    expect(onSelectTab).toHaveBeenCalledWith('primary');
  });
});
