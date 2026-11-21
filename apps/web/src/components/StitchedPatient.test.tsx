import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AvatarParameters, Side, VitalBand } from '@/types';
import { arbAvatarParameters } from '@/test/generators';
import { CASE } from '@/test/caseFixtures';
import { PBT_PARAMS } from '@/test/pbt';
import {
  BAT_BOXES,
  CHEST_REGION,
  expressionFor,
  FACE_FEATURE_BOX,
  GOWN_OPENING,
  GOWN_SHADE,
  HAT_BOX,
  IV_BOX,
  OUTLINE_COLOUR,
  OUTLINE_WIDTH,
  QUILT_SHADE,
  rateLabel,
  SPARK_BOXES,
  SKIN_PALETTES,
  StitchedPatient,
  WINDOW_BOX,
  type AvatarVariant,
  type Expression,
  type LayoutBox,
  type StitchedPatientProps,
} from './StitchedPatient';

const SIDES: readonly Side[] = ['Left', 'Right'];
const TONES: readonly AvatarParameters['skinTone'][] = ['healthy', 'pale', 'cyanotic'];
const VARIANTS: readonly AvatarVariant[] = ['live', 'rescued', 'lost'];
const arbVariant = fc.constantFrom<AvatarVariant>(...VARIANTS);

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

interface BBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Every coordinate pair of a path with absolute M/L/H/V/Q/C/Z commands,
 * control points included. A Bézier curve lies inside the convex hull of its
 * control points, so a box around these points can only be too large.
 */
function pathPoints(d: string): [number, number][] {
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
  const points: [number, number][] = [];
  let cmd = '';
  let cur: [number, number] = [0, 0];
  let i = 0;
  const next = (): number => {
    const v = Number(tokens[i++]);
    if (!Number.isFinite(v)) throw new Error(`bad path data: ${d}`);
    return v;
  };
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) {
      cmd = tokens[i++];
      if (!'MLHVQCZ'.includes(cmd)) throw new Error(`unsupported path command ${cmd} in ${d}`);
      if (cmd === 'Z') continue;
    }
    if (cmd === 'H') cur = [next(), cur[1]];
    else if (cmd === 'V') cur = [cur[0], next()];
    else if (cmd === 'M' || cmd === 'L' || cmd === 'Q' || cmd === 'C') cur = [next(), next()];
    else throw new Error(`path data without a command: ${d}`);
    points.push(cur);
  }
  if (points.length === 0) throw new Error(`empty path: ${d}`);
  return points;
}

/** Conservative bounding box of one shape element; unknown geometry fails the test. */
function shapeBox(el: Element): BBox {
  let pts: [number, number][];
  switch (el.name) {
    case 'rect': {
      const [x, y] = [num(el, 'x'), num(el, 'y')];
      pts = [[x, y], [x + num(el, 'width'), y + num(el, 'height')]];
      break;
    }
    case 'circle': {
      const [cx, cy, r] = [num(el, 'cx'), num(el, 'cy'), num(el, 'r')];
      pts = [[cx - r, cy - r], [cx + r, cy + r]];
      break;
    }
    case 'ellipse': {
      const [cx, cy, rx, ry] = [num(el, 'cx'), num(el, 'cy'), num(el, 'rx'), num(el, 'ry')];
      pts = [[cx - rx, cy - ry], [cx + rx, cy + ry]];
      break;
    }
    case 'line':
      pts = [[num(el, 'x1'), num(el, 'y1')], [num(el, 'x2'), num(el, 'y2')]];
      break;
    case 'polygon':
    case 'polyline': {
      const v = (el.attrs.points ?? '').trim().split(/[\s,]+/).map(Number);
      if (v.length < 2 || v.length % 2 !== 0 || v.some((n) => !Number.isFinite(n))) throw new Error(`bad points on <${el.name}>`);
      pts = [];
      for (let k = 0; k < v.length; k += 2) pts.push([v[k], v[k + 1]]);
      break;
    }
    case 'path':
      pts = pathPoints(el.attrs.d ?? '');
      break;
    default:
      throw new Error(`no bounding box for <${el.name}>`);
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** Union of the boxes of every shape element (all but <g>) in `els`. */
function unionBox(els: Element[]): BBox {
  const boxes = els.filter((e) => e.name !== 'g').map(shapeBox);
  if (boxes.length === 0) throw new Error('no shapes to box');
  return {
    minX: Math.min(...boxes.map((b) => b.minX)),
    maxX: Math.max(...boxes.map((b) => b.maxX)),
    minY: Math.min(...boxes.map((b) => b.minY)),
    maxY: Math.max(...boxes.map((b) => b.maxY)),
  };
}

/** True when `b` lies inside the inclusive layout box. */
function boxInside(b: BBox, region: LayoutBox): boolean {
  return (
    b.minX >= region.x && b.maxX <= region.x + region.width && b.minY >= region.y && b.maxY <= region.y + region.height
  );
}

/** Elements that have an open ancestor with the given data-part. */
function within(els: Element[], part: string): Element[] {
  return els.filter((e) => e.ancestors.some((a) => a.attrs['data-part'] === part));
}

/**
 * Descendants of one parsed element. The parser shares each element's `attrs`
 * object with its stack entry, so identity picks out this exact group.
 */
function descendants(els: Element[], group: Element): Element[] {
  return els.filter((e) => e.ancestors.some((a) => a.attrs === group.attrs));
}

function byPart(els: Element[], part: string): Element[] {
  return els.filter((e) => e.attrs['data-part'] === part);
}

function hasClass(el: { attrs: Record<string, string> }, name: string): boolean {
  return (el.attrs.class ?? '').split(' ').includes(name);
}

/** True when `b` and the inclusive layout box share no point (touching counts as overlap). */
function boxDisjoint(b: BBox, region: LayoutBox): boolean {
  return (
    b.maxX < region.x || b.minX > region.x + region.width || b.maxY < region.y || b.minY > region.y + region.height
  );
}

/** Head circle of the head Patch. */
const HEAD_CIRCLE = { cx: 100, cy: 64, r: 42 } as const;

/**
 * Conservative check that a shape lies inside the head circle. A disc is
 * convex, so a shape lies inside it when every vertex of a convex region
 * containing the shape does: rect corners, polygon or line points, and path
 * points including control points (a Bézier curve lies in their convex
 * hull). For circles and ellipses the triangle inequality bounds every
 * edge point by the centre distance plus the largest radius.
 */
function insideHeadCircle(el: Element): boolean {
  const dist = (x: number, y: number) => Math.hypot(x - HEAD_CIRCLE.cx, y - HEAD_CIRCLE.cy);
  const allIn = (pts: [number, number][]) => pts.every(([x, y]) => dist(x, y) <= HEAD_CIRCLE.r);
  switch (el.name) {
    case 'circle':
      return dist(num(el, 'cx'), num(el, 'cy')) + num(el, 'r') <= HEAD_CIRCLE.r;
    case 'ellipse':
      return dist(num(el, 'cx'), num(el, 'cy')) + Math.max(num(el, 'rx'), num(el, 'ry')) <= HEAD_CIRCLE.r;
    case 'rect': {
      const [x, y, w, h] = [num(el, 'x'), num(el, 'y'), num(el, 'width'), num(el, 'height')];
      return allIn([[x, y], [x + w, y], [x, y + h], [x + w, y + h]]);
    }
    case 'line':
      return allIn([[num(el, 'x1'), num(el, 'y1')], [num(el, 'x2'), num(el, 'y2')]]);
    case 'polygon':
    case 'polyline': {
      const v = (el.attrs.points ?? '').trim().split(/[\s,]+/).map(Number);
      if (v.length < 2 || v.length % 2 !== 0 || v.some((n) => !Number.isFinite(n))) throw new Error(`bad points on <${el.name}>`);
      const pts: [number, number][] = [];
      for (let k = 0; k < v.length; k += 2) pts.push([v[k], v[k + 1]]);
      return allIn(pts);
    }
    case 'path':
      return allIn(pathPoints(el.attrs.d ?? ''));
    default:
      throw new Error(`no head-circle check for <${el.name}>`);
  }
}

/** Expected Expression, written independently of `expressionFor`. */
const EXPECTED_EXPRESSION: Record<AvatarVariant, Record<AvatarParameters['overallStatus'], Expression>> = {
  live: { normal: 'calm', warning: 'worried', critical: 'alarmed' },
  rescued: { normal: 'joyful', warning: 'joyful', critical: 'joyful' },
  lost: { normal: 'sleepy', warning: 'sleepy', critical: 'sleepy' },
};

/**
 * Hat, bat and spark groups: the expected counts, no data-side or transform
 * on the group or inside it, each conservative box inside its design box and
 * disjoint from FACE_FEATURE_BOX and CHEST_REGION. Unknown elements or path
 * commands make `shapeBox` throw, which fails the test.
 */
function expectDressUpClear(els: Element[]): void {
  const groups: [string, readonly LayoutBox[]][] = [
    ['hat', [HAT_BOX]],
    ['bat', BAT_BOXES],
    ['spark', SPARK_BOXES],
  ];
  for (const [part, boxes] of groups) {
    const found = byPart(els, part);
    expect(found, part).toHaveLength(boxes.length);
    found.forEach((group, i) => {
      expect(group.name, part).toBe('g');
      const inner = descendants(els, group);
      for (const e of [group, ...inner]) {
        expect('data-side' in e.attrs, `${part} data-side`).toBe(false);
        expect(e.attrs.transform, `${part} transform`).toBeUndefined();
      }
      const b = unionBox(inner);
      expect(boxInside(b, boxes[i]), `${part} ${i} ${JSON.stringify(b)} inside its box`).toBe(true);
      expect(boxDisjoint(b, FACE_FEATURE_BOX), `${part} ${i} clear of the face`).toBe(true);
      expect(boxDisjoint(b, CHEST_REGION), `${part} ${i} clear of the chest`).toBe(true);
    });
  }
}

/** Every data-side element is a direct child of <svg> and lies inside CHEST_REGION. */
function expectSideElementsInChest(els: Element[]): void {
  for (const e of els.filter((x) => 'data-side' in x.attrs)) {
    expect(e.ancestors[e.ancestors.length - 1].name).toBe('svg');
    expect(boxInside(shapeBox(e), CHEST_REGION), `${e.attrs['data-part']} ${e.attrs['data-side']} in chest`).toBe(true);
  }
}

/** Markup the Avatar must never contain (3.1, 3.33). */
const FORBIDDEN_MARKUP = ['<pattern', '<clipPath', '<mask', '<filter', '<defs', 'Gradient', ' id=', 'url('] as const;
const FORBIDDEN_ELEMENTS = ['pattern', 'clipPath', 'mask', 'filter', 'defs', 'linearGradient', 'radialGradient'] as const;

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

describe('StitchedPatient expressions', () => {
  const EXPRESSION_CASES: readonly [AvatarVariant, AvatarParameters['overallStatus'], Expression][] = [
    ['live', 'normal', 'calm'],
    ['live', 'warning', 'worried'],
    ['live', 'critical', 'alarmed'],
    ['rescued', 'normal', 'joyful'],
    ['rescued', 'critical', 'joyful'],
    ['lost', 'normal', 'sleepy'],
    ['lost', 'critical', 'sleepy'],
  ];
  /** One render per Expression. */
  const ONE_PER_EXPRESSION = EXPRESSION_CASES.filter((c, i, all) => all.findIndex((d) => d[2] === c[2]) === i);

  const renderFace = (variant: AvatarVariant, overallStatus: AvatarParameters['overallStatus'], skinTone: AvatarParameters['skinTone'] = 'healthy') =>
    parse(render({ variant, params: { overallStatus, skinTone } }));

  it.each(EXPRESSION_CASES)('%s with Overall_Status %s shows the %s face', (variant, overallStatus, expected) => {
    expect(expressionFor(overallStatus, variant)).toBe(expected);
    const els = renderFace(variant, overallStatus);
    const marked = els.filter((e) => 'data-expression' in e.attrs);
    expect(marked).toHaveLength(1);
    expect(marked[0].attrs['data-part']).toBe('face');
    expect(marked[0].attrs['data-expression']).toBe(expected);
    const face = within(els, 'face');
    for (const part of ['eyes', 'brows', 'mouth']) {
      expect(face.filter((e) => e.attrs['data-part'] === part)).toHaveLength(1);
    }
  });

  it.each(ONE_PER_EXPRESSION)('%s/%s (%s): no <line> in the face, tear and sparkles only where they belong', (variant, overallStatus, expression) => {
    const els = renderFace(variant, overallStatus);
    const face = within(els, 'face');
    expect(face.some((e) => e.name === 'line')).toBe(false);
    for (const e of within(els, 'eyes').concat(within(els, 'brows'))) {
      expect(['g', 'circle', 'ellipse', 'path']).toContain(e.name);
    }
    expect(els.filter((e) => e.attrs['data-part'] === 'tear')).toHaveLength(expression === 'sleepy' ? 1 : 0);
    expect(face.filter((e) => e.attrs['data-part'] === 'tear')).toHaveLength(expression === 'sleepy' ? 1 : 0);
    const sparkles = els.filter((e) => e.attrs['data-part'] === 'sparkle');
    expect(sparkles).toHaveLength(expression === 'joyful' ? 3 : 0);
    expect(within(els, 'face').filter((e) => e.attrs['data-part'] === 'sparkle')).toHaveLength(0);
  });

  it.each(ONE_PER_EXPRESSION)('%s/%s (%s): no cross-stitch centre inside an eye white', (variant, overallStatus) => {
    const els = renderFace(variant, overallStatus);
    const whites = els.filter((e) => e.attrs['data-part'] === 'eye-white').map(shapeBox);
    const centres = els
      .filter((e) => e.name === 'line' && e.ancestors.some((a) => a.attrs['data-part'] === 'stitch'))
      .map((l) => [(num(l, 'x1') + num(l, 'x2')) / 2, (num(l, 'y1') + num(l, 'y2')) / 2] as const);
    expect(centres.length).toBeGreaterThanOrEqual(3);
    for (const [x, y] of centres) {
      for (const w of whites) {
        expect(x >= w.minX && x <= w.maxX && y >= w.minY && y <= w.maxY, `stitch (${x}, ${y}) in an eye white`).toBe(false);
      }
    }
  });

  it('draws the alarmed eye whites at r 11, spanning y 59 to 81', () => {
    const whites = renderFace('live', 'critical').filter((e) => e.attrs['data-part'] === 'eye-white').map(shapeBox);
    expect(whites).toHaveLength(2);
    for (const w of whites) {
      expect(w.minY).toBe(59);
      expect(w.maxY).toBe(81);
    }
  });

  it.each(ONE_PER_EXPRESSION)('%s/%s (%s): exactly one lips element in the Skin_Tone lips colour', (variant, overallStatus) => {
    for (const tone of TONES) {
      const els = renderFace(variant, overallStatus, tone);
      const lips = els.filter((e) => e.attrs['data-part'] === 'lips');
      expect(lips, tone).toHaveLength(1);
      expect(lips[0].ancestors.some((a) => a.attrs['data-part'] === 'mouth')).toBe(true);
      const colour = SKIN_PALETTES[tone].lips;
      expect(lips[0].attrs.fill === colour || lips[0].attrs.stroke === colour, `${tone} lips colour`).toBe(true);
      if (lips[0].attrs.fill === 'none') expect(num(lips[0], 'stroke-width')).toBeGreaterThanOrEqual(2.5);
    }
  });

  it.each(ONE_PER_EXPRESSION)('%s/%s (%s): every eye, brow, mouth and tear shape lies inside FACE_FEATURE_BOX', (variant, overallStatus) => {
    const els = renderFace(variant, overallStatus);
    const shapes = within(els, 'face').filter((e) => e.name !== 'g');
    for (const part of ['eyes', 'brows', 'mouth']) expect(within(els, part).length).toBeGreaterThan(0);
    expect(shapes.length).toBeGreaterThan(0);
    for (const s of shapes) {
      const b = shapeBox(s);
      expect(boxInside(b, FACE_FEATURE_BOX), `<${s.name} ${JSON.stringify(s.attrs)}> ${JSON.stringify(b)}`).toBe(true);
    }
    expect(boxInside(unionBox(shapes), FACE_FEATURE_BOX)).toBe(true);
  });

  it.each(ONE_PER_EXPRESSION)('%s/%s (%s): no forehead Patch shape or stitch touches a brow', (variant, overallStatus) => {
    const els = renderFace(variant, overallStatus);
    const brows = within(els, 'brows').filter((e) => e.name !== 'g');
    expect(brows).toHaveLength(2);
    const forehead = els.filter((e) => e.attrs['data-part'] === 'patch' && e.attrs['data-patch'] === 'forehead');
    expect(forehead).toHaveLength(1);
    const blockers = [...descendants(els, forehead[0]), ...within(els, 'stitch')].filter((e) => e.name !== 'g');
    expect(blockers.length).toBeGreaterThan(0);
    for (const brow of brows) {
      const b = shapeBox(brow);
      const browBox: LayoutBox = { x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY };
      for (const s of blockers) {
        expect(boxDisjoint(shapeBox(s), browBox), `<${s.name} ${JSON.stringify(s.attrs)}> touches brow ${JSON.stringify(b)}`).toBe(true);
      }
    }
  });

  it('sleepy: the tear touches no stitch and no mouth shape, and lies inside FACE_FEATURE_BOX', () => {
    const els = renderFace('lost', 'normal');
    const tears = byPart(els, 'tear');
    expect(tears).toHaveLength(1);
    const t = shapeBox(tears[0]);
    expect(boxInside(t, FACE_FEATURE_BOX), `tear ${JSON.stringify(t)}`).toBe(true);
    const tearBox: LayoutBox = { x: t.minX, y: t.minY, width: t.maxX - t.minX, height: t.maxY - t.minY };
    const blockers = [...within(els, 'stitch'), ...within(els, 'mouth')].filter((e) => e.name !== 'g');
    expect(within(els, 'stitch').length).toBeGreaterThan(0);
    expect(within(els, 'mouth').length).toBeGreaterThan(0);
    for (const s of blockers) {
      expect(boxDisjoint(shapeBox(s), tearBox), `<${s.name} ${JSON.stringify(s.attrs)}> touches tear ${JSON.stringify(t)}`).toBe(true);
    }
  });
});

describe('StitchedPatient dress-up, motion and craft details', () => {
  /** One (variant, Overall_Status) per Expression. */
  const PER_EXPRESSION: readonly [AvatarVariant, AvatarParameters['overallStatus'], Expression][] = [
    ['live', 'normal', 'calm'],
    ['live', 'warning', 'worried'],
    ['live', 'critical', 'alarmed'],
    ['rescued', 'normal', 'joyful'],
    ['lost', 'normal', 'sleepy'],
  ];
  const SIDE_SETS: readonly Side[][] = [[], ['Left'], ['Right'], ['Left', 'Right']];

  it.each(PER_EXPRESSION)('%s/%s (%s): one hat, two bats and two sparks, clear of the face and chest', (variant, overallStatus, expression) => {
    for (const sides of SIDE_SETS) {
      const els = parse(render({ variant, params: { overallStatus, swollenSides: sides, decompressedSides: sides, sweating: true } }));
      expect(els.find((e) => 'data-expression' in e.attrs)?.attrs['data-expression']).toBe(expression);
      expectDressUpClear(els);
      expectSideElementsInChest(els);
    }
  });

  it.each([[['Left']], [['Right']], [['Left', 'Right']]] as const)(
    'celebrates once with decompressedSides %j: two bolts and the heart-hop group',
    (decompressedSides) => {
      for (const variant of VARIANTS) {
        const els = parse(render({ variant, params: { decompressedSides: [...decompressedSides] } }));
        const bolts = els.filter((e) => hasClass(e, 'sp-celebrate-bolt'));
        expect(bolts).toHaveLength(2);
        for (const b of bolts) expect(b.attrs['data-part']).toBe('bolt');
        const hops = els.filter((e) => hasClass(e, 'sp-celebrate-heart'));
        expect(hops).toHaveLength(1);
        expect(hops[0].attrs['data-part']).toBe('heart-hop');
        const hearts = descendants(els, hops[0]).filter((e) => e.attrs['data-part'] === 'heart');
        expect(hearts).toHaveLength(1);
        expect(hasClass(hearts[0], 'sp-beat')).toBe(true);
      }
    },
  );

  it('does not celebrate when no side is decompressed', () => {
    for (const variant of VARIANTS) {
      const html = render({ variant, params: { decompressedSides: [] } });
      expect(html).not.toContain('sp-celebrate-bolt');
      expect(html).not.toContain('sp-celebrate-heart');
      // The heart still beats inside the heart-hop group.
      const els = parse(html);
      const hop = byPart(els, 'heart-hop');
      expect(hop).toHaveLength(1);
      expect(descendants(els, hop[0]).filter((e) => e.attrs['data-part'] === 'heart')).toHaveLength(1);
    }
  });

  it.each(PER_EXPRESSION)('%s/%s (%s): sp-blink only on open eyes, sp-tilt unless lost, sparks and bats animated', (variant, overallStatus, expression) => {
    const els = parse(render({ variant, params: { overallStatus } }));
    const blinking = els.filter((e) => hasClass(e, 'sp-blink'));
    const open = expression === 'calm' || expression === 'worried' || expression === 'alarmed';
    expect(blinking).toHaveLength(open ? 1 : 0);
    if (open) expect(blinking[0].attrs['data-part']).toBe('eyes');

    const tilt = byPart(els, 'head-tilt');
    expect(tilt).toHaveLength(1);
    expect(hasClass(tilt[0], 'sp-tilt')).toBe(variant !== 'lost');
    expect(els.filter((e) => hasClass(e, 'sp-tilt'))).toHaveLength(variant !== 'lost' ? 1 : 0);

    expect(byPart(els, 'spark').map((e) => e.attrs.class)).toEqual(['sp-spark', 'sp-spark sp-spark-delay']);
    expect(byPart(els, 'bat').map((e) => e.attrs.class)).toEqual(['sp-bat', 'sp-bat sp-bat-delay']);
  });

  it('puts the head Patches, stitches, craft details, sweat, hat and sparkles inside the head-tilt group', () => {
    const els = parse(render({ variant: 'rescued', params: { sweating: true } }));
    const tilted = within(els, 'head-tilt');
    const patches = tilted.filter((e) => e.attrs['data-part'] === 'patch').map((e) => e.attrs['data-patch']);
    expect(patches).toEqual(['head', 'forehead', 'cheek']);
    for (const part of ['blush', 'freckle', 'sweat', 'hat', 'sparkle', 'stitch']) {
      expect(tilted.some((e) => e.attrs['data-part'] === part), part).toBe(true);
    }
    expect(byPart(els, 'plaster')).toHaveLength(0);
  });

  it.each(TONES)('draws the craft details with the %s blush colour', (skinTone) => {
    const els = parse(render({ params: { skinTone } }));
    const blush = byPart(els, 'blush');
    expect(blush).toHaveLength(2);
    for (const b of blush) expect(b.attrs.fill).toBe(SKIN_PALETTES[skinTone].blush);
    expect(byPart(els, 'freckle').length).toBeGreaterThanOrEqual(3);
    expect(byPart(els, 'plaster')).toHaveLength(0);

    // The fabric looks sit on the Quilt, each inside exactly one quilt patch's box, on no skin Patch.
    const quiltPatches = byPart(els, 'quilt-patch').map(shapeBox);
    for (const part of ['fabric-check', 'fabric-stripe']) {
      const look = byPart(els, part);
      expect(look, part).toHaveLength(1);
      expect(look[0].ancestors.some((a) => a.attrs['data-part'] === 'quilt'), `${part} in the quilt`).toBe(true);
      expect(look[0].ancestors.some((a) => a.attrs['data-part'] === 'patch'), `${part} on a skin Patch`).toBe(false);
      const lines = descendants(els, look[0]).filter((e) => e.name === 'line');
      expect(lines.length).toBeGreaterThan(0);
      const b = unionBox(lines);
      const holders = quiltPatches.filter(
        (q) => b.minX >= q.minX && b.maxX <= q.maxX && b.minY >= q.minY && b.maxY <= q.maxY,
      );
      expect(holders, `${part} ${JSON.stringify(b)} inside one quilt patch`).toHaveLength(1);
    }
  });

  it('keeps blush and freckles inside the head circle', () => {
    const els = parse(render());
    const shapes = [...byPart(els, 'blush'), ...byPart(els, 'freckle')];
    expect(shapes.length).toBeGreaterThanOrEqual(2 + 3);
    for (const s of shapes) {
      expect(insideHeadCircle(s), `<${s.name} ${JSON.stringify(s.attrs)}> inside the head`).toBe(true);
    }
  });

  it.each(VARIANTS)("has no pattern, clipPath, mask, filter, defs, gradient, id or url() for '%s'", (variant) => {
    const html = render({
      variant,
      speech: 'Hello.',
      params: { sweating: true, swollenSides: ['Left', 'Right'], decompressedSides: ['Left', 'Right'], overallStatus: 'critical' },
    });
    for (const s of FORBIDDEN_MARKUP) expect(html, s).not.toContain(s);
    for (const e of parse(html)) expect(FORBIDDEN_ELEMENTS).not.toContain(e.name);
  });
});

describe('StitchedPatient stylesheet', () => {
  const CSS = readFileSync(path.resolve(__dirname, '../app/globals.css'), 'utf8');
  const MEDIA = '@media (prefers-reduced-motion: reduce)';

  /** The `{ … }` block after `header`, found by brace matching, and the CSS without it. */
  function extractBlock(css: string, header: string): { block: string; rest: string } {
    const start = css.indexOf(header);
    if (start < 0) throw new Error(`${header} not found`);
    const open = css.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) return { block: css.slice(open + 1, i), rest: css.slice(0, start) + css.slice(i + 1) };
      }
    }
    throw new Error(`${header} block is not closed`);
  }

  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** Body of the rule whose selector is exactly `selector`, or undefined. */
  function ruleBody(css: string, selector: string): string | undefined {
    return new RegExp(`(?:^|[\\s}])${escapeRe(selector)}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
  }

  it('stops every Avatar animation under prefers-reduced-motion', () => {
    const { block } = extractBlock(CSS, MEDIA);
    expect(block).toContain('.sp-avatar *');
    expect(block).toMatch(/\.sp-avatar \*[^{]*\{[^}]*animation:\s*none\s*!important/);
  });

  it('defines the idle-motion and celebration rules outside the media block, celebrations once', () => {
    const { rest } = extractBlock(CSS, MEDIA);
    for (const cls of ['.sp-blink', '.sp-tilt', '.sp-spark', '.sp-bat', '.sp-celebrate-bolt', '.sp-celebrate-heart']) {
      expect(ruleBody(rest, cls), cls).toBeDefined();
    }
    for (const cls of ['.sp-celebrate-bolt', '.sp-celebrate-heart']) {
      expect(ruleBody(rest, cls)).toMatch(/animation-iteration-count:\s*1\s*;/);
    }
  });

  it('has a rule for every sp- class the Avatar uses', () => {
    const used = new Set<string>();
    for (const variant of VARIANTS) {
      for (const overallStatus of ['normal', 'warning', 'critical'] as const) {
        for (const sides of [[], ['Left', 'Right']] as Side[][]) {
          for (const stopped of [false, true]) {
            const html = render({
              variant,
              params: {
                overallStatus,
                decompressedSides: sides,
                swollenSides: sides,
                sweating: !stopped,
                breathing: { stopped, periodS: 4, depth: 1 },
                heartbeat: { stopped, periodS: 1 },
              },
            });
            for (const e of parse(html)) {
              for (const c of (e.attrs.class ?? '').split(' ')) if (c.startsWith('sp-')) used.add(c);
            }
          }
        }
      }
    }
    for (const c of ['sp-blink', 'sp-tilt', 'sp-spark', 'sp-spark-delay', 'sp-bat', 'sp-bat-delay', 'sp-celebrate-bolt', 'sp-celebrate-heart']) {
      expect(used.has(c), c).toBe(true);
    }
    for (const c of used) expect(CSS, c).toMatch(new RegExp(`\\.${escapeRe(c)}(?![\\w-])`));
  });
});

// Cohesive redraw checks (Requirements 3.34 to 3.56, 12.16, Property 23).

/**
 * Vertices of a shape: the end point of each command of an absolute
 * M/L/H/V/Q/C/Z path (control points skipped), or the points of a polygon.
 */
function vertices(el: Element): [number, number][] {
  if (el.name === 'polygon' || el.name === 'polyline') {
    const v = (el.attrs.points ?? '').trim().split(/[\s,]+/).map(Number);
    if (v.length < 2 || v.length % 2 !== 0 || v.some((n) => !Number.isFinite(n))) throw new Error(`bad points on <${el.name}>`);
    const pts: [number, number][] = [];
    for (let k = 0; k < v.length; k += 2) pts.push([v[k], v[k + 1]]);
    return pts;
  }
  if (el.name !== 'path') throw new Error(`no vertex reader for <${el.name}>`);
  const d = el.attrs.d ?? '';
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
  const out: [number, number][] = [];
  let cmd = '';
  let cur: [number, number] = [0, 0];
  let i = 0;
  const next = (): number => {
    const v = Number(tokens[i++]);
    if (!Number.isFinite(v)) throw new Error(`bad path data: ${d}`);
    return v;
  };
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) {
      cmd = tokens[i++];
      if (cmd === 'Z') continue;
    }
    if (cmd === 'H') cur = [next(), cur[1]];
    else if (cmd === 'V') cur = [cur[0], next()];
    else if (cmd === 'M' || cmd === 'L') cur = [next(), next()];
    else if (cmd === 'Q') {
      next();
      next();
      cur = [next(), next()];
    } else if (cmd === 'C') {
      for (let k = 0; k < 4; k += 1) next();
      cur = [next(), next()];
    } else throw new Error(`unsupported path command ${cmd} in ${d}`);
    out.push(cur);
  }
  return out;
}

/** Relative luminance of a #RRGGBB colour (WCAG 2.2). */
function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a hex colour: ${hex}`);
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function asLayout(b: BBox): LayoutBox {
  return { x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY };
}

/** Direct children of one parsed element. */
function childrenOf(els: Element[], group: Element): Element[] {
  return els.filter((e) => e.ancestors[e.ancestors.length - 1]?.attrs === group.attrs);
}

/** Box of a group (or a single shape) and every shape inside it. */
function groupBox(els: Element[], group: Element): BBox {
  return unionBox([group, ...descendants(els, group)]);
}

function svgOf(els: Element[]): Element {
  const svgs = els.filter((e) => e.name === 'svg');
  expect(svgs).toHaveLength(1);
  return svgs[0];
}

function only(els: Element[], part: string): Element {
  const found = byPart(els, part);
  expect(found, part).toHaveLength(1);
  return found[0];
}

function halfOf(b: BBox): 'viewer-left' | 'viewer-right' | 'both' {
  if (b.maxX <= 100) return 'viewer-left';
  if (b.minX >= 100) return 'viewer-right';
  return 'both';
}

const describeEl = (e: Element) => `<${e.name} ${JSON.stringify(e.attrs)}>`;

/** Parts whose strokes (with their descendants') keep their own colour and width (3.34). */
const OUTLINE_EXEMPT_PARTS = new Set([
  'face',
  'seam',
  'stitch',
  'heart',
  'fabric-check',
  'fabric-stripe',
  'spark',
  'sparkle',
  'iv-tube',
  'sweat',
]);
const outlineExempt = (n: { attrs: Record<string, string> }) =>
  'data-side' in n.attrs || OUTLINE_EXEMPT_PARTS.has(n.attrs['data-part'] ?? '');

const SCENE_ORDER = ['window', 'moon', 'bat', 'bat', 'iv-pole', 'iv-bag', 'iv-tube', 'headboard', 'pillow'];
const SKIN_PATCH_NAMES = ['cheek', 'forehead', 'hands', 'head'];

interface CohesionCase {
  label: string;
  params: AvatarParameters;
  variant: AvatarVariant;
  expression: Expression;
  els: Element[];
}

function cohesionCase(params: AvatarParameters, variant: AvatarVariant, label: string): CohesionCase {
  return {
    label,
    params,
    variant,
    expression: EXPECTED_EXPRESSION[variant][params.overallStatus],
    els: parse(renderToStaticMarkup(<StitchedPatient params={params} statusSentence="Status." variant={variant} />)),
  };
}

/** One check per rule group of Requirement 12.16; Property 23 runs all of them. */
const COHESION_RULES: Record<string, (c: CohesionCase) => void> = {
  'one outline style and round joins and caps (3.34)': ({ els }) => {
    const svg = svgOf(els);
    expect(svg.attrs['stroke-linejoin']).toBe('round');
    expect(svg.attrs['stroke-linecap']).toBe('round');
    let outlined = 0;
    for (const e of descendants(els, svg)) {
      for (const k of ['stroke-linejoin', 'stroke-linecap']) {
        if (k in e.attrs) expect(e.attrs[k], `${k} on ${describeEl(e)}`).toBe('round');
      }
      const stroke = e.attrs.stroke;
      if (stroke === undefined || stroke === 'none') continue;
      if (outlineExempt(e) || e.ancestors.some(outlineExempt)) continue;
      outlined += 1;
      expect(stroke, describeEl(e)).toBe(OUTLINE_COLOUR);
      expect(Number(e.attrs['stroke-width']), describeEl(e)).toBe(OUTLINE_WIDTH);
    }
    expect(outlined).toBeGreaterThan(0);
  },

  'scene group first, holding its parts in order (3.35)': ({ els }) => {
    const scene = only(els, 'scene');
    expect(scene.name).toBe('g');
    expect(childrenOf(els, svgOf(els))[0]?.attrs, 'first child of <svg>').toBe(scene.attrs);
    const parts = childrenOf(els, scene)
      .map((e) => e.attrs['data-part'])
      .filter((p): p is string => p !== undefined && SCENE_ORDER.includes(p));
    expect(parts).toEqual(SCENE_ORDER);
    for (const p of new Set(SCENE_ORDER)) {
      for (const e of byPart(els, p)) expect(e.ancestors.some((a) => a.attrs === scene.attrs), `${p} in the scene`).toBe(true);
    }
  },

  'quilt group after the character and before the hands, with patches, seams, stitches and fabrics (3.29, 3.36, 3.37)': ({ els }) => {
    const quilt = only(els, 'quilt');
    expect(quilt.name).toBe('g');
    const kids = childrenOf(els, svgOf(els));
    const qi = kids.findIndex((k) => k.attrs === quilt.attrs);
    expect(qi, 'quilt is a direct child of <svg>').toBeGreaterThanOrEqual(0);
    const at = els.indexOf(quilt);
    const before = [only(els, 'torso'), only(els, 'head-tilt'), only(els, 'heart-hop'), ...els.filter((e) => 'data-side' in e.attrs)];
    for (const e of before) expect(els.indexOf(e), `${describeEl(e)} before the quilt`).toBeLessThan(at);
    const after = kids.slice(qi + 1);
    expect(after).toHaveLength(1);
    expect(after[0].attrs['data-part']).toBe('patch');
    expect(after[0].attrs['data-patch']).toBe('hands');
    expect(byPart(descendants(els, after[0]), 'arm')).toHaveLength(2);

    const inQuilt = descendants(els, quilt);
    const patches = byPart(inQuilt, 'quilt-patch');
    expect(patches.length).toBeGreaterThanOrEqual(4);
    expect(byPart(inQuilt, 'seam').length).toBeGreaterThanOrEqual(1);
    expect(byPart(inQuilt, 'stitch').length).toBeGreaterThanOrEqual(2);
    const patchBoxes = patches.map((p) => asLayout(groupBox(els, p)));
    for (const part of ['fabric-check', 'fabric-stripe']) {
      const look = only(els, part);
      expect(look.ancestors.some((a) => a.attrs === quilt.attrs), `${part} in the quilt`).toBe(true);
      expect(look.ancestors.some((a) => a.attrs['data-part'] === 'patch'), `${part} on a skin piece`).toBe(false);
      const b = groupBox(els, look);
      expect(patchBoxes.some((q) => boxInside(b, q)), `${part} ${JSON.stringify(b)} inside one quilt patch`).toBe(true);
    }
    expect(byPart(els, 'plaster')).toHaveLength(0);
  },

  'no scene shape over the face (3.38)': ({ els }) => {
    const shapes = within(els, 'scene').filter((e) => e.name !== 'g');
    expect(shapes.length).toBeGreaterThan(0);
    for (const s of shapes) expect(boxDisjoint(shapeBox(s), FACE_FEATURE_BOX), describeEl(s)).toBe(true);
  },

  'quilt top below the chest region (3.39)': ({ els }) => {
    const top = groupBox(els, only(els, 'quilt')).minY;
    expect(top).toBeGreaterThan(CHEST_REGION.y + CHEST_REGION.height);
  },

  'window, moon and bats inside the window region, bats in front of the moon (3.40, 3.54)': ({ els }) => {
    expect(WINDOW_BOX.x + WINDOW_BOX.width).toBeLessThanOrEqual(100);
    expect(WINDOW_BOX.y + WINDOW_BOX.height).toBeLessThan(CHEST_REGION.y);
    const moon = only(els, 'moon');
    const moonBox = groupBox(els, moon);
    expect(boxInside(groupBox(els, only(els, 'window')), WINDOW_BOX), 'window').toBe(true);
    expect(boxInside(moonBox, WINDOW_BOX), 'moon').toBe(true);
    const bats = byPart(els, 'bat');
    expect(bats).toHaveLength(2);
    for (const bat of bats) {
      const b = groupBox(els, bat);
      expect(boxInside(b, WINDOW_BOX), `bat ${JSON.stringify(b)} in the window`).toBe(true);
      expect(els.indexOf(bat)).toBeGreaterThan(els.indexOf(moon));
      expect(boxDisjoint(b, asLayout(moonBox)), `bat ${JSON.stringify(b)} over the moon`).toBe(false);
    }
  },

  'IV parts inside IV_BOX, clear of the torso, head and hands (3.41)': ({ els }) => {
    expect(IV_BOX.x).toBeGreaterThanOrEqual(100);
    for (const part of ['iv-pole', 'iv-bag', 'iv-tube']) {
      const b = groupBox(els, only(els, part));
      expect(boxInside(b, IV_BOX), `${part} ${JSON.stringify(b)}`).toBe(true);
    }
    const hands = els.filter((e) => e.attrs['data-part'] === 'patch' && e.attrs['data-patch'] === 'hands');
    expect(hands).toHaveLength(1);
    for (const group of [only(els, 'torso'), only(els, 'head-tilt'), hands[0]]) {
      const b = groupBox(els, group);
      expect(boxDisjoint(b, IV_BOX), `${describeEl(group)} ${JSON.stringify(b)} clear of IV_BOX`).toBe(true);
    }
  },

  'head circle at least 70 across (3.42)': ({ els }) => {
    const head = only(els, 'head');
    expect(head.name).toBe('circle');
    expect(2 * num(head, 'r')).toBeGreaterThanOrEqual(70);
  },

  'hat sits on the head, hair shows below the brim (3.43, 3.44)': ({ els }) => {
    const head = only(els, 'head');
    const [cy, r] = [num(head, 'cy'), num(head, 'r')];
    const hat = groupBox(els, only(els, 'hat'));
    expect(hat.maxY, 'hat above the head centre').toBeLessThan(cy);
    expect(hat.maxY, 'hat bottom 8 below the head top').toBeGreaterThanOrEqual(cy - r + 8);
    const locks = byPart(els, 'hair-lock');
    expect(locks.length).toBeGreaterThanOrEqual(6);
    const boxes = locks.map((l) => groupBox(els, l));
    for (const b of boxes) expect(boxDisjoint(b, FACE_FEATURE_BOX), `hair lock ${JSON.stringify(b)}`).toBe(true);
    expect(boxes.some((b) => b.maxY > hat.maxY), 'a lock below the brim').toBe(true);
  },

  'arms join the sleeves with a stitched seam, mittens on the quilt, clear of the chest (3.45, 3.46)': ({ els }) => {
    const arms = byPart(els, 'arm');
    expect(arms).toHaveLength(2);
    expect(arms.map((a) => halfOf(groupBox(els, a))).sort()).toEqual(['viewer-left', 'viewer-right']);
    const gowns = byPart(els, 'gown');
    const quiltBox = asLayout(groupBox(els, only(els, 'quilt')));
    const sideBoxes = els.filter((e) => 'data-side' in e.attrs).map((e) => asLayout(shapeBox(e)));
    expect(sideBoxes.length).toBeGreaterThanOrEqual(2);
    for (const arm of arms) {
      const half = halfOf(groupBox(els, arm));
      const gown = gowns.filter((g) => halfOf(shapeBox(g)) === half);
      expect(gown, `gown panel in the ${half} half`).toHaveLength(1);
      const gownVertices = vertices(gown[0]);
      const shapes = childrenOf(els, arm).filter((e) => e.name !== 'g' && e.attrs['data-part'] !== 'seam');
      const joined = shapes.some(
        (s) => vertices(s).filter(([x, y]) => gownVertices.some(([gx, gy]) => Math.hypot(x - gx, y - gy) <= 0.5)).length >= 2,
      );
      expect(joined, `${half} arm shares two vertices with its gown panel`).toBe(true);

      const inside = descendants(els, arm);
      const seams = byPart(inside, 'seam').map((s) => groupBox(els, s));
      const stitches = byPart(inside, 'stitch').map((s) => groupBox(els, s));
      expect(seams.length, `${half} arm seam`).toBeGreaterThanOrEqual(1);
      const onSeam = stitches.some((st) => {
        const [x, y] = [(st.minX + st.maxX) / 2, (st.minY + st.maxY) / 2];
        return seams.some((s) => x >= s.minX - 0.5 && x <= s.maxX + 0.5 && y >= s.minY - 0.5 && y <= s.maxY + 0.5);
      });
      expect(onSeam, `${half} arm stitch on its seam`).toBe(true);

      const mittens = byPart(inside, 'mitten');
      expect(mittens).toHaveLength(1);
      expect(boxDisjoint(groupBox(els, mittens[0]), quiltBox), `${half} mitten on the quilt`).toBe(false);

      for (const s of inside.filter((e) => e.name !== 'g')) {
        for (const sb of sideBoxes) expect(boxDisjoint(shapeBox(s), sb), `${describeEl(s)} over ${JSON.stringify(sb)}`).toBe(true);
      }
    }
  },

  'flat shading in the skin, gown and quilt shade colours (3.47)': ({ els, params }) => {
    const skinShade = SKIN_PALETTES[params.skinTone].shade;
    const shades = byPart(els, 'shade');
    for (const s of shades) {
      expect(s.attrs.stroke === undefined || s.attrs.stroke === 'none', `${describeEl(s)} has no stroke`).toBe(true);
      expect(Object.keys(s.attrs).filter((k) => k.includes('opacity')), describeEl(s)).toEqual([]);
      expect(s.attrs.style ?? '', describeEl(s)).not.toContain('opacity');
      expect([skinShade, GOWN_SHADE, QUILT_SHADE], describeEl(s)).toContain(s.attrs.fill);
    }
    const shadesIn = (part: string, fill: string) => byPart(within(els, part), 'shade').filter((s) => s.attrs.fill === fill);
    expect(shadesIn('head-tilt', skinShade).length).toBeGreaterThanOrEqual(3);
    expect(shadesIn('torso', GOWN_SHADE).length).toBeGreaterThanOrEqual(1);
    expect(shadesIn('quilt', QUILT_SHADE).length).toBeGreaterThanOrEqual(1);
  },

  'open eyes have an iris, a pupil and a highlight (3.49)': ({ els, expression }) => {
    if (expression !== 'calm' && expression !== 'worried' && expression !== 'alarmed') return;
    const circle = (e: Element) => {
      expect(e.name, describeEl(e)).toBe('circle');
      return { x: num(e, 'cx'), y: num(e, 'cy'), r: num(e, 'r') };
    };
    const eyes = byPart(els, 'eye');
    expect(eyes).toHaveLength(2);
    for (const eye of eyes) {
      const inner = descendants(els, eye);
      const white = circle(only(inner, 'eye-white'));
      const iris = circle(only(inner, 'iris'));
      const pupil = circle(only(inner, 'pupil'));
      const glint = circle(only(inner, 'eye-highlight'));
      expect(Math.hypot(iris.x - white.x, iris.y - white.y) + iris.r, 'iris inside the white').toBeLessThanOrEqual(white.r);
      expect(Math.hypot(pupil.x - iris.x, pupil.y - iris.y) + pupil.r, 'pupil inside the iris').toBeLessThanOrEqual(iris.r);
      expect(Math.hypot(glint.x - iris.x, glint.y - iris.y), 'highlight centre inside the iris').toBeLessThan(iris.r);
    }
  },

  'triangle nose inside the face region, clear of eyes and lips (3.50)': ({ els }) => {
    const face = descendants(els, only(els, 'face'));
    const nose = only(face, 'nose');
    expect(only(els, 'nose')).toBe(nose);
    expect(nose.name).toBe('polygon');
    expect(vertices(nose)).toHaveLength(3);
    const b = shapeBox(nose);
    expect(boxInside(b, FACE_FEATURE_BOX), `nose ${JSON.stringify(b)}`).toBe(true);
    for (const e of [...byPart(face, 'eye-white'), only(face, 'lips')]) {
      expect(boxDisjoint(b, asLayout(shapeBox(e))), `nose clear of ${describeEl(e)}`).toBe(true);
    }
  },

  'two open gown panels with print dots (3.51, 3.52)': ({ els }) => {
    const gowns = byPart(els, 'gown');
    expect(gowns).toHaveLength(2);
    const torso = only(els, 'torso');
    for (const g of gowns) expect(g.ancestors.some((a) => a.attrs === torso.attrs), 'gown in the torso').toBe(true);
    const boxes = gowns.map((g) => groupBox(els, g));
    expect(boxes.map(halfOf).sort()).toEqual(['viewer-left', 'viewer-right']);
    for (const b of boxes) expect(boxDisjoint(b, GOWN_OPENING), `gown ${JSON.stringify(b)} clear of the opening`).toBe(true);
    const dots = byPart(els, 'gown-dot');
    expect(dots.length).toBeGreaterThanOrEqual(6);
    for (const d of dots) {
      expect(d.name).toBe('circle');
      expect(d.attrs.fill, describeEl(d)).toBeDefined();
      expect(d.attrs.fill).not.toBe('none');
      expect(d.attrs.stroke === undefined || d.attrs.stroke === 'none', describeEl(d)).toBe(true);
      const [x, y] = [num(d, 'cx'), num(d, 'cy')];
      expect(boxes.some((b) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY), `${describeEl(d)} on a gown panel`).toBe(true);
    }
  },

  'chest halves in a skin patch colour (3.53)': ({ els, params }) => {
    for (const side of SIDES) {
      const chests = els.filter(
        (e) => e.attrs['data-side'] === side && (e.attrs['data-part'] === 'chest' || e.attrs['data-part'] === 'chest-swollen'),
      );
      expect(chests).toHaveLength(1);
      expect(SKIN_PALETTES[params.skinTone].patches, `${side} chest fill`).toContain(chests[0].attrs.fill);
    }
  },

  'muted scene and quilt fills (3.55)': ({ els }) => {
    const limit = Math.min(...SKIN_PALETTES.healthy.patches.map(relativeLuminance));
    const filled = [only(els, 'scene'), only(els, 'quilt')]
      .flatMap((g) => [g, ...descendants(els, g)])
      .filter((e) => e.attrs.fill !== undefined && e.attrs.fill !== 'none');
    expect(filled.length).toBeGreaterThan(0);
    for (const e of filled) {
      expect(relativeLuminance(e.attrs.fill), `${describeEl(e)} luminance`).toBeLessThanOrEqual(limit);
    }
  },

  'sp-unstitch only on the four skin pieces and only when lost (3.56)': ({ els, variant }) => {
    const unstitched = els.filter((e) => hasClass(e, 'sp-unstitch'));
    if (variant !== 'lost') {
      expect(unstitched).toHaveLength(0);
      return;
    }
    for (const e of unstitched) {
      expect(e.attrs['data-part'], describeEl(e)).toBe('patch');
      for (const part of ['scene', 'torso', 'quilt']) {
        expect(e.ancestors.some((a) => a.attrs['data-part'] === part), `${describeEl(e)} inside ${part}`).toBe(false);
      }
    }
    expect(unstitched.map((e) => e.attrs['data-patch']).sort()).toEqual(SKIN_PATCH_NAMES);
  },
};

describe('StitchedPatient cohesive illustration (12.16)', () => {
  /** One (variant, Overall_Status) per Expression. */
  const PER_EXPRESSION: readonly [AvatarVariant, AvatarParameters['overallStatus']][] = [
    ['live', 'normal'],
    ['live', 'warning'],
    ['live', 'critical'],
    ['rescued', 'normal'],
    ['lost', 'normal'],
  ];
  const CHESTS: readonly [string, Partial<AvatarParameters>][] = [
    ['normal chest', { swollenSides: [], decompressedSides: [] }],
    ['normal chest, decompressed', { swollenSides: [], decompressedSides: ['Left', 'Right'], sweating: true }],
    ['swollen chest', { swollenSides: ['Left', 'Right'], decompressedSides: ['Left', 'Right'], sweating: true }],
  ];
  const CASES: CohesionCase[] = TONES.flatMap((skinTone) =>
    PER_EXPRESSION.flatMap(([variant, overallStatus]) =>
      CHESTS.map(([chest, extra]) =>
        cohesionCase({ ...BASE, skinTone, overallStatus, ...extra }, variant, `${skinTone}/${variant}/${overallStatus}/${chest}`),
      ),
    ),
  );

  it('covers every Skin_Tone, every Expression and both chest geometries', () => {
    expect(new Set(CASES.map((c) => c.params.skinTone))).toEqual(new Set(TONES));
    expect(new Set(CASES.map((c) => c.expression))).toEqual(new Set(['calm', 'worried', 'alarmed', 'joyful', 'sleepy']));
    expect(new Set(CASES.map((c) => c.params.swollenSides.length))).toEqual(new Set([0, 2]));
  });

  it.each(Object.keys(COHESION_RULES))('%s', (rule) => {
    for (const c of CASES) {
      try {
        COHESION_RULES[rule](c);
      } catch (err) {
        throw new Error(`${c.label}: ${(err as Error).message}`);
      }
    }
  });

  it.each(TONES)('the %s shade is darker than every patch colour of that tone (3.48)', (tone) => {
    const { shade, patches } = SKIN_PALETTES[tone];
    for (const p of patches) expect(relativeLuminance(shade), `${shade} vs ${p}`).toBeLessThan(relativeLuminance(p));
  });
});

describe('StitchedPatient properties', () => {
  // Feature: play-mode, Property 8: Patient's Left is drawn on the viewer's right
  /** **Validates: Requirements 3.7, 4.17, 4.23** */
  it("Property 8: Patient's Left is drawn on the viewer's right", () => {
    fc.assert(
      fc.property(arbAvatarParameters, arbVariant, (params, variant) => {
        const html = renderToStaticMarkup(<StitchedPatient params={params} statusSentence="Status." variant={variant} />);
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
          <StitchedPatient params={{ ...params, swollenSides: ['Left', 'Right'] }} statusSentence="Status." variant={variant} />,
        );
        const swollenNone = renderToStaticMarkup(
          <StitchedPatient params={{ ...params, swollenSides: [] }} statusSentence="Status." variant={variant} />,
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
  const FORBIDDEN_TEXT = /<image|href|url\(|\sid=|gradient/i;
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
          for (const s of FORBIDDEN_MARKUP) expect(html).not.toContain(s);
          for (const e of els) {
            expect(e.name).not.toBe('image');
            expect(FORBIDDEN_ELEMENTS).not.toContain(e.name);
            expect(e.attrs.id).toBeUndefined();
          }

          const again = renderToStaticMarkup(<StitchedPatient {...structuredClone(props)} />);
          expect(again).toBe(html);
        },
      ),
      PBT_PARAMS,
    );
  });

  // Feature: play-mode, Property 22: The Avatar's Expression and dress-up follow its props and keep clear of the face and chest
  /** **Validates: Requirements 3.13, 3.14, 3.15, 3.16, 3.17, 3.18, 3.19, 3.20, 3.21, 3.22, 3.23, 3.24, 3.26, 3.27, 3.33** */
  it("Property 22: The Avatar's Expression and dress-up follow its props and keep clear of the face and chest", () => {
    fc.assert(
      fc.property(arbAvatarParameters, arbVariant, (params, variant) => {
        const els = parse(renderToStaticMarkup(<StitchedPatient params={params} statusSentence="Status." variant={variant} />));
        const expected = EXPECTED_EXPRESSION[variant][params.overallStatus];

        // Exactly one Expression marker, on the face group, with the expected value.
        const marked = els.filter((e) => 'data-expression' in e.attrs);
        expect(marked).toHaveLength(1);
        expect(marked[0].attrs['data-part']).toBe('face');
        expect(marked[0].attrs['data-expression']).toBe(expected);

        // Face: no <line>, a tear only when sleepy, one lips element in the Skin_Tone colour.
        const face = descendants(els, marked[0]);
        expect(face.some((e) => e.name === 'line')).toBe(false);
        expect(face.filter((e) => e.attrs['data-part'] === 'tear')).toHaveLength(expected === 'sleepy' ? 1 : 0);
        const lips = face.filter((e) => e.attrs['data-part'] === 'lips');
        expect(lips).toHaveLength(1);
        const lipsColour = SKIN_PALETTES[params.skinTone].lips;
        expect(lips[0].attrs.fill === lipsColour || lips[0].attrs.stroke === lipsColour).toBe(true);

        // Every eye, brow, mouth and tear shape lies inside FACE_FEATURE_BOX.
        const faceShapes = face.filter((e) => e.name !== 'g');
        expect(faceShapes.length).toBeGreaterThan(0);
        for (const s of faceShapes) expect(boxInside(shapeBox(s), FACE_FEATURE_BOX)).toBe(true);

        // Idle motions.
        const eyes = byPart(els, 'eyes');
        expect(eyes).toHaveLength(1);
        expect(hasClass(eyes[0], 'sp-blink')).toBe(expected === 'calm' || expected === 'worried' || expected === 'alarmed');
        const tilt = byPart(els, 'head-tilt');
        expect(tilt).toHaveLength(1);
        expect(hasClass(tilt[0], 'sp-tilt')).toBe(variant !== 'lost');

        // Dress-up counts, no data-side, inside the design boxes, clear of face and chest.
        expectDressUpClear(els);

        // Side elements: direct children of <svg>, inside CHEST_REGION.
        expectSideElementsInChest(els);

        // One-time celebration classes.
        const celebrate = params.decompressedSides.length > 0;
        expect(els.filter((e) => hasClass(e, 'sp-celebrate-bolt'))).toHaveLength(celebrate ? 2 : 0);
        expect(els.filter((e) => hasClass(e, 'sp-celebrate-heart'))).toHaveLength(celebrate ? 1 : 0);
      }),
      PBT_PARAMS,
    );
  });

  // Feature: play-mode, Property 23: The Avatar is one cohesive illustration
  /** **Validates: Requirements 3.2, 3.20, 3.29, 3.34, 3.35, 3.36, 3.37, 3.38, 3.39, 3.40, 3.41, 3.42, 3.43, 3.44, 3.45, 3.46, 3.47, 3.49, 3.50, 3.51, 3.52, 3.53, 3.54, 3.55, 3.56** */
  it('Property 23: The Avatar is one cohesive illustration', () => {
    fc.assert(
      fc.property(arbAvatarParameters, arbVariant, (params, variant) => {
        const c = cohesionCase(params, variant, `${params.skinTone}/${variant}/${params.overallStatus}`);
        for (const [rule, check] of Object.entries(COHESION_RULES)) {
          try {
            check(c);
          } catch (err) {
            throw new Error(`${rule}: ${(err as Error).message}`);
          }
        }
      }),
      PBT_PARAMS,
    );
  });
});
