import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NOTICE_HEIGHT, SAFETY_NOTICE_TEXT, SafetyNotice } from './SafetyNotice';

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('SafetyNotice', () => {
  const html = renderToStaticMarkup(<SafetyNotice />);

  it('uses the exact notice text', () => {
    expect(SAFETY_NOTICE_TEXT).toBe('Educational simulation, not for clinical use');
  });

  it('renders the notice text exactly once', () => {
    expect(count(html, 'Educational simulation, not for clinical use')).toBe(1);
  });

  it('is a sticky top bar above other content', () => {
    expect(html).toMatch(/class="[^"]*\bsticky\b[^"]*"/);
    expect(html).toMatch(/class="[^"]*\btop-0\b[^"]*"/);
    expect(html).toMatch(/class="[^"]*\bz-50\b[^"]*"/);
  });

  it('publishes its height as --notice-h on :root and uses it', () => {
    expect(html).toContain(`:root{--notice-h:${NOTICE_HEIGHT};}`);
    expect(html).toContain('height:var(--notice-h)');
  });

  it('is a non-live note and uses text of at least 16 px', () => {
    expect(html).toContain('role="note"');
    expect(html).not.toContain('aria-live');
    expect(html).not.toContain('role="status"');
    expect(html).toMatch(/class="[^"]*\btext-base\b[^"]*"/);
  });
});
