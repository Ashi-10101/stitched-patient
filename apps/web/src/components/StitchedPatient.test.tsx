import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AvatarParameters, Side, VitalBand } from '@/types';
import { arbAvatarParameters } from '@/test/generators';
import { CASE } from '@/test/caseFixtures';
import { PBT_PARAMS } from '@/test/pbt';
import { rateLabel, SKIN_PALETTES, StitchedPatient, type StitchedPatientProps } from './StitchedPatient';

const SIDES: readonly Side[] = ['Left', 'Right'];
const TONES: readonly AvatarParameters['skinTone'][] = ['healthy', 'pale', 'cyanotic'];

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

function render(
  props: Partial<Omit<StitchedPatientProps, 'params'>> & { params?: Partial<AvatarParameters> } = {},
): string {
  const { params, statusSentence = 'Test status.', ...rest } = props;
  return renderToStaticMarkup(
    <StitchedPatient params={{ ...BASE, ...params }} statusSentence={statusSentence} {...rest} />,
  );
}

/** HTML escaping as React applies it to text and attribute values. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

interface Element {
  name: string;
  attrs: Record<string, string>;
  /** Open ancestors, outermost first. */
  ancestors: { name: string; attrs: Record<string, string> }[];
}

/**
 * Minimal tag parser for React's static markup. React escapes `<`, `>` and `"`
 * in text and attribute values, so every `<` in the markup starts a tag; the
 * parser checks that every `<` was matched and that every tag was closed.
 */
const TAG_RE = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;

function parse(html: string): Element[] {
  const elements: Element[] = [];
  const stack: { name: string; attrs: Record<string, string> }[] = [];
  let tags = 0;
  for (const m of html.matchAll(TAG_RE)) {
    tags += 1;
    const [, closing, name, rawAttrs, selfClosing] = m;
    if (closing) {
      const top = stack.pop();
      if (top?.name !== name) throw new Error(`unbalanced </${name}>`);
      continue;
    }
    const attrs = Object.fromEntries([...rawAttrs.matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    elements.push({ name, attrs, ancestors: [...stack] });
    if (!selfClosing) stack.push({ name, attrs });
  }
  if (tags !== count(html, '<')) throw new Error('markup has a "<" that is not part of a tag');
  if (stack.length !== 0) throw new Error('markup has unclosed tags');
  return elements;
}

function num(el: Element, key: string): number {
  const raw = el.attrs[key];
  const n = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isFinite(n)) throw new Error(`<${el.name}> has no numeric ${key}: ${String(raw)}`);
  return n;
}

/** Every x coordinate of a side-specific element; unknown geometry fails the test. */
function xCoords(el: Element): number[] {
  switch (el.name) {
    case 'rect':
      return [num(el, 'x'), num(el, 'x') + num(el, 'width')];
    case 'line':
      return [num(el, 'x1'), num(el, 'x2')];
    case 'circle':
      return [num(el, 'cx') - num(el, 'r'), num(el, 'cx') + num(el, 'r')];
    case 'ellipse':
      return [num(el, 'cx') - num(el, 'rx'), num(el, 'cx') + num(el, 'rx')];
    case 'polygon':
    case 'polyline': {
      const values = (el.attrs.points ?? '').trim().split(/[\s,]+/).map(Number);
      const xs = values.filter((_, i) => i % 2 === 0);
      if (xs.length === 0 || values.some((v) => !Number.isFinite(v))) throw new Error(`bad points on <${el.name}>`);
      return xs;
    }
    default:
      throw new Error(`unrecognised geometry <${el.name}> with data-side`);
  }
}

function sideElements(html: string): Element[] {
  return parse(html).filter((e) => 'data-side' in e.attrs);
}

function chestOf(html: string, side: Side): Element {
  const chests = sideElements(html).filter(
    (e) => e.attrs['data-side'] === side && (e.attrs['data-part'] === 'chest' || e.attrs['data-part'] === 'chest-swollen'),
  );
  expect(chests).toHaveLength(1);
  return chests[0];
}

/** Hue in degrees, or null for a grey (no saturation). */
function hue(hex: string): number | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a hex colour: ${hex}`);
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return null;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function isGreen(hex: string): boolean {
  const h = hue(hex);
  return h !== null && h >= 75 && h <= 165;
}

describe('StitchedPatient accessible name', () => {
  it('uses the given sentence as the svg aria-label', () => {
    const svg = parse(render({ statusSentence: 'He is struggling to breathe.' })).filter((e) => e.name === 'svg');
    expect(svg).toHaveLength(1);
    expect(svg[0].attrs.role).toBe('img');
    expect(svg[0].attrs['aria-label']).toBe('He is struggling to breathe.');
  });

  // Choosing the default sentence when no rule matches is the Status_Selector's
  // job; the Avatar renders whatever sentence the caller passes.
  it("renders the case's defaultSentence when that is the sentence passed in", () => {
    const sentence = CASE.play?.status.defaultSentence;
    expect(sentence).toBeTruthy();
    const svg = parse(render({ statusSentence: sentence })).find((e) => e.name === 'svg');
    expect(svg?.attrs['aria-label']).toBe(escapeHtml(sentence as string));
  });
});

describe('StitchedPatient speech bubble', () => {
  it('shows a 200-character speech text in full', () => {
    const speech = Array.from({ length: 200 }, (_, i) => 'abcdefghij klmnopqrstuvwxyz'[i % 27]).join('');
    expect(speech).toHaveLength(200);
    const html = render({ speech });
    expect(html).toContain('data-part="speech-bubble"');
    expect(html).toContain(speech);
    expect(html).toContain('overflow-wrap:anywhere');
  });

  it('shows speech with characters React escapes, escaped and in full', () => {
    const speech = 'Tom & Jerry said "<hi>" and it\'s fine. '.repeat(6).slice(0, 200);
    expect(speech).toHaveLength(200);
    expect(render({ speech })).toContain(escapeHtml(speech));
  });

  it('renders no bubble and identical markup for missing, empty and whitespace-only speech', () => {
    const missing = render();
    const empty = render({ speech: '' });
    const blank = render({ speech: '   \n\t' });
    expect(empty).toBe(missing);
    expect(blank).toBe(missing);
    expect(missing).not.toContain('speech-bubble');
  });

  it('always reserves the headroom band', () => {
    for (const speech of [undefined, '', '   \n\t', 'Hello.']) {
      expect(count(render({ speech }), 'data-part="speech-band"')).toBe(1);
    }
  });
});

describe('StitchedPatient variants', () => {
  it("adds sp-unstitch and a final offset to every patch group for 'lost'", () => {
    const patches = parse(render({ variant: 'lost' })).filter((e) => e.attrs['data-part'] === 'patch');
    expect(patches.length).toBeGreaterThanOrEqual(3);
    for (const p of patches) {
      expect(p.attrs.class?.split(' ')).toContain('sp-unstitch');
      expect(p.attrs.style).toMatch(/--sp-unstitch-final:translate\(/);
    }
  });

  it.each(['live', 'rescued'] as const)("has no sp-unstitch for '%s'", (variant) => {
    expect(render({ variant })).not.toContain('sp-unstitch');
  });
});

describe('StitchedPatient rate icons', () => {
  const band = (direction: VitalBand['direction']): VitalBand =>
    direction === 'none' ? { state: 'normal', direction } : { state: 'warning', direction };
  const cases = [
    ['low', 'slow'],
    ['none', 'normal'],
    ['high', 'fast'],
  ] as const;

  it.each(cases)('maps direction %s to %s for heart and breathing', (direction, label) => {
    const html = render({ params: { bands: { heartRate: band(direction), respiratoryRate: band(direction) } } });
    const els = parse(html);
    const container = els.find((e) => e.attrs['data-part'] === 'rate-icons');
    expect(container?.attrs.class?.split(' ')).toContain('sp-rate-static');
    expect(els.find((e) => e.attrs['data-rate'] === 'heart')?.attrs['data-rate-label']).toBe(label);
    expect(els.find((e) => e.attrs['data-rate'] === 'breathing')?.attrs['data-rate-label']).toBe(label);
    expect(html).toContain(`Heart: ${label}`);
    expect(html).toContain(`Breathing: ${label}`);
    expect(rateLabel(band(direction))).toBe(label);
  });

  it('reads a missing band as normal', () => {
    const els = parse(render({ params: { bands: {} } }));
    expect(els.find((e) => e.attrs['data-rate'] === 'heart')?.attrs['data-rate-label']).toBe('normal');
    expect(els.find((e) => e.attrs['data-rate'] === 'breathing')?.attrs['data-rate-label']).toBe('normal');
    expect(rateLabel(undefined)).toBe('normal');
  });
});

describe('StitchedPatient artwork', () => {
  it('has two bolts, at least three stitches, 3 to 4 patches, the gown colour and a beating heart', () => {
    const html = render();
    const els = parse(html);
    const part = (p: string) => els.filter((e) => e.attrs['data-part'] === p);
    expect(part('bolt')).toHaveLength(2);
    expect(part('stitch').length).toBeGreaterThanOrEqual(3);
    expect(part('patch').length).toBeGreaterThanOrEqual(3);
    expect(part('patch').length).toBeLessThanOrEqual(4);
    expect(html).toContain('fill="#A9D6F5"');
    expect(part('heart')).toHaveLength(1);
    expect(part('heart')[0].attrs.class?.split(' ')).toContain('sp-beat');
  });

  it('marks stopped breathing and heartbeat and passes periods and depth as CSS variables', () => {
    const running = parse(render({ params: { breathing: { stopped: false, periodS: 2.5, depth: 1.4 }, heartbeat: { stopped: false, periodS: 0.375 } } }));
    const torso = running.find((e) => e.attrs['data-part'] === 'torso');
    const heart = running.find((e) => e.attrs['data-part'] === 'heart');
    expect(torso?.attrs.class).toBe('sp-breathe');
    expect(heart?.attrs.class).toBe('sp-beat');
    expect(torso?.attrs.style).toContain('--sp-breath-period:2.5s');
    expect(torso?.attrs.style).toContain('--sp-breath-depth:1.4');
    expect(heart?.attrs.style).toContain('--sp-beat-period:0.375s');

    const stopped = parse(render({ params: { breathing: { stopped: true, periodS: 4, depth: 1 }, heartbeat: { stopped: true, periodS: 1 } } }));
    expect(stopped.find((e) => e.attrs['data-part'] === 'torso')?.attrs.class?.split(' ')).toContain('sp-breath-stopped');
    expect(stopped.find((e) => e.attrs['data-part'] === 'heart')?.attrs.class?.split(' ')).toContain('sp-beat-stopped');
  });

  it('draws three sweat drops only when sweating', () => {
    expect(count(render({ params: { sweating: true } }), 'data-part="sweat"')).toBe(3);
    expect(count(render({ params: { sweating: false } }), 'data-part="sweat"')).toBe(0);
  });

  it.each(TONES)('uses the %s palette for skin patches and lips', (skinTone) => {
    const els = parse(render({ params: { skinTone } }));
    const palette = SKIN_PALETTES[skinTone];
    expect(els.find((e) => e.attrs['data-part'] === 'lips')?.attrs.fill).toBe(palette.lips);
    const insidePatch = els.filter((e) => e.ancestors.some((a) => a.attrs['data-part'] === 'patch'));
    const fills = new Set(insidePatch.map((e) => e.attrs.fill).filter((f): f is string => f !== undefined));
    for (const skin of palette.patches) expect(fills.has(skin)).toBe(true);
    for (const fill of fills) expect(isGreen(fill), `${fill} is green`).toBe(false);
  });

  it('has blue lips for cyanotic and never a green skin colour', () => {
    expect(SKIN_PALETTES.cyanotic.lips).toBe('#5B7BD5');
    for (const tone of TONES) {
      for (const c of [...SKIN_PALETTES[tone].patches, SKIN_PALETTES[tone].lips]) {
        expect(isGreen(c), `${tone} ${c} is green`).toBe(false);
      }
    }
  });
});

describe('StitchedPatient properties', () => {
  // Feature: play-mode, Property 8: Patient's Left is drawn on the viewer's right
  /** **Validates: Requirements 3.7, 4.17, 4.23** */
  it("Property 8: Patient's Left is drawn on the viewer's right", () => {
    fc.assert(
      fc.property(arbAvatarParameters, (params) => {
        const html = renderToStaticMarkup(<StitchedPatient params={params} statusSentence="Status." />);
        const els = sideElements(html);

        for (const el of els) {
          const side = el.attrs['data-side'];
          expect(SIDES).toContain(side);
          const [lo, hi] = side === 'Left' ? [100, 200] : [0, 100];
          for (const x of xCoords(el)) {
            expect(x).toBeGreaterThanOrEqual(lo);
            expect(x).toBeLessThanOrEqual(hi);
          }
          // No transform can move it: none on the element, and its only open
          // ancestors are the page wrappers and the <svg> itself (direct child).
          expect(el.attrs.transform).toBeUndefined();
          expect(el.attrs.style ?? '').not.toContain('transform');
          expect(el.ancestors[el.ancestors.length - 1].name).toBe('svg');
          for (const a of el.ancestors) {
            expect(a.name).not.toBe('g');
            expect(a.attrs.transform).toBeUndefined();
            expect(a.attrs.class ?? '').not.toContain('sp-unstitch');
          }
        }

        const swollenAll = renderToStaticMarkup(
          <StitchedPatient params={{ ...params, swollenSides: ['Left', 'Right'] }} statusSentence="Status." />,
        );
        const swollenNone = renderToStaticMarkup(
          <StitchedPatient params={{ ...params, swollenSides: [] }} statusSentence="Status." />,
        );
        for (const side of SIDES) {
          const chest = chestOf(html, side);
          expect(chest.attrs['data-part']).toBe(params.swollenSides.includes(side) ? 'chest-swollen' : 'chest');

          const big = chestOf(swollenAll, side);
          const normal = chestOf(swollenNone, side);
          expect(big.attrs['data-part']).toBe('chest-swollen');
          expect(normal.attrs['data-part']).toBe('chest');
          expect(num(big, 'width')).toBeGreaterThan(num(normal, 'width'));
          expect(num(big, 'height')).toBeGreaterThan(num(normal, 'height'));

          const marks = params.decompressedSides.includes(side) ? 1 : 0;
          const onSide = els.filter((e) => e.attrs['data-side'] === side);
          expect(onSide.filter((e) => e.attrs['data-part'] === 'needle')).toHaveLength(marks);
          expect(onSide.filter((e) => e.attrs['data-part'] === 'bandage')).toHaveLength(marks);
        }
        // The half check above also ran on every element of both comparison renders.
        for (const el of [...sideElements(swollenAll), ...sideElements(swollenNone)]) {
          const [lo, hi] = el.attrs['data-side'] === 'Left' ? [100, 200] : [0, 100];
          for (const x of xCoords(el)) {
            expect(x).toBeGreaterThanOrEqual(lo);
            expect(x).toBeLessThanOrEqual(hi);
          }
        }
      }),
      PBT_PARAMS,
    );
  });

  /**
   * Generated sentence and speech text never contains the forbidden markup
   * substrings themselves, so a raw substring check on the whole markup can
   * only find them in markup the component wrote.
   */
  const FORBIDDEN_TEXT = /<image|href|url\(|\sid=/i;
  const arbText = fc
    .oneof(
      { weight: 3, arbitrary: fc.string({ maxLength: 60 }) },
      { weight: 2, arbitrary: fc.string({ unit: 'grapheme', maxLength: 30 }) },
      {
        weight: 2,
        arbitrary: fc.constantFrom(
          '',
          ' ',
          '   \n\t',
          'Tom & Jerry <b>"hi"</b> it\'s',
          '&amp; &lt; already escaped',
          'He says: "I can\'t breathe!" <>',
          'Ünïcödé 😮 text',
        ),
      },
    )
    .filter((s) => !FORBIDDEN_TEXT.test(s));

  // Feature: play-mode, Property 9: The Avatar renders one deterministic inline SVG
  /** **Validates: Requirements 3.1, 3.8, 3.12** */
  it('Property 9: The Avatar renders one deterministic inline SVG', () => {
    fc.assert(
      fc.property(
        arbAvatarParameters,
        arbText,
        arbText,
        fc.constantFrom<NonNullable<StitchedPatientProps['variant']>>('live', 'rescued', 'lost'),
        (params, statusSentence, speech, variant) => {
          const props: StitchedPatientProps = { params, statusSentence, speech, variant };
          const html = renderToStaticMarkup(<StitchedPatient {...props} />);

          expect(count(html, '<svg')).toBe(1);
          const els = parse(html);
          const svg = els.filter((e) => e.name === 'svg');
          expect(svg).toHaveLength(1);
          expect(svg[0].attrs.role).toBe('img');
          expect(svg[0].attrs['aria-label']).toBe(escapeHtml(statusSentence));

          expect(html).not.toContain('<image');
          expect(html).not.toContain('href');
          expect(html).not.toContain('url(');
          expect(html).not.toMatch(/\sid=/);
          for (const e of els) {
            expect(e.name).not.toBe('image');
            expect(e.attrs.id).toBeUndefined();
          }

          const again = renderToStaticMarkup(<StitchedPatient {...structuredClone(props)} />);
          expect(again).toBe(html);
        },
      ),
      PBT_PARAMS,
    );
  });
});
