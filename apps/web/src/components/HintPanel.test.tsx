import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Hint } from '@/types';
import {
  HintPanel,
  NO_HINTS_LEFT_TEXT,
  canRevealHint,
  hintButtonText,
  revealIfAllowed,
} from './HintPanel';
import { TOAST_MS, Toast, startToastTimer } from './Toast';

const HINTS: Hint[] = [
  { text: 'First hint text' },
  { text: 'Second hint text' },
  { text: 'Third hint text' },
];

const noop = () => {};

function render(hints: Hint[] | undefined, hintsRevealed: number): string {
  return renderToStaticMarkup(<HintPanel hints={hints} hintsRevealed={hintsRevealed} onReveal={noop} />);
}

function buttonTag(html: string): string {
  const match = /<button[^>]*>/.exec(html);
  expect(match).not.toBeNull();
  return match![0];
}

function listItems(html: string): string[] {
  const ol = /<ol[^>]*>([\s\S]*?)<\/ol>/.exec(html);
  if (!ol) return [];
  return [...ol[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
}

describe('HintPanel', () => {
  const expected = ['Hint (3 left)', 'Hint (2 left)', 'Hint (1 left)', NO_HINTS_LEFT_TEXT];

  it.each([0, 1, 2, 3])('shows the remaining count with %i of 3 revealed', (revealed) => {
    const html = render(HINTS, revealed);
    expect(html).toContain(expected[revealed]);
    const disabled = /\sdisabled=""/.test(buttonTag(html));
    expect(disabled).toBe(revealed === 3);
  });

  it('reads exactly "No hints left" and shows a lock icon when exhausted', () => {
    expect(NO_HINTS_LEFT_TEXT).toBe('No hints left');
    const html = render(HINTS, 3);
    expect(html).toContain('<span>No hints left</span>');
    expect(html).toMatch(/<svg[^>]*data-part="hint-lock"[^>]*aria-hidden="true"/);
    expect(render(HINTS, 2)).not.toContain('hint-lock');
  });

  it('renders nothing without Hints', () => {
    expect(render(undefined, 0)).toBe('');
    expect(render([], 0)).toBe('');
    expect(render([], 2)).toBe('');
  });

  it.each([0, 1, 2, 3])('lists exactly the first %i Hints in order', (k) => {
    const items = listItems(render(HINTS, k));
    expect(items).toEqual(HINTS.slice(0, k).map((h) => h.text));
    for (const later of HINTS.slice(k)) {
      expect(render(HINTS, k)).not.toContain(later.text);
    }
  });

  it('clamps hintsRevealed', () => {
    const over = render(HINTS, 5);
    expect(listItems(over)).toEqual(HINTS.map((h) => h.text));
    expect(over).toContain(NO_HINTS_LEFT_TEXT);
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const html = render(HINTS, bad);
      expect(listItems(html)).toEqual([]);
      expect(html).toContain('Hint (3 left)');
    }
  });

  it('hintButtonText formats the count', () => {
    expect(hintButtonText(3)).toBe('Hint (3 left)');
    expect(hintButtonText(1)).toBe('Hint (1 left)');
    expect(hintButtonText(0)).toBe('No hints left');
  });

  it('canRevealHint allows a reveal only while Hints remain', () => {
    expect([0, 1, 2].map((n) => canRevealHint(HINTS, n))).toEqual([true, true, true]);
    expect(canRevealHint(HINTS, 3)).toBe(false);
    expect(canRevealHint(HINTS, 5)).toBe(false);
    expect(canRevealHint(undefined, 0)).toBe(false);
    expect(canRevealHint([], 0)).toBe(false);
  });

  it('revealIfAllowed never calls onReveal at N = 0', () => {
    for (const [hints, revealed] of [
      [HINTS, 3],
      [HINTS, 4],
      [undefined, 0],
      [[], 0],
    ] as const) {
      const onReveal = vi.fn();
      expect(revealIfAllowed(hints as Hint[] | undefined, revealed, onReveal)).toBe(false);
      expect(onReveal).not.toHaveBeenCalled();
    }
  });

  it('revealIfAllowed calls onReveal exactly once at N > 0', () => {
    for (const revealed of [0, 1, 2]) {
      const onReveal = vi.fn();
      expect(revealIfAllowed(HINTS, revealed, onReveal)).toBe(true);
      expect(onReveal).toHaveBeenCalledTimes(1);
    }
  });
});

describe('Toast', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a status region with the message and does not take focus', () => {
    const html = renderToStaticMarkup(<Toast message="Rewound to 1:20" onClose={noop} />);
    expect(html).toMatch(/^<div[^>]*role="status"/);
    expect(html).toContain('Rewound to 1:20');
    expect(html.toLowerCase()).not.toContain('autofocus');
    expect(html.toLowerCase()).not.toContain('tabindex');
  });

  it('TOAST_MS is 3000 and within 2000 to 5000', () => {
    expect(TOAST_MS).toBe(3000);
    expect(TOAST_MS).toBeGreaterThanOrEqual(2000);
    expect(TOAST_MS).toBeLessThanOrEqual(5000);
  });

  it('startToastTimer calls onClose once at TOAST_MS', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    startToastTimer(onClose);
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(TOAST_MS * 3);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('cancelling before TOAST_MS prevents onClose', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const cancel = startToastTimer(onClose);
    vi.advanceTimersByTime(TOAST_MS - 1);
    cancel();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(TOAST_MS * 3);
    expect(onClose).not.toHaveBeenCalled();
  });
});
