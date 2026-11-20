import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { View } from '@/lib/sessionState';
import {
  canSelectView,
  type CaseStatus,
  playUnavailableReason,
  selectIfAllowed,
  ViewSwitcher,
} from './ViewSwitcher';

const NOT_AVAILABLE = 'Play mode is not available for this case';
const CASE_FAILED = 'Play mode is unavailable: the case could not be loaded.';
const VIEWS: View[] = ['play', 'clinician'];
const STATUSES: CaseStatus[] = ['loading', 'loaded', 'failed'];

function render(view: View, caseStatus: CaseStatus, hasPlay: boolean): string {
  return renderToStaticMarkup(
    <ViewSwitcher view={view} caseStatus={caseStatus} hasPlay={hasPlay} onSelect={() => {}} />,
  );
}

/** Opening tag and content of the option button with the given label. */
function option(html: string, label: 'Play' | 'Clinician'): { tag: string; body: string } {
  const buttons = [...html.matchAll(/(<button[^>]*>)(.*?)<\/button>/g)];
  const match = buttons.find((b) => b[2].includes(`<span>${label}</span>`));
  if (!match) throw new Error(`option ${label} not found`);
  return { tag: match[1], body: match[2] };
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('canSelectView', () => {
  it('allows nothing while the case is loading', () => {
    for (const v of VIEWS) {
      expect(canSelectView(v, 'loading', true)).toBe(false);
      expect(canSelectView(v, 'loading', false)).toBe(false);
    }
  });

  it('allows Clinician whenever the case is not loading', () => {
    for (const hasPlay of [true, false]) {
      expect(canSelectView('clinician', 'loaded', hasPlay)).toBe(true);
      expect(canSelectView('clinician', 'failed', hasPlay)).toBe(true);
    }
  });

  it('allows Play only when the case loaded with a Play_Section', () => {
    expect(canSelectView('play', 'loaded', true)).toBe(true);
    expect(canSelectView('play', 'loaded', false)).toBe(false);
    expect(canSelectView('play', 'failed', true)).toBe(false);
    expect(canSelectView('play', 'failed', false)).toBe(false);
  });
});

describe('playUnavailableReason', () => {
  it('returns the exact reason texts', () => {
    expect(playUnavailableReason('loaded', false)).toBe(NOT_AVAILABLE);
    expect(playUnavailableReason('failed', true)).toBe(CASE_FAILED);
    expect(playUnavailableReason('failed', false)).toBe(CASE_FAILED);
  });

  it('returns null when Play is available or the case is loading', () => {
    expect(playUnavailableReason('loaded', true)).toBeNull();
    expect(playUnavailableReason('loading', true)).toBeNull();
    expect(playUnavailableReason('loading', false)).toBeNull();
  });
});

describe('selectIfAllowed', () => {
  it('never calls onSelect for a disabled option', () => {
    for (const status of STATUSES) {
      for (const hasPlay of [true, false]) {
        for (const target of VIEWS) {
          if (canSelectView(target, status, hasPlay)) continue;
          for (const current of VIEWS) {
            const onSelect = vi.fn();
            expect(selectIfAllowed(target, current, status, hasPlay, onSelect)).toBe(false);
            expect(onSelect).not.toHaveBeenCalled();
          }
        }
      }
    }
  });

  it('calls onSelect once with the option when allowed and not current', () => {
    const toPlay = vi.fn();
    expect(selectIfAllowed('play', 'clinician', 'loaded', true, toPlay)).toBe(true);
    expect(toPlay).toHaveBeenCalledTimes(1);
    expect(toPlay).toHaveBeenCalledWith('play');

    const toClinician = vi.fn();
    expect(selectIfAllowed('clinician', 'play', 'failed', false, toClinician)).toBe(true);
    expect(toClinician).toHaveBeenCalledWith('clinician');
  });

  it('does not call onSelect when re-selecting the current view', () => {
    const onSelect = vi.fn();
    expect(selectIfAllowed('play', 'play', 'loaded', true, onSelect)).toBe(false);
    expect(selectIfAllowed('clinician', 'clinician', 'loaded', true, onSelect)).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('ViewSwitcher markup', () => {
  it('is a named radiogroup of two radio buttons', () => {
    const html = render('play', 'loaded', true);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="View"');
    expect(count(html, 'role="radio"')).toBe(2);
    expect(html).not.toMatch(/<button[^>]*\sdisabled[=\s>]/);
  });

  it.each(VIEWS)('marks only the selected option (%s) with aria-checked and a check mark', (view) => {
    const html = render(view, 'loaded', true);
    const selectedLabel = view === 'play' ? 'Play' : 'Clinician';
    const otherLabel = view === 'play' ? 'Clinician' : 'Play';
    expect(count(html, 'aria-checked="true"')).toBe(1);
    expect(option(html, selectedLabel).tag).toContain('aria-checked="true"');
    expect(option(html, otherLabel).tag).toContain('aria-checked="false"');
    expect(count(html, '✓')).toBe(1);
    expect(option(html, selectedLabel).body).toContain('✓');
    expect(option(html, otherLabel).body).not.toContain('✓');
  });

  it('enables both options and shows no reason when Play is available', () => {
    const html = render('play', 'loaded', true);
    expect(html).not.toContain('aria-disabled');
    expect(html).not.toContain(NOT_AVAILABLE);
    expect(html).not.toContain(CASE_FAILED);
    expect(option(html, 'Play').tag).not.toContain('aria-describedby');
  });

  it('disables Play with the no-Play_Section reason, linked by aria-describedby', () => {
    const html = render('clinician', 'loaded', false);
    const play = option(html, 'Play').tag;
    expect(play).toContain('aria-disabled="true"');
    expect(option(html, 'Clinician').tag).not.toContain('aria-disabled');
    expect(count(html, NOT_AVAILABLE)).toBe(1);
    expect(html).not.toContain(CASE_FAILED);
    const id = /aria-describedby="([^"]+)"/.exec(play)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}"`);
  });

  it('disables Play with the case-failed reason, linked by aria-describedby', () => {
    const html = render('clinician', 'failed', true);
    const play = option(html, 'Play').tag;
    expect(play).toContain('aria-disabled="true"');
    expect(option(html, 'Clinician').tag).not.toContain('aria-disabled');
    expect(count(html, CASE_FAILED)).toBe(1);
    expect(html).not.toContain(NOT_AVAILABLE);
    const id = /aria-describedby="([^"]+)"/.exec(play)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}"`);
  });

  it.each(VIEWS)('disables both options while loading (view %s)', (view) => {
    const html = render(view, 'loading', true);
    expect(option(html, 'Play').tag).toContain('aria-disabled="true"');
    expect(option(html, 'Clinician').tag).toContain('aria-disabled="true"');
    expect(count(html, 'aria-checked="true"')).toBe(1);
  });
});
