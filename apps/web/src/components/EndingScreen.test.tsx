import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AvatarParameters } from '@/types';
import { PBT_PARAMS } from '@/test/pbt';
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
