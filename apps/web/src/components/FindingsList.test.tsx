import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ExamRecordEntry, Side } from '@/types';
import { CASE } from '@/test/caseFixtures';
import { FINDINGS_BOX_CLASS, FINDINGS_EMPTY_TEXT, FindingsList, shouldScrollToNewest } from './FindingsList';

const EXAM = CASE.play!.exam!;

const entry = (
  actionId: string,
  side: Side | undefined,
  simulationTime: number,
  sentence: string,
): ExamRecordEntry => ({
  actionId,
  ...(side === undefined ? {} : { side }),
  simulationTime,
  branchId: 'main',
  sentence,
  abnormal: false,
  wallClockTime: `2026-01-01T00:00:${String(Math.floor(simulationTime) % 60).padStart(2, '0')}.000Z`,
});

const render = (entries: readonly ExamRecordEntry[]) =>
  renderToStaticMarkup(<FindingsList entries={entries} exam={EXAM} />);

const text = (markup: string): string => markup.replace(/<[^>]+>/g, '');
const items = (html: string): string[] => [...html.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((m) => m[1]);
const paragraphs = (markup: string): string[] => [...markup.matchAll(/<p[^>]*>(.*?)<\/p>/g)].map((m) => text(m[1]));
const textTags = (html: string): string[] => [...html.matchAll(/<p[^>]*>/g)].map((m) => m[0]);
const tagTokens = (tag: string): string[] => /class="([^"]*)"/.exec(tag)?.[1].split(/\s+/) ?? [];

// Newest first, as the caller passes them (placeholder sentences, not clinical text).
const ENTRIES: ExamRecordEntry[] = [
  entry('windpipe', undefined, 102.9, 'Placeholder sentence C.'),
  entry('listen', 'Right', 65, 'Placeholder sentence B.'),
  entry('look-chest', undefined, 5, 'Placeholder sentence A.'),
];

describe('FindingsList', () => {
  it('shows only the empty text in the box when there are no entries (6.7)', () => {
    const html = render([]);
    expect(FINDINGS_EMPTY_TEXT).toBe("You haven't checked anything yet.");
    expect(html).toBe(
      `<div data-part="findings-list" class="${FINDINGS_BOX_CLASS}"><p class="text-base break-words">You haven&#x27;t checked anything yet.</p></div>`,
    );
    expect(html).not.toContain('<ol');
  });

  it('box carries the Layout height caps', () => {
    for (const html of [render([]), render(ENTRIES)]) {
      const tag = /^<div[^>]*>/.exec(html)![0];
      expect(tagTokens(tag)).toEqual(
        expect.arrayContaining(['min-w-0', 'overflow-y-auto', 'rounded-lg', 'border-2', 'p-3', 'max-h-[16rem]', 'xl:max-h-[12.5rem]']),
      );
    }
  });

  it('renders items in the given order with M:SS time, button text in semibold, then the sentence (6.6)', () => {
    const html = render(ENTRIES);
    expect(html).toContain('<ol aria-label="Your findings"');
    expect(html).not.toContain(FINDINGS_EMPTY_TEXT.replace("'", '&#x27;'));
    const lis = items(html);
    expect(lis.map(paragraphs)).toEqual([
      ['1:42 Feel the position of his windpipe', 'Placeholder sentence C.'],
      ['1:05 Listen to his chest - right side', 'Placeholder sentence B.'],
      ['0:05 Look at his chest', 'Placeholder sentence A.'],
    ]);
    for (const li of lis) {
      const [first, second] = textTags(li);
      expect(tagTokens(first)).toContain('font-semibold');
      expect(tagTokens(second)).not.toContain('font-semibold');
    }
  });

  it('falls back to the action id for an action not in the case, or a sided action without a side', () => {
    const lis = items(
      render([entry('unknown-action', undefined, 0, 'Placeholder X.'), entry('listen', undefined, 61, 'Placeholder Y.')]),
    );
    expect(paragraphs(lis[0])[0]).toBe('0:00 unknown-action');
    expect(paragraphs(lis[1])[0]).toBe('1:01 listen');
  });

  it('puts text-base and break-words on all text (6.12)', () => {
    for (const html of [render([]), render(ENTRIES)]) {
      const tags = textTags(html);
      expect(tags.length).toBeGreaterThan(0);
      for (const tag of tags) expect(tagTokens(tag)).toEqual(expect.arrayContaining(['text-base', 'break-words']));
      // No text outside a <p>.
      expect(text(html.replace(/<p[^>]*>.*?<\/p>/g, ''))).toBe('');
    }
  });

  it('a restored entry shows its stored sentence unchanged (7.7)', () => {
    const stored = 'Stored placeholder sentence, kept as recorded.';
    const html = render([entry('neck-veins', undefined, 30, stored)]);
    expect(paragraphs(items(html)[0])).toEqual(['0:30 Look at his neck veins', stored]);
  });
});

describe('shouldScrollToNewest', () => {
  it('is true only when the count grows', () => {
    expect(shouldScrollToNewest(0, 1)).toBe(true);
    expect(shouldScrollToNewest(2, 3)).toBe(true);
    expect(shouldScrollToNewest(3, 3)).toBe(false);
    expect(shouldScrollToNewest(3, 1)).toBe(false);
    expect(shouldScrollToNewest(1, 0)).toBe(false);
  });
});
