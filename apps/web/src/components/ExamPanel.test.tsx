import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { SidedExamAction } from '@/types';
import { BASE_CASE, CASE } from '@/test/caseFixtures';
import { EXAM_HEADING_TEXT, ExamPanel } from './ExamPanel';

const EXAM = CASE.play!.exam!;
const LISTEN = EXAM.actions.find((a) => a.id === 'listen') as SidedExamAction;
const noop = () => {};

const render = (disabled: boolean) =>
  renderToStaticMarkup(<ExamPanel exam={EXAM} disabled={disabled} onExamine={noop} />);

const buttonTags = (html: string): string[] => [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
const buttonBodies = (html: string): string[] =>
  [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1]);
const tagTokens = (tag: string): string[] => /class="([^"]*)"/.exec(tag)?.[1].split(/\s+/) ?? [];
const text = (markup: string): string => markup.replace(/<[^>]+>/g, '');

/** Shipped Exam_Button texts in the order of 8.1, Left before Right. */
const EXPECTED_TEXTS = [
  'Look at his chest',
  'Listen to his chest - left side',
  'Listen to his chest - right side',
  'Feel the position of his windpipe',
  'Look at his neck veins',
];

describe('ExamPanel', () => {
  it('renders the heading text in an h2 styled like "What can you do?"', () => {
    for (const disabled of [false, true]) {
      const html = render(disabled);
      expect(html.startsWith('<section data-part="exam-panel"')).toBe(true);
      expect(html).toContain(`<h2 class="text-lg font-semibold">${EXAM_HEADING_TEXT}</h2>`);
      expect(EXAM_HEADING_TEXT).toBe('Check on him');
    }
  });

  it('gives five buttons for the shipped case, in the order of 8.1, Left before Right, with the exact texts', () => {
    for (const disabled of [false, true]) {
      const bodies = buttonBodies(render(disabled));
      expect(bodies.map(text)).toEqual(EXPECTED_TEXTS);
    }
    expect(EXPECTED_TEXTS[1]).toBe(LISTEN.labels.Left);
    expect(EXPECTED_TEXTS[2]).toBe(LISTEN.labels.Right);
  });

  it('renders one exam-row per Exam_Action; the sided row is a two-column grid from sm', () => {
    const html = render(false);
    const rows = [...html.matchAll(/<div data-part="exam-row"([^>]*)>(.*?)<\/div>/g)];
    expect(rows).toHaveLength(EXAM.actions.length);
    rows.forEach(([, attrs, inner], k) => {
      const sided = EXAM.actions[k].id === 'listen';
      expect(buttonTags(inner)).toHaveLength(sided ? 2 : 1);
      if (sided) expect(attrs).toBe(' class="grid grid-cols-1 gap-2 sm:grid-cols-2"');
      else expect(attrs).toBe('');
    });
  });

  it('enabled buttons: type="button", data-control="exam", play classes plus min-w-0, no lock, no tabindex', () => {
    const html = render(false);
    const tags = buttonTags(html);
    expect(tags).toHaveLength(5);
    for (const tag of tags) {
      expect(tag).toContain('type="button"');
      expect(tag).toContain('data-control="exam"');
      expect(tag).not.toContain('disabled=""');
      const tokens = tagTokens(tag);
      for (const t of ['border-2', 'px-4', 'py-2', 'text-base', 'font-semibold', 'break-words', 'text-left', 'min-w-0']) {
        expect(tokens).toContain(t);
      }
      expect(tokens).not.toContain('border-dashed');
    }
    expect(html).not.toContain('<svg');
    expect(html.toLowerCase()).not.toContain('tabindex');
  });

  it('disabled buttons: native disabled, border-dashed and the aria-hidden lock icon, no extra text, no tabindex', () => {
    const html = render(true);
    const tags = buttonTags(html);
    const bodies = buttonBodies(html);
    expect(tags).toHaveLength(5);
    tags.forEach((tag, k) => {
      expect(tag).toContain('disabled=""');
      expect(tag).toContain('data-control="exam"');
      expect(tagTokens(tag)).toContain('border-dashed');
      expect(bodies[k]).toMatch(/^<svg [^>]*aria-hidden="true"/);
      expect(text(bodies[k])).toBe(EXPECTED_TEXTS[k]);
    });
    expect(html).not.toContain('Not available right now');
    expect(html.toLowerCase()).not.toContain('tabindex');
  });

  it('has no data-* attribute containing left, right or a Variant_Id', () => {
    const variantIds = (BASE_CASE.variants ?? []).map((v) => v.id.toLowerCase());
    expect(variantIds.length).toBeGreaterThan(0);
    for (const disabled of [false, true]) {
      const values = [...render(disabled).matchAll(/\sdata-[\w-]+="([^"]*)"/g)].map((m) => m[1].toLowerCase());
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) {
        for (const word of ['left', 'right', ...variantIds]) expect(value).not.toContain(word);
      }
    }
  });

  it('onExamine receives the action id and side of the clicked button', () => {
    const onExamine = vi.fn();
    // ExamPanel uses no hooks, so calling it returns the element tree; the
    // buttons' onClick props are called directly (no DOM in this test setup).
    const tree = ExamPanel({ exam: EXAM, disabled: false, onExamine });
    const buttons: ReactElement<{ onClick: () => void; 'data-control'?: string }>[] = [];
    const walk = (node: ReactNode): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (!isValidElement<{ children?: ReactNode; 'data-control'?: string; onClick?: () => void }>(node)) return;
      if (node.props['data-control'] === 'exam') {
        buttons.push(node as ReactElement<{ onClick: () => void }>);
      }
      walk(node.props.children);
    };
    walk(tree);
    expect(buttons).toHaveLength(5);
    for (const button of buttons) button.props.onClick();
    expect(onExamine.mock.calls).toEqual([
      ['look-chest', null],
      ['listen', 'Left'],
      ['listen', 'Right'],
      ['windpipe', null],
      ['neck-veins', null],
    ]);
  });
});
