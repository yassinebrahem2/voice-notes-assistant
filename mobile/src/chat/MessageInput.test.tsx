import { fireEvent, render, screen } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import { paperTheme } from '../theme/paperTheme';
import {
  INPUT_LINE_HEIGHT,
  INPUT_MAX_HEIGHT,
  INPUT_MIN_HEIGHT,
  INPUT_PADDING_V,
  inputHeight,
  MessageInput,
  type MessageInputProps,
} from './MessageInput';

jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  isLoaded: () => true,
}));

describe('inputHeight', () => {
  test('clamps contentHeight between min (48) and max (144) dp, ceiling fractional values', () => {
    expect(inputHeight(10)).toBe(48);
    expect(inputHeight(48)).toBe(48);
    expect(inputHeight(72)).toBe(72);
    expect(inputHeight(96.4)).toBe(97);
    expect(inputHeight(500)).toBe(144);
  });
});

describe('MessageInput', () => {
  const defaultProps: MessageInputProps = {
    value: 'Hello',
    onChangeText: jest.fn(),
    onSend: jest.fn(),
    canSend: true,
  };

  async function renderInput(props: Partial<MessageInputProps> = {}) {
    return await render(
      <PaperProvider theme={paperTheme('light')}>
        <MessageInput {...defaultProps} {...props} />
      </PaperProvider>,
    );
  }

  test('has vertically centred text, matching line height and vertical padding constants', async () => {
    await renderInput();
    const input = screen.getByLabelText('Message');
    expect(input).toHaveStyle({
      textAlignVertical: 'center',
      lineHeight: INPUT_LINE_HEIGHT,
      paddingVertical: INPUT_PADDING_V,
    });
    expect(INPUT_LINE_HEIGHT).toBe(24);
    expect(INPUT_PADDING_V).toBe(12);
    expect(INPUT_MIN_HEIGHT).toBe(48);
    expect(INPUT_MAX_HEIGHT).toBe(144);
  });

  test('grows height on contentSizeChange up to max height (144)', async () => {
    await renderInput();
    const input = screen.getByLabelText('Message');
    expect(input).toHaveStyle({ height: 48 });

    await fireEvent(input, 'contentSizeChange', {
      nativeEvent: { contentSize: { width: 200, height: 96 } },
    });
    expect(input).toHaveStyle({ height: 96 });

    await fireEvent(input, 'contentSizeChange', {
      nativeEvent: { contentSize: { width: 200, height: 500 } },
    });
    expect(input).toHaveStyle({ height: 144 });
  });

  test('resets height to min (48) when value is cleared', async () => {
    const { rerender } = await renderInput({ value: 'Growing line' });
    const input = screen.getByLabelText('Message');

    await fireEvent(input, 'contentSizeChange', {
      nativeEvent: { contentSize: { width: 200, height: 96 } },
    });
    expect(input).toHaveStyle({ height: 96 });

    await rerender(
      <PaperProvider theme={paperTheme('light')}>
        <MessageInput {...defaultProps} value="" />
      </PaperProvider>,
    );
    expect(input).toHaveStyle({ height: 48 });
  });

  test('disables send button when canSend is false and enables when true', async () => {
    const onSend = jest.fn();
    const { rerender } = await renderInput({ canSend: false, onSend });
    const sendButton = screen.getByRole('button', { name: 'Send' });

    expect(sendButton.props.accessibilityState).toEqual({ disabled: true });
    await fireEvent.press(sendButton);
    expect(onSend).not.toHaveBeenCalled();

    await rerender(
      <PaperProvider theme={paperTheme('light')}>
        <MessageInput {...defaultProps} canSend={true} onSend={onSend} />
      </PaperProvider>,
    );
    expect(
      screen.getByRole('button', { name: 'Send' }).props.accessibilityState,
    ).toEqual({
      disabled: false,
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
