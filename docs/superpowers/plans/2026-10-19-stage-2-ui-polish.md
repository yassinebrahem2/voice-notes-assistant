# Stage 2 UI Polish Implementation Plan

> **For agentic workers:** implement this plan task by task as described in `docs/implementing-plan-tasks.md` (fresh implementer, fresh reviewer, fix loop per task); follow `AGENTS.md`. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status:** approved. Branch `plan/stage-2-ui-polish`, plan issue #87 (tasks #88–#93). Implements the UI spec amendment in f22f9a8.

**Goal:** Slimmer, less rounded filter and speaker chips; a tighter Chat header; a chat input that stays centred and grows; message bubbles; inline citation links; Markdown in assistant replies.

**Architecture:** One shared `Chip` component replaces three hand-made chip styles. The Chat screen gets three small new files (`MessageInput`, `MessageBubble`, `CitationLink`) and a Markdown renderer built on the `marked` lexer, so citation markers can be placed inside Markdown text. No backend or API change.

**Tech Stack:** Expo SDK 58, React Native 0.88, React Native Paper 5, `marked` 18.0.14 (new, pure JS, no dependencies), jest-expo, React Native Testing Library 14. RNTL 14's `render` is async (`await render(...)`), and `toHaveStyle` works with no extra setup (both checked on `main`).

**Spec:** `docs/superpowers/specs/2026-10-16-stage-1-design-ui.md` §3 (Chat, Everywhere) and §4 (Visual direction, Shape), as amended in f22f9a8.

**Stage overview:** none; standalone stage 2 plan. **Builds on:** `main` (stage 1 merged): `ChatScreen`, `ScopeBar`, `AnswerText`, `citations.ts` (`splitAnswer`, `citationTime`, `citationLabel`), `LibraryHeader`, `TranscriptView`, theme tokens.

## Global Constraints
- Overview rules from stage 1 still hold: tokens only (no raw colours, sizes or radii in components), TypeScript strict, no `any`, ESLint and Prettier clean, must run in Expo Go (pure-JS dependencies only, added with `npx expo install`).
- Touch targets ≥ 48 dp, except (spec §3 Everywhere): filter tag chips and speaker chips **32 dp**, chat scope selector **40 dp**, "New chat" **32 dp**, inline citation links (text height). These exceptions get **no `hitSlop`**: the touch area is the drawn area. Existing `hitSlop` elsewhere (tag remove ×, add tag, clear search) is left alone.
- Size controls with `minHeight` plus padding, never a fixed `height`, so text is not clipped at large system font sizes.
- The app never rewrites answer text: Markdown changes how text looks, not what it says.
- Android is the only target (Expo Go and EAS APK on the lead's phone).
- Each task keeps every existing test passing, changing a test only where the task says so.

## Review Focus
1. Citation markers inside Markdown: adjacent `[1][2]`, a marker inside `**bold**` and inside a list item. Each becomes its own link. (Task 6 tests.)
2. Broken or unsupported Markdown: an unclosed `**`, a table, a fenced code block. Shown as readable text, never a crash, never fence or pipe characters. (Task 6 tests.)
3. A long unbroken word or URL in a bubble wraps inside the bubble and doesn't widen the screen. (Task 4 test on `maxWidth` and text `flexShrink`; on-device check.)
4. Pasting 30 lines into the input: it stops at 5 lines and scrolls inside. After Send it is one line again. (Task 3 tests.)
5. Large system font scale on 32 dp chips: text grows the chip instead of being clipped. (Task 1 test: `minHeight`, no `height`.)

## On-device checks (lead, before closing each task's issue)
Cloud implementers can't see a phone, so the lead runs these in Expo Go on the Android phone, in both themes:
- T1: chips look right in Notes, Meetings, Chat and a meeting transcript; with system font size at max, chip text isn't clipped.
- T3: one line is centred; typing and pasting grow the box up to 5 lines, then it scrolls; it shrinks back on delete and after Send.
- T4: bubbles on the correct sides; a long URL wraps inside its bubble.
- T5: with TalkBack on, note what a citation link reads. A nested `Text` may expose only its visible time, not its `accessibilityLabel`. If so, record it in the plan issue; there's no workaround in this plan.
- T6: a real answer with a list and bold text renders correctly (this also proves `marked` runs under Hermes).

---

### Task 1: Shared chip: 32 dp, radius 6, no hidden touch zone

**Files:**
- Modify: `mobile/src/theme/tokens.ts` (add `chip: 6` to `radius`; `tokens.test.ts` checks colours only and needs no change)
- Create: `mobile/src/components/Chip.tsx`
- Modify: `mobile/src/library/LibraryHeader.tsx` (tag chips), `mobile/src/chat/ScopeBar.tsx` (tag chips only; segments are Task 2), `mobile/src/detail/TranscriptView.tsx` (speaker chips)
- Test: `mobile/src/components/Chip.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // mobile/src/components/Chip.tsx
  export interface ChipProps {
    label: string;
    onPress: () => void;
    accessibilityLabel: string;
    accessibilityRole?: 'button' | 'checkbox'; // default 'button'
    selected?: boolean; // omitted → not a selectable chip
    selectedVariant?: 'signal' | 'outline'; // default 'signal'
    leading?: React.ReactNode; // e.g. the speaker colour dot
  }
  export function Chip(props: ChipProps): React.JSX.Element;
  ```
- Styles: `minHeight: 32`, `paddingHorizontal: spacing.sm`, `paddingVertical: spacing.xs`, `borderRadius: radius.chip`, `borderCurve: 'continuous'`, `borderWidth: 1`, row with `gap: spacing.xs`. No `minWidth`, no fixed `height`, no `hitSlop`. Label `typeScale.small`: regular when unselected, semibold when selected. Ripple `tape.line`. Press scale `motion.press.scale` (as the Library chips do today).
- Colours:
  - `signal` selected: bg `signal`, border `signal`, text `onSignal`.
  - `outline` selected: bg `raised`, border `ink`, text `ink`.
  - `signal` unselected, or not selectable: bg `surface`, border `line`, text `ink` (as the Library and speaker chips today).
  - `outline` unselected: no fill, border `line`, text `ink` (as the Chat tag chips today).
- `accessibilityState`: `{ checked: selected }` for role `checkbox`, `{ selected }` for role `button` when `selected` is defined.
- Call sites keep their current labels and roles:
  - Library: `Filter by <name>`, button, `signal`.
  - Chat tags: `Tag <name>`, checkbox, `outline`.
  - Speakers: `Rename speaker <name>`, button, not selectable, `leading` = the 10 dp colour dot.
- Rows:
  - `LibraryHeader` `tagScrollContent` gap `spacing.sm`.
  - `TranscriptView` `speakerChipsScrollView`: replace `maxHeight: 52` with `flexGrow: 0`. A horizontal `ScrollView` grows by default, which is why the cap existed.

- [ ] **Step 1: Write the failing tests** in `Chip.test.tsx`:
  - press calls `onPress` once;
  - the pressable has `toHaveStyle({ minHeight: 32, borderRadius: 6 })` and no `height` or `minWidth` style;
  - its `hitSlop` prop is undefined;
  - `selected` + `signal` → bg `tape.signal` and label colour `tape.onSignal`;
  - `selected` + `outline` → bg `tape.raised` and border `tape.ink`;
  - role `checkbox` + `selected` → `accessibilityState.checked === true`;
  - `leading` renders.
- [ ] **Step 2: Run** `npx jest src/components/Chip.test.tsx` → FAIL (module not found).
- [ ] **Step 3: Implement** `Chip` and the `radius.chip` token, then switch the three call sites to it and delete their old chip styles.
- [ ] **Step 4: Run** `npx jest --ci`, `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .` → all clean. The existing Library, Chat and recording tests pass unchanged.
- [ ] **Step 5: Commit** `feat(mobile): one slimmer chip for tag filters and speakers`.

### Task 2: Chat scope selector and New chat button

**Depends on:** Task 1 (same `ScopeBar.tsx`).

**Files:**
- Modify: `mobile/src/chat/ScopeBar.tsx` (segments), `mobile/src/chat/ChatScreen.tsx` (`Pill`)
- Test: `mobile/src/chat/ChatScreen.test.tsx`

**Interfaces:**
- Scope segment: `minHeight: 40` (was 48). Label `variant="labelLarge"` (16 sp semibold, was `labelMedium` 12 sp).
- `Pill` gains `size?: 'md' | 'sm'` (default `'md'`, unchanged `minHeight: 48`). `'sm'` → `minHeight: 32`, `paddingHorizontal: spacing.md`, no `hitSlop`. Only "New chat" uses `size="sm"`; Retry and Record keep `'md'`.

- [ ] **Step 1: Write the failing tests** in `ChatScreen.test.tsx`:
  - the `New chat` button `toHaveStyle({ minHeight: 32 })`;
  - after an interrupted run, the `Retry` button `toHaveStyle({ minHeight: 48 })`;
  - each scope radio (`Notes`, `Meetings`, `Both`) `toHaveStyle({ minHeight: 40 })`;
  - its label text `toHaveStyle({ fontSize: 16 })`.
- [ ] **Step 2: Run** `npx jest src/chat` → the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** jest, tsc, eslint, prettier → clean.
- [ ] **Step 5: Commit** `feat(mobile): tighter chat scope selector and New chat button`.

### Task 3: Chat input that stays centred and grows to 5 lines

**Depends on:** Task 2 (same `ChatScreen.tsx`).

**Files:**
- Create: `mobile/src/chat/MessageInput.tsx` (moves the input row out of `ChatScreen.tsx`)
- Modify: `mobile/src/chat/ChatScreen.tsx`
- Test: `mobile/src/chat/MessageInput.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export const INPUT_LINE_HEIGHT = 24;
  export const INPUT_PADDING_V = 12;
  export const INPUT_MIN_HEIGHT = 48; // 1 line + padding
  export const INPUT_MAX_HEIGHT = 144; // 5 lines + padding
  export function inputHeight(contentHeight: number): number; // clamp(ceil(h), MIN, MAX)
  export function MessageInput(props: {
    value: string;
    onChangeText: (text: string) => void;
    onSend: () => void;
    canSend: boolean;
  }): React.JSX.Element;
  ```
- `TextInput`:
  - Keep it `multiline`, with the same `accessibilityLabel="Message"` and placeholder.
  - `lineHeight: INPUT_LINE_HEIGHT`, `paddingVertical: INPUT_PADDING_V`, `textAlignVertical: 'center'`.
  - `height` comes from state, set by `onContentSizeChange` through `inputHeight`. On Android the reported content height already includes the vertical padding: `ReactTextContentSizeWatcher.kt` adds `compoundPaddingTop`/`Bottom`. So the formula adds nothing.
  - When `value` becomes `''`, the height resets to `INPUT_MIN_HEIGHT`.
- The send button and its disabled logic move unchanged. The row keeps `alignItems: 'flex-end'`, so the button stays at the bottom as the box grows.

- [ ] **Step 1: Write the failing tests** in `MessageInput.test.tsx`:
  - `inputHeight`: 10→48, 48→48, 72→72, 96.4→97, 500→144;
  - firing `contentSizeChange` with `{ nativeEvent: { contentSize: { width: 200, height: 96 } } }` → the input `toHaveStyle({ height: 96 })`;
  - with height 500 → `{ height: 144 }`;
  - the input `toHaveStyle({ textAlignVertical: 'center', lineHeight: 24, paddingVertical: 12 })`;
  - re-rendering with `value=''` after a growth → `{ height: 48 }`;
  - Send disabled when `canSend` is false.
- [ ] **Step 2: Run** `npx jest src/chat/MessageInput.test.tsx` → FAIL.
- [ ] **Step 3: Implement** `MessageInput` and use it in `ChatScreen`.
- [ ] **Step 4: Run** jest (the existing `ChatScreen` send tests still pass), tsc, eslint, prettier → clean.
- [ ] **Step 5: Commit** `feat(mobile): chat input stays centred and grows to five lines`.

### Task 4: Message bubbles

**Depends on:** Task 3 (same `ChatScreen.tsx`).

**Files:**
- Create: `mobile/src/chat/MessageBubble.tsx`
- Modify: `mobile/src/chat/ChatScreen.tsx` (turn rendering, `turns` and `turn` styles)
- Test: `mobile/src/chat/ChatScreen.test.tsx`

**Interfaces:**
- Produces: `MessageBubble({ from, children, accessibilityLabel? }: { from: 'user' | 'assistant'; children: React.ReactNode; accessibilityLabel?: string })`, with `testID` `bubble-user` / `bubble-assistant`.
- `user`:
  - `alignSelf: 'flex-end'`, `maxWidth: '80%'`, bg `tape.raised`.
  - Rendered `accessible` with `accessibilityLabel` `You said: <question>`.
  - The question is `bodyMedium` text with `flexShrink: 1`, as typed.
- `assistant`:
  - `alignSelf: 'flex-start'`, `maxWidth: '85%'`, bg `tape.surface`, hairline border `tape.line`.
  - Not grouped for accessibility, so the links and Retry inside stay reachable.
  - Holds `TurnResult`: the status line, the answer or fixed reply, or the failure with Retry.
- Both: `borderRadius: radius.card`, `paddingVertical: spacing.sm`, `paddingHorizontal: spacing.md`, no shadow.
- Spacing: within a turn `gap: spacing.sm`; between turns `gap: spacing.md`.
- The starters and the "Record something first" empty state are unchanged.

- [ ] **Step 1: Write the failing tests:**
  - a done turn renders `bubble-user` with `toHaveStyle({ alignSelf: 'flex-end' })` and label `You said: Q?`;
  - `bubble-assistant` has `{ alignSelf: 'flex-start' }`;
  - both have a `maxWidth`;
  - a running turn's status line sits inside `bubble-assistant`;
  - an interrupted turn's Retry is inside `bubble-assistant` and still retries.
- [ ] **Step 2: Run** `npx jest src/chat` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** jest, tsc, eslint, prettier → clean.
- [ ] **Step 5: Commit** `feat(mobile): chat messages in bubbles, yours on the right`.

### Task 5: Inline citation links

**Depends on:** Task 4 (`ChatScreen.test.tsx`).

**Files:**
- Create: `mobile/src/chat/CitationLink.tsx`
- Modify: `mobile/src/chat/AnswerText.tsx` (render links inline, remove the chip row and its styles)
- Test: `mobile/src/chat/ChatScreen.test.tsx`

**Interfaces:**
- Produces: `CitationLink({ citation }: { citation: Schemas['CitationOut'] })`.
- It is a **nested** `Text` (must sit inside a parent `Text`):
  - `accessibilityRole="link"`, `accessibilityLabel={`Open ${citationLabel(citation)}`}`;
  - text `citationTime(citation.start_ms)`;
  - style `fontFamily: fontFamilies.mono`, `fontSize: typeScale.small`, `color: tape.signal`;
  - `onPress` → `router.push({ pathname: '/recording/[id]', params: { id: citation.recording_id, segment: citation.segment_id } })`.
- `AnswerText` (answers only): render each `splitAnswer` part in one `Text`: text parts as text, citation parts as `CitationLink`. Two citation parts with nothing between them get `' · '` between them. Unknown markers stay as text (as now). Fixed replies are unchanged.

- [ ] **Step 1: Write the failing tests** (rename the existing `a citation chip opens the recording at its segment` to `a citation link opens the recording at its segment`; its label query and assertion stay):
  - the answer shows `01:23` and no `[1]`;
  - text `A [1][2].` with two citations renders as one text, `getByText('A 01:23 · 04:56.')`, and each label opens its own segment;
  - the old chip text `Standup · 01:23` is not rendered as visible text;
  - the fixed reply `Hello [1]` test stays as it is.
- [ ] **Step 2: Run** `npx jest src/chat` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** jest, tsc, eslint, prettier → clean.
- [ ] **Step 5: Commit** `feat(mobile): cite inline with time links instead of chips`.

### Task 6: Markdown in assistant replies

**Depends on:** Task 5 (`CitationLink`, `AnswerText`).

**Files:**
- Modify: `mobile/package.json`, `mobile/package-lock.json` (`npx expo install marked@18.0.14`), `mobile/jest.config.js`
- Create: `mobile/src/chat/Markdown.tsx`
- Modify: `mobile/src/chat/AnswerText.tsx`
- Test: `mobile/src/chat/Markdown.test.tsx`

**Interfaces:**
- Consumes: `CitationLink`, `splitAnswer` (Task 5, `citations.ts`).
- Produces: `Markdown({ text, citations }: { text: string; citations: Schemas['CitationOut'][] })`.
- Runtime: `marked` 18.0.14 uses regex lookbehind and Unicode property escapes (`\p{P}`, `\p{S}` with the `u` flag) and feature-detects lookbehind. Hermes supports all of these (facebook/hermes `doc/RegExp.md`: "ES9 lookbehinds", "Unicode property escapes"). The lead's T6 on-device check confirms it before the task closes.
- Parsing: `marked.lexer(text, { gfm: true, breaks: true })`. `breaks: true` keeps the server's single line breaks.
  - `marked` ships ESM only. Add it to the jest-expo `transformIgnorePatterns` allow-list in `jest.config.js`, extending jest-expo's default pattern rather than replacing it (read it from `node_modules/jest-expo/jest-preset.js`).
- Blocks:
  - `paragraph` → one `Text` (`bodyMedium`);
  - `heading` (any depth) → `Text` semibold at `typeScale.body`;
  - `list` → a `View` of items, each a row with a `•` marker or the number (`start + index`, then `.`; `start` is a number for ordered lists, `""` for bullet lists) and the item's content. A `list_item` holds blocks; in a tight list that is a block-level `text` token with its own inline `tokens`;
  - block-level `text` → its inline `tokens` (never its raw `text`, which would drop bold and citation links);
  - `code` (fenced) → its `text` in mono, no fences;
  - `blockquote` → its child blocks;
  - `table` → the header row first, then one line per body row, cells joined with `' · '`;
  - `hr` and `space` → nothing;
  - `html` → its `text` as plain text;
  - any other block → its `text` if it has one, else nothing.
- Inline tokens:
  - `strong` → semibold, `em` → italic, `codespan` → mono;
  - `br` → `\n`;
  - `link` and `del` → their children, with no navigation;
  - `image` → its alt text;
  - `escape` and `text` → their text.
- Citations: first **merge consecutive inline `text` and `escape` tokens**, because a backslash escape splits the text around it (`\[x\] [1]` lexes as escape, text, escape, text). Then run `splitAnswer(merged, citations)` and render citation parts with `CitationLink`, with the same `' · '` rule as Task 5.
- `AnswerText`:
  - answers → `<Markdown text={message.text} citations={message.citations} />`;
  - fixed replies → `<Markdown text={message.text} citations={[]} />`, so the help reply's `- ` lines render as a list.
  - The user's own question stays plain text (Task 4).

- [ ] **Step 1: Write the failing tests** in `Markdown.test.tsx`:
  - `**Decided** to ship [1]` → `Decided` has the semibold font, and a link labelled `Open Standup · 01:23`;
  - `- first [1]\n- second` → two `•` markers, and the link is inside the first item;
  - `1. a\n2. b` → `1.` and `2.`;
  - `## Plan` → `Plan` at `fontSize: 16`, semibold;
  - `` `x` `` → mono;
  - `**[1][2]**` → two links joined by ` · `;
  - an unclosed `**bold` shows `**bold` and doesn't throw;
  - a table and a fenced code block show their cell and code text, with no `|` or a backtick fence;
  - `Q & A [1]` shows `Q & A` literally;
  - the backend `HELP` text (copied from `backend/app/agents/citations.py`) renders its intro line and 3 list items;
  - `line one\nline two` keeps the line break.
- [ ] **Step 2: Run** `npx jest src/chat/Markdown.test.tsx` → FAIL.
- [ ] **Step 3: Install** with `npx expo install marked@18.0.14`. **Implement** `Markdown` and switch `AnswerText` to it.
- [ ] **Step 4: Run** `npx jest --ci` (every chat test, including the `Hello [1]` fixed reply, passes), tsc, eslint, prettier → clean.
- [ ] **Step 5: Commit** `feat(mobile): render Markdown in assistant replies`.
