import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { PaperProvider } from 'react-native-paper';

import type { Schemas } from '../api/client';
import { fontFamilies } from '../theme/fonts';
import { paperTheme } from '../theme/paperTheme';
import { typeScale } from '../theme/tokens';
import { Markdown } from './Markdown';

jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  isLoaded: () => true,
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

const citation1: Schemas['CitationOut'] = {
  n: 1,
  recording_id: 'rec_1',
  recording_title: 'Standup',
  segment_id: 'seg_1',
  start_ms: 83000,
};

const citation2: Schemas['CitationOut'] = {
  n: 2,
  recording_id: 'rec_2',
  recording_title: 'Sync',
  segment_id: 'seg_2',
  start_ms: 125000,
};

async function renderMarkdown(
  text: string,
  citations: Schemas['CitationOut'][] = [],
) {
  return await render(
    <PaperProvider theme={paperTheme('light')}>
      <Markdown text={text} citations={citations} />
    </PaperProvider>,
  );
}

describe('Markdown', () => {
  test('**Decided** to ship [1] renders semibold text and citation link', async () => {
    await renderMarkdown('**Decided** to ship [1]', [citation1]);

    const decided = screen.getByText('Decided');
    expect(decided).toHaveStyle({ fontFamily: fontFamilies.semibold });
    expect(screen.getByText(/to ship/)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Open Standup · 01:23' }),
    ).toBeTruthy();
  });

  test('- first [1]\\n- second renders two bullet items and link in first item', async () => {
    await renderMarkdown('- first [1]\n- second', [citation1]);

    const bullets = screen.getAllByText('•');
    expect(bullets).toHaveLength(2);
    expect(screen.getByText(/first/)).toBeTruthy();
    expect(screen.getByText('second')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Open Standup · 01:23' }),
    ).toBeTruthy();
  });

  test('1. a\\n2. b renders ordered list markers', async () => {
    await renderMarkdown('1. a\n2. b');

    expect(screen.getByText('1.')).toBeTruthy();
    expect(screen.getByText('2.')).toBeTruthy();
    expect(screen.getByText('a')).toBeTruthy();
    expect(screen.getByText('b')).toBeTruthy();
  });

  test('## Plan renders heading at body size and semibold font', async () => {
    await renderMarkdown('## Plan');

    const heading = screen.getByText('Plan');
    expect(heading).toHaveStyle({
      fontSize: typeScale.body,
      fontFamily: fontFamilies.semibold,
    });
  });

  test('`x` renders inline code with mono font and small size', async () => {
    await renderMarkdown('`x`');

    const code = screen.getByText('x');
    expect(code).toHaveStyle({
      fontFamily: fontFamilies.mono,
      fontSize: typeScale.small,
    });
  });

  test('**[1][2]** renders two links joined by a separator', async () => {
    await renderMarkdown('**[1][2]**', [citation1, citation2]);

    expect(
      screen.getByRole('link', { name: 'Open Standup · 01:23' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Open Sync · 02:05' }),
    ).toBeTruthy();
    expect(screen.getByText(/01:23 · 02:05/)).toBeTruthy();
  });

  test('unclosed **bold shows literal text and does not throw', async () => {
    await expect(renderMarkdown('**bold')).resolves.not.toThrow();
    expect(screen.getByText('**bold')).toBeTruthy();
  });

  test('table and fenced code block show cell and code text without pipes or fences', async () => {
    const tableAndCode = `| Header A | Header B |
| --- | --- |
| Cell 1 | Cell 2 |

\`\`\`
const testVal = 42;
\`\`\``;

    await renderMarkdown(tableAndCode);

    expect(screen.getByText('Header A · Header B')).toBeTruthy();
    expect(screen.getByText('Cell 1 · Cell 2')).toBeTruthy();
    expect(screen.getByText('const testVal = 42;')).toBeTruthy();
    expect(screen.queryByText(/\|/)).toBeNull();
    expect(screen.queryByText(/```/)).toBeNull();
  });

  test('Q & A [1] shows Q & A literally', async () => {
    await renderMarkdown('Q & A [1]', [citation1]);

    expect(screen.getByText(/Q & A/)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Open Standup · 01:23' }),
    ).toBeTruthy();
  });

  test('backend HELP text renders intro line and 3 list items', async () => {
    const helpText = `You can ask questions about your voice notes and meetings, like:
- What was decided in our last sync?
- What are my open action items?
- Summarize my notes on architecture.`;

    await renderMarkdown(helpText);

    expect(
      screen.getByText(
        'You can ask questions about your voice notes and meetings, like:',
      ),
    ).toBeTruthy();
    const bullets = screen.getAllByText('•');
    expect(bullets).toHaveLength(3);
    expect(screen.getByText('What was decided in our last sync?')).toBeTruthy();
    expect(screen.getByText('What are my open action items?')).toBeTruthy();
    expect(
      screen.getByText('Summarize my notes on architecture.'),
    ).toBeTruthy();
  });

  test('line one\\nline two keeps the line break', async () => {
    await renderMarkdown('line one\nline two');

    expect(screen.getByText(/line one[\s\S]*line two/)).toBeTruthy();
  });
});
