import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AvatarParameters } from '@/types';
import { PBT_PARAMS } from '@/test/pbt';
import { CASE } from '@/test/caseFixtures';
import { SPEECH_BAND_HEIGHT } from './StitchedPatient';
import {
  ENDING_HEADING,
  ENDING_OVERHEAD_WITH_SIDE,
  EndingScreen,
  endingControls,
  RESCUED_TEXT,
  REWIND_LABEL,
  SHOW_MONITOR_LABEL,
  type EndingKind,
} from './EndingScreen';

const ENDINGS: readonly EndingKind[] = ['rescued', 'lost'];
const STATUS = 'Test status sentence.';

const BASE: AvatarParameters = {
  skinTone: 'healthy',
  breathing: { stopped: false, periodS: 4, depth: 1 },
  heartbeat: { stopped: false, periodS: 0.8 },
  sweating: false,
  swollenSides: [],
  decompressedSides: [],
  overallStatus: 'normal',
  bands: {},
};

const noop = () => {};

function render(ending: EndingKind, params: Partial<AvatarParameters> = {}): string {
  return renderToStaticMarkup(
    <EndingScreen
      ending={ending}
      params={{ ...BASE, ...params }}
      statusSentence={STATUS}
      onRewind={noop}
      onShowMonitor={noop}
    />,
  );
}

/** Splits the markup into the Avatar's wrapper and everything else. */
function split(html: string): { avatar: string; outside: string } {
  const start = html.indexOf('<div data-part="ending-avatar"');
  const end = html.indexOf('<div class="flex flex-wrap', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return { avatar: html.slice(start, end), outside: html.slice(0, start) + html.slice(end) };
}

/** The Avatar's own `<svg role="img">…</svg>` (the last svg in the markup). */
function avatarSvg(html: string): string {
  const start = html.indexOf('<svg role="img"');
  const end = html.lastIndexOf('</svg>');
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, end + '</svg>'.length);
}

function textNodes(html: string): string[] {
  return html
    .split(/<[^>]*>/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function buttonLabels(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
}

function dialogTag(html: string): string {
  const match = html.match(/<div[^>]*role="dialog"[^>]*>/);
  expect(match).not.toBeNull();
  return match![0];
}

const escapedRescued = RESCUED_TEXT.replace(/'/g, '&#x27;');

describe('EndingScreen', () => {
  it('shows the heading per Ending and the rescued sentence only when rescued', () => {
    const rescued = render('rescued');
    const lost = render('lost');
    expect(rescued).toContain('<h2 class="text-2xl font-semibold">Rescued</h2>');
    expect(lost).toContain('<h2 class="text-2xl font-semibold">Lost</h2>');
    expect(rescued).toContain(escapedRescued);
    expect(lost).not.toContain(escapedRescued);
  });

  it('has no text outside the Avatar besides the heading, rescued sentence and button labels', () => {
    for (const ending of ENDINGS) {
      const { outside } = split(render(ending));
      const expected = [
        ENDING_HEADING[ending],
        ...(ending === 'rescued' ? [escapedRescued] : []),
        REWIND_LABEL[ending],
        SHOW_MONITOR_LABEL,
      ];
      expect(textNodes(outside)).toEqual(expected);
    }
  });

  it('renders the controls in order with Rewind as the first button', () => {
    expect(buttonLabels(render('rescued'))).toEqual(['Rewind', 'Show the monitor']);
    expect(buttonLabels(render('lost'))).toEqual(['Rewind and try again', 'Show the monitor']);
    for (const ending of ENDINGS) {
      const firstButton = render(ending).match(/<button[^>]*>/)![0];
      expect(firstButton).toContain('data-control="rewind"');
    }
  });

  it('endingControls returns Rewind then Show the monitor', () => {
    expect(endingControls('rescued')).toEqual([
      { id: 'rewind', label: 'Rewind' },
      { id: 'monitor', label: 'Show the monitor' },
    ]);
    expect(endingControls('lost')).toEqual([
      { id: 'rewind', label: 'Rewind and try again' },
      { id: 'monitor', label: 'Show the monitor' },
    ]);
  });

  it('is a modal dialog named by the heading with no id attributes', () => {
    for (const ending of ENDINGS) {
      const html = render(ending);
      const tag = dialogTag(html);
      expect(tag).toContain('aria-modal="true"');
      expect(tag).toContain(`aria-label="${ENDING_HEADING[ending]}"`);
      expect(html).not.toMatch(/\sid="/);
    }
  });

  it('is a fixed overlay below the Safety_Notice', () => {
    for (const ending of ENDINGS) {
      const tag = dialogTag(render(ending));
      const classes = tag.match(/class="([^"]*)"/)![1].split(/\s+/);
      expect(classes).toEqual(expect.arrayContaining(['fixed', 'z-30', 'sp-ending']));
      expect(classes).not.toContain('z-40');
      expect(classes).not.toContain('z-50');
      expect(tag).toMatch(/style="[^"]*top:var\(--notice-h\)/);
    }
  });

  it('draws a cobweb and leaves the moon and bats to the Avatar', () => {
    for (const ending of ENDINGS) {
      const html = render(ending);
      expect(html).toMatch(/<svg[^>]*data-part="cobweb"/);
      const svg = avatarSvg(html);
      const outsideSvg = html.replace(svg, '');
      expect(outsideSvg).not.toContain('data-part="moon"');
      expect(outsideSvg).not.toContain('data-part="bat"');
      expect(outsideSvg).not.toContain('<circle');
      expect(svg).toContain('data-part="moon"');
    }
  });

  it('renders the lost Avatar unstitching and sleepy', () => {
    const svg = avatarSvg(render('lost'));
    expect(svg).toContain('sp-unstitch');
    expect(svg).toContain('data-expression="sleepy"');
  });

  it('renders the rescued Avatar joyful and drawn from params', () => {
    const swollen = avatarSvg(render('rescued', { swollenSides: ['Left'] }));
    expect(swollen).toContain('data-expression="joyful"');
    expect(swollen).toMatch(/<[^>]*data-side="Left"[^>]*data-part="chest-swollen"/);
    const flat = avatarSvg(render('rescued', { swollenSides: [] }));
    expect(flat).not.toContain('data-part="chest-swollen"');
  });

  it('renders the speech band with the height from SPEECH_BAND_HEIGHT', () => {
    expect(SPEECH_BAND_HEIGHT).toBe('8.5rem');
    for (const ending of ENDINGS) {
      const band = render(ending).match(/<div[^>]*data-part="speech-band"[^>]*>/);
      expect(band).not.toBeNull();
      expect(band![0]).toContain(`height:${SPEECH_BAND_HEIGHT}`);
    }
  });

  it('pulls the Avatar wrapper up by the speech band and sizes it from the height left', () => {
    for (const ending of ENDINGS) {
      const wrapper = render(ending).match(/<div data-part="ending-avatar"[^>]*>/);
      expect(wrapper).not.toBeNull();
      const style = wrapper![0].match(/style="([^"]*)"/)![1];
      expect(style).toContain(`margin-top:calc(-1 * ${SPEECH_BAND_HEIGHT})`);
      expect(style).toMatch(/width:min\(22rem,/);
      expect(wrapper![0]).not.toContain('max-w-[13rem]');
    }
  });

  it('names the Avatar with the statusSentence', () => {
    for (const ending of ENDINGS) {
      expect(render(ending)).toContain(`<svg role="img" aria-label="${STATUS}"`);
    }
  });
});

/** Renders with an explicit `sideRevealText` (placeholder strings only). */
function renderWithSide(ending: EndingKind, sideRevealText: string | undefined): string {
  return renderToStaticMarkup(
    <EndingScreen
      ending={ending}
      params={BASE}
      statusSentence={STATUS}
      onRewind={noop}
      onShowMonitor={noop}
      sideRevealText={sideRevealText}
    />,
  );
}

/** The escaping renderToStaticMarkup applies to text content. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function avatarWrapperStyle(html: string): string {
  const wrapper = html.match(/<div data-part="ending-avatar"[^>]*>/);
  expect(wrapper).not.toBeNull();
  return wrapper![0].match(/style="([^"]*)"/)![1];
}

const WHITESPACE = [' ', '\t', '\n', '\r', '\u00a0', '\u2003'] as const;

/** Non-blank strings of 1 to 120 characters, ASCII and grapheme mixes. */
const arbNonBlank = fc
  .oneof(
    { weight: 3, arbitrary: fc.string({ minLength: 1, maxLength: 120 }) },
    { weight: 2, arbitrary: fc.string({ unit: 'grapheme', minLength: 1, maxLength: 40 }) },
    {
      weight: 1,
      arbitrary: fc
        .tuple(
          fc.array(fc.constantFrom(...WHITESPACE), { maxLength: 4 }),
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.array(fc.constantFrom(...WHITESPACE), { maxLength: 4 }),
        )
        .map(([lead, body, trail]) => lead.join('') + body + trail.join('')),
    },
  )
  .filter((s) => s.length >= 1 && s.length <= 120 && s.trim() !== '');

/** Blank values: absent, empty or whitespace only. */
const arbBlank = fc.oneof(
  fc.constant(undefined),
  fc.array(fc.constantFrom(...WHITESPACE), { maxLength: 10 }).map((cs) => cs.join('')),
);

describe('EndingScreen Side_Reveal_Text', () => {
  // Feature: bedside-exam, Property 19: The Side_Reveal_Text appears only on the Ending_Screen, in full
  it('shows any non-blank text once, in full, inside side-reveal between the heading block and the Avatar', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ENDINGS), arbNonBlank, (ending, text) => {
        const html = renderWithSide(ending, text);
        const tags = html.match(/<p data-part="side-reveal"[^>]*>/g) ?? [];
        expect(tags).toEqual(['<p data-part="side-reveal" class="text-base">']);
        const tag = tags[0]!;
        expect(tag).not.toMatch(/line-clamp|overflow-hidden/);
        const start = html.indexOf(tag) + tag.length;
        const end = html.indexOf('</p>', start);
        expect(html.slice(start, end)).toBe(escapeHtml(text));
        const heading = html.indexOf('</h2>');
        const previous = ending === 'rescued' ? html.indexOf(escapedRescued) : heading;
        expect(heading).toBeGreaterThan(-1);
        expect(previous).toBeGreaterThan(-1);
        expect(html.indexOf(tag)).toBeGreaterThan(previous);
        expect(html.indexOf(tag)).toBeLessThan(html.indexOf('<div data-part="ending-avatar"'));
      }),
      PBT_PARAMS,
    );
  });

  // Feature: bedside-exam, Property 19: The Side_Reveal_Text appears only on the Ending_Screen, in full
  it('renders no side-reveal element and the markup of today for a blank or absent text', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ENDINGS), arbBlank, (ending, text) => {
        const html = renderWithSide(ending, text);
        expect(html).not.toContain('side-reveal');
        expect(html).toBe(render(ending));
      }),
      PBT_PARAMS,
    );
  });

  it('shows a 120-character text and the shipped case text in full inside side-reveal', () => {
    const long = 'x'.repeat(119) + 'z';
    expect(long).toHaveLength(120);
    const shipped = CASE.play?.sideRevealText;
    expect(typeof shipped).toBe('string');
    expect(shipped!.length).toBeGreaterThan(0);
    for (const ending of ENDINGS) {
      for (const text of [long, shipped!]) {
        const html = renderWithSide(ending, text);
        const tag = '<p data-part="side-reveal" class="text-base">';
        const start = html.indexOf(tag);
        expect(start).toBeGreaterThan(-1);
        const contentStart = start + tag.length;
        const end = html.indexOf('</p>', contentStart);
        expect(end).toBeGreaterThan(-1);
        expect(html.slice(contentStart, end)).toBe(escapeHtml(text));
      }
    }
  });

  it('uses the with-side overhead in the Avatar width only when the text is present', () => {
    expect(ENDING_OVERHEAD_WITH_SIDE).toBe('14.75rem');
    for (const ending of ENDINGS) {
      const withSide = avatarWrapperStyle(renderWithSide(ending, 'Placeholder side text.'));
      expect(withSide).toContain(`- ${ENDING_OVERHEAD_WITH_SIDE}) * 200 / 280)`);
      expect(withSide).not.toContain('- 11rem)');
      expect(withSide).toContain(`margin-top:calc(-1 * ${SPEECH_BAND_HEIGHT})`);
      for (const blank of [undefined, '', '   ']) {
        const without = avatarWrapperStyle(renderWithSide(ending, blank));
        expect(without).toContain('- 11rem) * 200 / 280)');
        expect(without).not.toContain(ENDING_OVERHEAD_WITH_SIDE);
      }
    }
  });
});

/** Renders with an explicit `speech` and optional `sideRevealText`. */
function renderWithSpeech(ending: EndingKind, speech: string | null | undefined, sideRevealText?: string): string {
  return renderToStaticMarkup(
    <EndingScreen
      ending={ending}
      params={BASE}
      statusSentence={STATUS}
      onRewind={noop}
      onShowMonitor={noop}
      sideRevealText={sideRevealText}
      speech={speech}
    />,
  );
}

describe('EndingScreen speech (patient-speech 7.3, 7.4, 7.7, 7.9)', () => {
  const RESCUED_LINE = CASE.play!.speech!.rescued![0];
  const PLACEHOLDER = 'Placeholder speech line.';
  const SIDE = 'Placeholder side text.';
  const LIVE_EMPTY = '<div data-part="speech-live" class="sr-only" aria-live="polite" aria-atomic="true"></div>';

  const bubbles = (html: string): string[] =>
    [...html.matchAll(/<div data-part="speech-bubble"[^>]*><p class="whitespace-pre-wrap">([^<]*)<\/p>/g)].map((m) => m[1]);

  const wrapperTag = (html: string): string => html.match(/<div data-part="ending-avatar"[^>]*>/)![0];

  it('shows the Displayed_Speech in the rescued bubble with no negative margin and the band budgeted', () => {
    for (const text of [RESCUED_LINE, PLACEHOLDER]) {
      const html = renderWithSpeech('rescued', text);
      const { avatar } = split(html);
      expect(bubbles(avatar)).toEqual([escapeHtml(text)]);
      expect(bubbles(html)).toHaveLength(1);

      const style = avatarWrapperStyle(html);
      expect(style).not.toContain('margin');
      expect(style).toContain(`- 11rem - ${SPEECH_BAND_HEIGHT}) * 200 / 280)`);
      expect(style).toMatch(/width:min\(22rem,/);

      const cls = wrapperTag(html).match(/class="([^"]*)"/)![1].replace(/&amp;/g, '&').split(/\s+/);
      expect(cls).toEqual(
        expect.arrayContaining([
          'max-w-full',
          '[&_[data-part=speech-bubble]]:left-1/2',
          '[&_[data-part=speech-bubble]]:right-auto',
          '[&_[data-part=speech-bubble]]:w-[min(28rem,calc(100vw-2rem))]',
          '[&_[data-part=speech-bubble]]:max-w-none',
          '[&_[data-part=speech-bubble]]:-translate-x-1/2',
        ]),
      );
      expect(cls).not.toContain('[&_[data-part=speech-band]]:pointer-events-none');

      // With a Side_Reveal_Text the with-side overhead is used, still without a margin.
      const withSide = avatarWrapperStyle(renderWithSpeech('rescued', text, SIDE));
      expect(withSide).not.toContain('margin');
      expect(withSide).toContain(`- ${ENDING_OVERHEAD_WITH_SIDE} - ${SPEECH_BAND_HEIGHT}) * 200 / 280)`);
    }
  });

  it('renders the markup of today for a rescued screen with null, blank or absent speech, plus the empty region', () => {
    for (const side of [undefined, SIDE]) {
      const today = renderWithSide('rescued', side);
      for (const blank of [undefined, null, '', '  \n ']) {
        const html = renderWithSpeech('rescued', blank, side);
        expect(html).toBe(today);
        expect(html).not.toContain('data-part="speech-bubble"');
        expect(avatarWrapperStyle(html)).toContain(`margin-top:calc(-1 * ${SPEECH_BAND_HEIGHT})`);
      }
    }
  });

  it('keeps the lost screen markup and Avatar wrapper unchanged by any speech prop and shows no bubble', () => {
    for (const side of [undefined, SIDE]) {
      const without = renderWithSide('lost', side);
      for (const speech of [RESCUED_LINE, PLACEHOLDER, null, '', undefined]) {
        const html = renderWithSpeech('lost', speech, side);
        expect(html).toBe(without);
        expect(html).not.toContain('data-part="speech-bubble"');
        expect(wrapperTag(html)).toBe(wrapperTag(without));
      }
      // The wrapper of today: class, negative margin and the height-derived width.
      const tag = wrapperTag(without);
      expect(tag).toContain('class="max-w-full [&amp;_[data-part=speech-band]]:pointer-events-none"');
      const overhead = side === undefined ? '11rem' : ENDING_OVERHEAD_WITH_SIDE;
      expect(avatarWrapperStyle(without)).toBe(
        `margin-top:calc(-1 * ${SPEECH_BAND_HEIGHT});width:min(22rem, calc((100vh - var(--notice-h) - ${overhead}) * 200 / 280))`,
      );
      // The only speech element on the lost screen is the empty region at the end of the dialog.
      expect(without.endsWith(`${LIVE_EMPTY}</div>`)).toBe(true);
    }
  });

  it('has exactly one speech live region, the last child of the dialog, empty in static markup', () => {
    for (const ending of ENDINGS) {
      for (const speech of [RESCUED_LINE, null]) {
        const html = renderWithSpeech(ending, speech);
        expect(html.split('data-part="speech-live"')).toHaveLength(2);
        expect(html).toMatch(/^<div[^>]*role="dialog"/);
        // The region closes right before the dialog's own closing tag.
        expect(html.endsWith(`${LIVE_EMPTY}</div>`)).toBe(true);
        // Outside the centred flex column (it follows the column's closing tag).
        expect(html.indexOf(LIVE_EMPTY)).toBeGreaterThan(html.lastIndexOf('</button>'));
      }
    }
  });

  it('keeps the Avatar aria-label equal to the statusSentence with speech', () => {
    const html = renderWithSpeech('rescued', RESCUED_LINE);
    expect(bubbles(html)).toEqual([escapeHtml(RESCUED_LINE)]);
    expect(html).toContain(`<svg role="img" aria-label="${STATUS}"`);
  });
});
