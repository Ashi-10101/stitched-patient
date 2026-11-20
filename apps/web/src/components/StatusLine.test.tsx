import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AlarmState } from '@/types';
import { STATUS_BADGE, StatusLine } from './StatusLine';
import { GoalBar } from './GoalBar';

const STATES: readonly AlarmState[] = ['normal', 'warning', 'critical'];
const TRUNCATION = /\b(truncate|line-clamp[-\w]*|overflow-hidden)\b/;

/** Same escaping as React's server renderer for text content. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function liveRegion(html: string): { before: string; inner: string } {
  const match = /<p[^>]*aria-live="polite"[^>]*>([\s\S]*?)<\/p>/.exec(html);
  expect(match).not.toBeNull();
  return { before: html.slice(0, match!.index), inner: match![1] };
}

function badgeSvg(html: string): string {
  const match = /<svg[\s\S]*?<\/svg>/.exec(html);
  expect(match).not.toBeNull();
  return match![0];
}

function renderStatus(overallStatus: AlarmState, statusSentence = 'The patient is breathing fast.'): string {
  return renderToStaticMarkup(<StatusLine overallStatus={overallStatus} statusSentence={statusSentence} />);
}

describe('StatusLine', () => {
  it('maps each Overall_Status to its badge word', () => {
    expect(STATUS_BADGE.normal.label).toBe('OK');
    expect(STATUS_BADGE.warning.label).toBe('Worried');
    expect(STATUS_BADGE.critical.label).toBe('Danger');
  });

  it.each([
    'The patient looks fine.',
    'Breathing is hard & the lips look "a bit" blue <now>.',
    "The patient's skin is pale.",
  ])('live region holds only the sentence: %s', (sentence) => {
    for (const state of STATES) {
      const { inner } = liveRegion(renderStatus(state, sentence));
      expect(inner).toBe(escapeHtml(sentence));
      expect(inner).not.toMatch(/<[a-z]/i);
    }
  });

  it('places the badge word outside the live region', () => {
    for (const state of STATES) {
      const html = renderStatus(state);
      const { before, inner } = liveRegion(html);
      const label = STATUS_BADGE[state].label;
      expect(before).toContain(`>${label}</span>`);
      expect(before).toContain('<svg');
      expect(inner).not.toContain(label);
    }
  });

  it('draws a distinct shape for each state', () => {
    const ok = badgeSvg(renderStatus('normal'));
    expect(ok).toContain('data-shape="circle-check"');
    expect(ok).toContain('<circle');
    expect(ok).toMatch(/<path[^>]*data-part="check"/);
    expect(ok).not.toContain('<polygon');

    const pointCount = (svg: string) => {
      const m = /<polygon[^>]*points="([^"]+)"/.exec(svg);
      expect(m).not.toBeNull();
      return m![1].trim().split(/\s+/).length;
    };

    const worried = badgeSvg(renderStatus('warning'));
    expect(worried).toContain('data-shape="triangle"');
    expect(pointCount(worried)).toBe(3);

    const danger = badgeSvg(renderStatus('critical'));
    expect(danger).toContain('data-shape="octagon"');
    expect(pointCount(danger)).toBe(8);

    const markups = STATES.map((s) => renderStatus(s));
    expect(new Set(markups).size).toBe(3);
  });

  it('badge svgs are hidden from assistive technology and use no ids or references', () => {
    for (const state of STATES) {
      const svg = badgeSvg(renderStatus(state));
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).not.toMatch(/\sid=|<defs|url\(|href/);
    }
  });

  it('uses no truncation classes', () => {
    for (const state of STATES) {
      expect(renderStatus(state)).not.toMatch(TRUNCATION);
    }
  });
});

describe('GoalBar', () => {
  const LONG_GOAL =
    'Help the patient breathe easily again and keep their heart steady until the end of the scenario, using what you see.';

  const renderGoal = (timeLimitSeconds: number | undefined, latestTime: number | null, goalText = LONG_GOAL) =>
    renderToStaticMarkup(<GoalBar goalText={goalText} timeLimitSeconds={timeLimitSeconds} latestTime={latestTime} />);

  it('shows the full goal text without truncation classes', () => {
    expect(LONG_GOAL.length).toBeGreaterThanOrEqual(110);
    for (const limit of [600, undefined]) {
      const html = renderGoal(limit, 400);
      expect(html).toContain(`>${escapeHtml(LONG_GOAL)}</span>`);
      expect(html).not.toMatch(TRUNCATION);
    }
  });

  it.each([
    [400, '3:20 left'],
    [750, '0:00 left'],
    [null, '10:00 left'],
  ])('latest time %s with limit 600 shows "%s"', (latest, label) => {
    expect(renderGoal(600, latest)).toContain(`>${label}</span>`);
  });

  it('progress shows time left: value = remaining, max = limit, with an accessible name', () => {
    const html = renderGoal(600, 400);
    const progress = /<progress[^>]*>/.exec(html)?.[0] ?? '';
    expect(progress).toContain('aria-label="Time left"');
    expect(progress).toContain('value="200"');
    expect(progress).toContain('max="600"');
    expect(/<progress[^>]*>/.exec(renderGoal(600, 750))?.[0]).toContain('value="0"');
  });

  it('renders no bar and no "left" label without a Time_Limit', () => {
    const html = renderGoal(undefined, 400);
    expect(html).not.toContain('<progress');
    expect(html).not.toContain(' left');
  });
});
