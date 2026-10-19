import { marked, type Token, type Tokens } from 'marked';
import React from 'react';
import { Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';

import type { Schemas } from '../api/client';
import { fontFamilies } from '../theme/fonts';
import type { TapeTheme } from '../theme/paperTheme';
import { spacing, typeScale } from '../theme/tokens';
import { CitationLink } from './CitationLink';
import { splitAnswer } from './citations';

export interface MarkdownProps {
  text: string;
  citations: Schemas['CitationOut'][];
}

type InlineGroup =
  { type: 'text_group'; text: string } | { type: 'token'; token: Token };

export function Markdown({
  text,
  citations = [],
}: MarkdownProps): React.JSX.Element {
  const { tape } = useTheme<TapeTheme>();

  let tokens: Token[];
  try {
    tokens = marked.lexer(text, { gfm: true, breaks: true });
  } catch {
    return (
      <View style={{ gap: spacing.sm }}>
        <Text style={{ color: tape.ink, fontSize: typeScale.body }}>
          {text}
        </Text>
      </View>
    );
  }

  function renderInlineTokens(
    inlineTokens: Token[] | undefined,
  ): React.ReactNode {
    if (!inlineTokens || inlineTokens.length === 0) {
      return null;
    }

    const groups: InlineGroup[] = [];
    let pendingText = '';

    for (const tok of inlineTokens) {
      if (
        (tok.type === 'escape' || tok.type === 'text') &&
        (!('tokens' in tok) || !tok.tokens || tok.tokens.length === 0)
      ) {
        pendingText +=
          'text' in tok && typeof tok.text === 'string'
            ? tok.text
            : (tok.raw ?? '');
      } else {
        if (pendingText !== '') {
          groups.push({ type: 'text_group', text: pendingText });
          pendingText = '';
        }
        groups.push({ type: 'token', token: tok });
      }
    }
    if (pendingText !== '') {
      groups.push({ type: 'text_group', text: pendingText });
    }

    return groups.map((group, gIdx) => {
      if (group.type === 'text_group') {
        const parts = splitAnswer(group.text, citations);
        return parts.map((part, pIdx) => {
          if ('citation' in part) {
            const prev = parts[pIdx - 1];
            const hasPrevCitation = prev && 'citation' in prev;
            return (
              <React.Fragment key={`part-${gIdx}-${pIdx}`}>
                {hasPrevCitation ? ' · ' : null}
                <CitationLink citation={part.citation} />
              </React.Fragment>
            );
          }
          return (
            <React.Fragment key={`part-${gIdx}-${pIdx}`}>
              {part.text}
            </React.Fragment>
          );
        });
      }

      const tok = group.token;
      switch (tok.type) {
        case 'strong':
          return (
            <Text
              key={`tok-${gIdx}`}
              style={{ fontFamily: fontFamilies.semibold }}
            >
              {renderInlineTokens(tok.tokens)}
            </Text>
          );
        case 'em':
          return (
            <Text key={`tok-${gIdx}`} style={{ fontStyle: 'italic' }}>
              {renderInlineTokens(tok.tokens)}
            </Text>
          );
        case 'codespan':
          return (
            <Text
              key={`tok-${gIdx}`}
              style={{
                fontFamily: fontFamilies.mono,
                fontSize: typeScale.small,
                color: tape.ink,
              }}
            >
              {tok.text}
            </Text>
          );
        case 'br':
          return <Text key={`tok-${gIdx}`}>{'\n'}</Text>;
        case 'link':
        case 'del':
          return (
            <Text key={`tok-${gIdx}`}>{renderInlineTokens(tok.tokens)}</Text>
          );
        case 'image':
          return <Text key={`tok-${gIdx}`}>{tok.text}</Text>;
        case 'text':
          if ('tokens' in tok && tok.tokens && tok.tokens.length > 0) {
            return (
              <Text key={`tok-${gIdx}`}>{renderInlineTokens(tok.tokens)}</Text>
            );
          }
          return (
            <Text key={`tok-${gIdx}`}>
              {tok.text ?? ('raw' in tok ? tok.raw : '')}
            </Text>
          );
        default:
          return (
            <Text key={`tok-${gIdx}`}>
              {'text' in tok && typeof tok.text === 'string'
                ? tok.text
                : 'raw' in tok
                  ? tok.raw
                  : ''}
            </Text>
          );
      }
    });
  }

  function renderBlocks(blockTokens: Token[] | undefined): React.ReactNode {
    if (!blockTokens || blockTokens.length === 0) {
      return null;
    }

    return blockTokens.map((token, idx) => {
      const key = `block-${idx}`;
      switch (token.type) {
        case 'paragraph':
          return (
            <Text
              key={key}
              style={{ color: tape.ink, fontSize: typeScale.body }}
            >
              {renderInlineTokens(token.tokens)}
            </Text>
          );
        case 'heading':
          return (
            <Text
              key={key}
              style={{
                color: tape.ink,
                fontSize: typeScale.body,
                fontFamily: fontFamilies.semibold,
              }}
            >
              {renderInlineTokens(token.tokens)}
            </Text>
          );
        case 'list': {
          const listToken = token as Tokens.List;
          return (
            <View key={key} style={{ gap: spacing.xs }}>
              {listToken.items.map((item: Tokens.ListItem, itemIdx: number) => (
                <View
                  key={`item-${itemIdx}`}
                  style={{ flexDirection: 'row', gap: spacing.xs }}
                >
                  <Text style={{ color: tape.ink, fontSize: typeScale.body }}>
                    {listToken.ordered
                      ? `${(Number(listToken.start) || 1) + itemIdx}.`
                      : '•'}
                  </Text>
                  <View style={{ flex: 1 }}>{renderBlocks(item.tokens)}</View>
                </View>
              ))}
            </View>
          );
        }
        case 'text':
          return (
            <Text
              key={key}
              style={{ color: tape.ink, fontSize: typeScale.body }}
            >
              {token.tokens && token.tokens.length > 0
                ? renderInlineTokens(token.tokens)
                : token.text}
            </Text>
          );
        case 'code':
          return (
            <Text
              key={key}
              style={{
                fontFamily: fontFamilies.mono,
                fontSize: typeScale.small,
                color: tape.ink,
              }}
            >
              {token.text}
            </Text>
          );
        case 'blockquote': {
          const bqToken = token as Tokens.Blockquote;
          return <View key={key}>{renderBlocks(bqToken.tokens)}</View>;
        }
        case 'table': {
          const tableToken = token as Tokens.Table;
          return (
            <View key={key} style={{ gap: spacing.xs }}>
              {tableToken.header && tableToken.header.length > 0 ? (
                <Text
                  style={{
                    color: tape.ink,
                    fontSize: typeScale.body,
                    fontFamily: fontFamilies.semibold,
                  }}
                >
                  {tableToken.header
                    .map((c: Tokens.TableCell) => c.text)
                    .join(' · ')}
                </Text>
              ) : null}
              {tableToken.rows.map((row: Tokens.TableCell[], rIdx: number) => (
                <Text
                  key={`row-${rIdx}`}
                  style={{ color: tape.ink, fontSize: typeScale.body }}
                >
                  {row.map((c: Tokens.TableCell) => c.text).join(' · ')}
                </Text>
              ))}
            </View>
          );
        }

        case 'hr':
        case 'space':
          return null;
        case 'html':
          return (
            <Text
              key={key}
              style={{ color: tape.ink, fontSize: typeScale.body }}
            >
              {token.text}
            </Text>
          );
        default:
          if ('text' in token && typeof token.text === 'string') {
            return (
              <Text
                key={key}
                style={{ color: tape.ink, fontSize: typeScale.body }}
              >
                {token.text}
              </Text>
            );
          }
          return null;
      }
    });
  }

  return <View style={{ gap: spacing.sm }}>{renderBlocks(tokens)}</View>;
}
