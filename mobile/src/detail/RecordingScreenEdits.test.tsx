import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { PaperProvider } from 'react-native-paper';
import { useReducedMotion } from 'react-native-reanimated';

import { RecordingScreen } from '../../app/recording/[id]';
import type { Schemas } from '../api/client';
import { paperTheme } from '../theme/paperTheme';
import {
  useDeleteRecording,
  useRenameSpeaker,
  useRetryRecording,
  useUpdateRecording,
} from './mutations';
import { useRecording } from './useRecording';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: {
    Light: 'light',
    Medium: 'medium',
    Heavy: 'heavy',
  },
}));

jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  isLoaded: () => true,
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  ...jest.requireActual('react-native-reanimated'),
  useReducedMotion: jest.fn(() => false),
}));

jest.mock('./useRecording', () => ({
  useRecording: jest.fn(),
}));

jest.mock('./mutations', () => ({
  useRetryRecording: jest.fn(),
  useUpdateRecording: jest.fn(),
  useRenameSpeaker: jest.fn(),
  useDeleteRecording: jest.fn(),
  normalizeTag: jest.requireActual('./mutations').normalizeTag,
}));

const mockUseRecording = jest.mocked(useRecording);
const mockUseRetryRecording = jest.mocked(useRetryRecording);
const mockUseUpdateRecording = jest.mocked(useUpdateRecording);
const mockUseRenameSpeaker = jest.mocked(useRenameSpeaker);
const mockUseDeleteRecording = jest.mocked(useDeleteRecording);
const mockUseLocalSearchParams = jest.mocked(useLocalSearchParams);
const mockUseReducedMotion = jest.mocked(useReducedMotion);

function makeRecording(
  overrides: Partial<Schemas['RecordingDetailOut']> = {},
): Schemas['RecordingDetailOut'] {
  return {
    id: 'rec_1',
    kind: 'note',
    status: 'ready',
    title: 'Note Title',
    processing: false,
    segments: [],
    speakers: [],
    tags: [],
    created_at: '2026-10-17T12:00:00Z',
    duration_ms: 1000,
    error_code: null,
    error_message: null,
    failed_step: null,
    summary: null,
    note: { key_points: [], clean_text: 'Text' },
    waveform_peaks: null,
    ...overrides,
  };
}

async function renderScreen(id = 'rec_1', segment?: string) {
  mockUseLocalSearchParams.mockReturnValue({ id, segment });
  return await render(
    <PaperProvider theme={paperTheme('dark')}>
      <RecordingScreen id={id} segment={segment} />
    </PaperProvider>,
  );
}

describe('RecordingScreen edits', () => {
  const mockRetry = jest.fn();
  const mockUpdate = jest.fn();
  const mockRename = jest.fn();
  const mockDelete = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRetryRecording.mockReturnValue({
      mutate: mockRetry,
      isPending: false,
    } as unknown as ReturnType<typeof useRetryRecording>);
    mockUseUpdateRecording.mockReturnValue({
      mutate: mockUpdate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateRecording>);
    mockUseRenameSpeaker.mockReturnValue({
      mutate: mockRename,
      isPending: false,
    } as unknown as ReturnType<typeof useRenameSpeaker>);
    mockUseDeleteRecording.mockReturnValue({
      mutate: mockDelete,
      isPending: false,
    } as unknown as ReturnType<typeof useDeleteRecording>);
    mockUseReducedMotion.mockReturnValue(true);
  });

  test('Delete is disabled while recording is processing', async () => {
    mockUseRecording.mockReturnValue({
      data: makeRecording({
        id: 'rec_proc',
        kind: 'meeting',
        status: 'transcribing',
        title: 'Processing Meeting',
        processing: true,
        note: null,
      }),
      isLoading: false,
      isError: false,
      error: null,
      deleted: false,
      refetch: jest.fn(),
    });

    await renderScreen('rec_proc');
    const menuButton = screen.getByLabelText('More options');
    await fireEvent.press(menuButton);

    const deleteItem = await screen.findByLabelText(
      'Delete recording (Available when processing finishes)',
    );
    expect(deleteItem.props.accessibilityState?.disabled).toBe(true);

    await fireEvent.press(deleteItem);
    expect(screen.queryByText('Delete recording?')).toBeNull();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  test('confirm delete triggers deletion with medium haptic', async () => {
    mockUseRecording.mockReturnValue({
      data: makeRecording({
        id: 'rec_to_delete',
        title: 'Note to Delete',
        segments: [
          {
            id: 'seg_1',
            idx: 0,
            speaker_id: null,
            start_ms: 0,
            end_ms: 1000,
            text: 'Test',
          },
        ],
      }),
      isLoading: false,
      isError: false,
      error: null,
      deleted: false,
      refetch: jest.fn(),
    });

    await renderScreen('rec_to_delete');
    const menuButton = screen.getByLabelText('More options');
    await fireEvent.press(menuButton);

    const deleteItem = await screen.findByLabelText('Delete recording');
    await fireEvent.press(deleteItem);

    await waitFor(() => {
      expect(screen.getByText('Delete recording?')).toBeTruthy();
      expect(screen.getByText('This cannot be undone.')).toBeTruthy();
    });

    const confirmButton = screen.getByLabelText('Confirm delete');
    await fireEvent.press(confirmButton);

    expect(Haptics.impactAsync).toHaveBeenCalledWith(
      Haptics.ImpactFeedbackStyle.Medium,
    );
    expect(mockDelete).toHaveBeenCalledWith('rec_to_delete');
    await waitFor(() => {
      expect(screen.queryByText('Delete recording?')).toBeNull();
    });
  });

  test('title edit triggers update mutation', async () => {
    mockUseRecording.mockReturnValue({
      data: makeRecording({
        id: 'rec_title_edit',
        title: 'Old Title',
        segments: [
          {
            id: 'seg_1',
            idx: 0,
            speaker_id: null,
            start_ms: 0,
            end_ms: 1000,
            text: 'Note',
          },
        ],
      }),
      isLoading: false,
      isError: false,
      error: null,
      deleted: false,
      refetch: jest.fn(),
    });

    await renderScreen('rec_title_edit');
    const editTitleBtn = screen.getByLabelText('Edit title');
    await fireEvent.press(editTitleBtn);

    const titleInput = await screen.findByLabelText('Recording title input');
    expect(titleInput).toBeTruthy();
    await fireEvent.changeText(titleInput, 'New Title');

    const saveTitleBtn = screen.getByLabelText('Save title');
    await fireEvent.press(saveTitleBtn);

    expect(mockUpdate).toHaveBeenCalledWith({ title: 'New Title' });
    await waitFor(() => {
      expect(screen.queryByLabelText('Recording title input')).toBeNull();
    });
  });

  test('speaker rename dialog opens on tap and triggers rename with light haptic', async () => {
    mockUseRecording.mockReturnValue({
      data: makeRecording({
        id: 'rec_spk',
        kind: 'meeting',
        title: 'Meeting with Speakers',
        duration_ms: 5000,
        summary: {
          overview: 'Team discussion.',
          decisions: [],
          action_items: [],
          open_questions: [],
        },
        note: null,
        speakers: [
          {
            id: 'spk_1',
            name: 'Sarah',
            display_name: 'Sarah',
            label: '1',
          },
        ],
        segments: [
          {
            id: 'seg_1',
            idx: 0,
            speaker_id: 'spk_1',
            start_ms: 0,
            end_ms: 5000,
            text: 'Hello team.',
          },
        ],
      }),
      isLoading: false,
      isError: false,
      error: null,
      deleted: false,
      refetch: jest.fn(),
    });

    await renderScreen('rec_spk');
    const transcriptTab = screen.getByLabelText('Transcript');
    await fireEvent.press(transcriptTab);

    const renameChips = screen.getAllByLabelText('Rename speaker Sarah');
    await fireEvent.press(renameChips[0]);

    await waitFor(() => {
      expect(screen.getByText('Rename speaker')).toBeTruthy();
    });
    const input = screen.getByLabelText('Speaker name input');
    await fireEvent.changeText(input, 'Sarah Connor');
    const saveSpeakerBtn = screen.getByLabelText('Save speaker name');
    await fireEvent.press(saveSpeakerBtn);

    expect(Haptics.impactAsync).toHaveBeenCalledWith(
      Haptics.ImpactFeedbackStyle.Light,
    );
    expect(mockRename).toHaveBeenCalledWith({
      speakerId: 'spk_1',
      name: 'Sarah Connor',
    });
    await waitFor(() => {
      expect(screen.queryByText('Rename speaker')).toBeNull();
    });
  });

  test('tag removal triggers update mutation', async () => {
    mockUseRecording.mockReturnValue({
      data: makeRecording({
        id: 'rec_tag_rm',
        title: 'Tagged Note',
        tags: [
          { id: 'tag_1', name: 'Work', count: 1 },
          { id: 'tag_2', name: 'Personal', count: 1 },
        ],
      }),
      isLoading: false,
      isError: false,
      error: null,
      deleted: false,
      refetch: jest.fn(),
    });

    await renderScreen('rec_tag_rm');
    const removeWorkBtn = screen.getByLabelText('Remove tag Work');
    await fireEvent.press(removeWorkBtn);

    expect(mockUpdate).toHaveBeenCalledWith({ tags: ['Personal'] });
  });

  test('tag addition triggers update mutation', async () => {
    mockUseRecording.mockReturnValue({
      data: makeRecording({
        id: 'rec_tag_add',
        title: 'Tagged Note',
        tags: [{ id: 'tag_1', name: 'Work', count: 1 }],
      }),
      isLoading: false,
      isError: false,
      error: null,
      deleted: false,
      refetch: jest.fn(),
    });

    await renderScreen('rec_tag_add');
    const addTagBtn = screen.getByLabelText('Add tag');
    await fireEvent.press(addTagBtn);

    const tagInput = await screen.findByLabelText('New tag input');
    await fireEvent.changeText(tagInput, 'Project');

    const saveTagBtn = screen.getByLabelText('Save tag');
    await fireEvent.press(saveTagBtn);

    expect(mockUpdate).toHaveBeenCalledWith({ tags: ['Work', 'Project'] });
  });

  test('adding duplicate normalized tag "Work Notes" to recording tagged "work-notes" sends no request', async () => {
    mockUseRecording.mockReturnValue({
      data: makeRecording({
        id: 'rec_tag_dup',
        title: 'Tagged Note',
        tags: [{ id: 'tag_1', name: 'work-notes', count: 1 }],
      }),
      isLoading: false,
      isError: false,
      error: null,
      deleted: false,
      refetch: jest.fn(),
    });

    await renderScreen('rec_tag_dup');
    const addTagBtn = screen.getByLabelText('Add tag');
    await fireEvent.press(addTagBtn);

    const tagInput = await screen.findByLabelText('New tag input');
    await fireEvent.changeText(tagInput, 'Work Notes');

    const saveTagBtn = screen.getByLabelText('Save tag');
    await fireEvent.press(saveTagBtn);

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
