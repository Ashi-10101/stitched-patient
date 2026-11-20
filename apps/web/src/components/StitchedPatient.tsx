/**
 * Stitched patient Avatar (play-mode Requirement 3, design "Stitched patient
 * Avatar").
 *
 * A pure function of its props: identical props give identical markup (3.12).
 * The drawing is one inline SVG with flat fills only. It has no ids, <defs>,
 * gradients, masks, filters, <image> elements, hrefs or url() references,
 * because two Avatars can be on screen at once (Play_View and Ending_Screen)
 * and ids would collide (3.1).
 *
 * The artwork is original and drawn for this project only (3.5): a small
 * round-headed patchwork person with cross-stitched skin patches, two neck
 * bolts, a light blue gown and a stitched-heart patch. No blood, wounds,
 * bone, fangs or skulls; the skin is never green and the head is never flat
 * (3.4, 3.6).
 *
 * Side-specific elements (chest halves, needle, bandage) take their
 * coordinates from `sideGeometry` as plain attributes and sit outside every
 * animated or transformed group, so the patient's Left stays in the viewer's
 * right half (3.7, 4.17, 4.23).
 */
import type { CSSProperties, ReactNode } from 'react';
import { sideGeometry } from '@/lib/sides';
import type { AlarmState, AvatarParameters, Side, VitalBand } from '@/types';

export interface StitchedPatientProps {
  params: AvatarParameters;
  /** Accessible name of the SVG (3.8). */
  statusSentence: string;
  /** Speech_Bubble_Slot; empty for this spec. */
  speech?: string;
  variant?: 'live' | 'rescued' | 'lost';
}

type SkinTone = AvatarParameters['skinTone'];

export interface SkinPalette {
  /** One fill per skin patch: head, forehead, cheek, hands. */
  patches: readonly [string, string, string, string];
  lips: string;
  /** Cheek blush; faint when pale or cyanotic so it does not hide the Skin_Tone cue (3.29). */
  blush: string;
}

/** Skin_Tone fills (design palette table). UI constants, not clinical values. */
export const SKIN_PALETTES: Record<SkinTone, SkinPalette> = {
  // Warm peach tones, rose lips.
  healthy: { patches: ['#F6C9A8', '#EFB48F', '#F9D7BC', '#E8A985'], lips: '#D9667A', blush: '#F59AB0' },
  // Desaturated beige-grey tones, pale pink lips.
  pale: { patches: ['#D8CEC4', '#CBBFB3', '#E2DAD2', '#C2B5A8'], lips: '#E8B4BC', blush: '#E9C9CF' },
  // The pale tones with blue lips.
  cyanotic: { patches: ['#D8CEC4', '#CBBFB3', '#E2DAD2', '#C2B5A8'], lips: '#5B7BD5', blush: '#E9C9CF' },
};

/** Other drawing colours. */
export const AVATAR_COLOURS = {
  gown: '#A9D6F5',
  chestHalf: '#93C5EA',
  seam: '#6B4A3A',
  hair: '#5A3A29',
  bolt: '#9A98A8',
  eyeWhite: '#FFFFFF',
  pupil: '#2E1A47',
  heart: '#F48FB1',
  sweat: '#BFE6FF',
  sweatOutline: '#6FA8DC',
  needle: '#6B6B7B',
  bandage: '#FFF7EC',
  swollenOutline: '#FF7A1A',
} as const;

export type AvatarVariant = NonNullable<StitchedPatientProps['variant']>;

export type Expression = 'calm' | 'worried' | 'alarmed' | 'joyful' | 'sleepy';

/**
 * Face Expression (3.14–3.18). The variant wins over the Overall_Status:
 * `rescued` is always joyful and `lost` always sleepy.
 */
export function expressionFor(overallStatus: AlarmState, variant: AvatarVariant): Expression {
  if (variant === 'rescued') return 'joyful';
  if (variant === 'lost') return 'sleepy';
  if (overallStatus === 'critical') return 'alarmed';
  if (overallStatus === 'warning') return 'worried';
  return 'calm';
}

/** An axis-aligned box in viewBox units; it covers x..x+width and y..y+height inclusive. */
export interface LayoutBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// Layout constants (design "Expressions and dress-up"). UI constants, not clinical values.

/** Face_Feature_Region: eyes, brows, mouth and tear of every Expression (x 72–128, y 52–100). */
export const FACE_FEATURE_BOX: LayoutBox = { x: 72, y: 52, width: 56, height: 48 };
/** Chest_Region: chest halves, swollen outlines, needles and bandages (x 40–160, y 112–184). */
export const CHEST_REGION: LayoutBox = { x: 40, y: 112, width: 120, height: 72 };
/** Pumpkin hat (x 100–148, y 0–34). */
export const HAT_BOX: LayoutBox = { x: 100, y: 0, width: 48, height: 34 };
/** Bats: viewer's upper left (x 6–40, y 8–30) and viewer's right beside the head (x 158–194, y 62–86). */
export const BAT_BOXES: readonly [LayoutBox, LayoutBox] = [
  { x: 6, y: 8, width: 34, height: 22 },
  { x: 158, y: 62, width: 36, height: 24 },
];
/** Bolt sparks: viewer's-left bolt (x 64–77) and viewer's-right bolt (x 123–136), y 101–111. */
export const SPARK_BOXES: readonly [LayoutBox, LayoutBox] = [
  { x: 64, y: 101, width: 13, height: 10 },
  { x: 123, y: 101, width: 13, height: 10 },
];

export type PatchName = 'head' | 'forehead' | 'cheek' | 'hands';

/** Fixed per-patch drift for the lost ending, as a CSS transform (7.4). */
export const UNSTITCH_OFFSETS: Record<PatchName, string> = {
  head: 'translate(0px, -4px)',
  forehead: 'translate(4px, -4px)',
  cheek: 'translate(-4px, 2px)',
  hands: 'translate(0px, 4px)',
};

/** True when the speech text has at least one non-whitespace character (3.9, 3.10). */
export function hasSpeech(speech: string | undefined): speech is string {
  return typeof speech === 'string' && /\S/.test(speech);
}

export type RateLabel = 'slow' | 'normal' | 'fast';

/** Static rate label from a Vital_Band direction; a missing band reads as normal (4.21). */
export function rateLabel(band: VitalBand | undefined): RateLabel {
  if (band?.direction === 'low') return 'slow';
  if (band?.direction === 'high') return 'fast';
  return 'normal';
}

const SIDES: readonly Side[] = ['Left', 'Right'];

/** Cross-stitch centres along the patch seams. */
const STITCHES: readonly { x: number; y: number }[] = [
  { x: 106, y: 42 },
  // On the forehead's lower seam, above the brows (brow tops at y 52).
  { x: 118, y: 48 },
  { x: 130, y: 47 },
  { x: 69, y: 82 },
  { x: 79, y: 92 },
  { x: 45, y: 175 },
  { x: 155, y: 175 },
];

/** Sweat drop centres on the forehead. */
const SWEAT_DROPS: readonly { x: number; y: number }[] = [
  { x: 76, y: 48 },
  { x: 88, y: 38 },
  { x: 124, y: 40 },
];

function cssVars(vars: Record<string, string>): CSSProperties {
  return vars as CSSProperties;
}

function classes(...names: (string | false)[]): string {
  return names.filter(Boolean).join(' ');
}

interface PatchProps {
  name: PatchName;
  lost: boolean;
  children: ReactNode;
}

/** A skin patch group; drifts apart when the patient is lost. */
function Patch({ name, lost, children }: PatchProps) {
  return (
    <g
      data-part="patch"
      data-patch={name}
      className={lost ? 'sp-unstitch' : undefined}
      style={lost ? cssVars({ '--sp-unstitch-final': UNSTITCH_OFFSETS[name] }) : undefined}
    >
      {children}
    </g>
  );
}

function CrossStitch({ x, y }: { x: number; y: number }) {
  return (
    <g data-part="stitch" stroke={AVATAR_COLOURS.seam} strokeWidth={1.5} strokeLinecap="round">
      <line x1={x - 3} y1={y - 3} x2={x + 3} y2={y + 3} />
      <line x1={x - 3} y1={y + 3} x2={x + 3} y2={y - 3} />
    </g>
  );
}

function SweatDrop({ x, y }: { x: number; y: number }) {
  return (
    <path
      data-part="sweat"
      className="sp-sweat"
      d={`M ${x} ${y - 5} Q ${x + 4} ${y + 1} ${x} ${y + 3} Q ${x - 4} ${y + 1} ${x} ${y - 5} Z`}
      fill={AVATAR_COLOURS.sweat}
      stroke={AVATAR_COLOURS.sweatOutline}
      strokeWidth={0.8}
    />
  );
}

/** Chest half for one side: the swollen outline when the side is swollen (4.17). */
function ChestHalf({ side, swollen }: { side: Side; swollen: boolean }) {
  const g = sideGeometry(side);
  const r = swollen ? g.swollenChest : g.chest;
  return (
    <rect
      data-side={side}
      data-part={swollen ? 'chest-swollen' : 'chest'}
      x={r.x}
      y={r.y}
      width={r.width}
      height={r.height}
      rx={12}
      fill={AVATAR_COLOURS.chestHalf}
      stroke={swollen ? AVATAR_COLOURS.swollenOutline : AVATAR_COLOURS.gown}
      strokeWidth={swollen ? 2 : 1}
      strokeDasharray={swollen ? '4 3' : undefined}
    />
  );
}

/** Needle line and bandage for a decompressed side (4.23). */
function DecompressionMarks({ side }: { side: Side }) {
  const { needle, bandage } = sideGeometry(side);
  return (
    <>
      <line
        data-side={side}
        data-part="needle"
        x1={needle.x1}
        y1={needle.y1}
        x2={needle.x2}
        y2={needle.y2}
        stroke={AVATAR_COLOURS.needle}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <rect
        data-side={side}
        data-part="bandage"
        x={bandage.x}
        y={bandage.y}
        width={bandage.width}
        height={bandage.height}
        rx={2}
        fill={AVATAR_COLOURS.bandage}
        stroke={AVATAR_COLOURS.needle}
        strokeWidth={0.8}
      />
    </>
  );
}

/** Eye centres: viewer's left eye and viewer's right eye. */
const EYE_CENTRES: readonly { x: number; y: number }[] = [
  { x: 84, y: 70 },
  { x: 116, y: 70 },
];

/**
 * Brow shapes per Expression, as thin filled crescents or bars (absolute
 * M/L/Q/Z commands only). The first is above the viewer's left eye.
 */
const BROWS: Record<Expression, readonly [string, string]> = {
  // Gentle arcs above the eyes.
  calm: ['M 76 59 Q 84 54 92 59 Q 84 56.5 76 59 Z', 'M 108 59 Q 116 54 124 59 Q 116 56.5 108 59 Z'],
  // Inner ends (near x = 100) lower than the outer ends.
  worried: ['M 77 55 L 92 58.5 L 91.5 60 L 76.5 56.5 Z', 'M 123 55 L 108 58.5 L 108.5 60 L 123.5 56.5 Z'],
  // Raised arcs, higher than calm.
  alarmed: ['M 74 56 Q 84 52 94 56 Q 84 54 74 56 Z', 'M 106 56 Q 116 52 126 56 Q 116 54 106 56 Z'],
  joyful: ['M 76 57 Q 84 52 92 57 Q 84 54.5 76 57 Z', 'M 108 57 Q 116 52 124 57 Q 116 54.5 108 57 Z'],
  // Outer ends lower than the inner ends.
  sleepy: ['M 76 61 L 92 57 L 92 58.5 L 76.5 62.5 Z', 'M 124 61 L 108 57 L 108 58.5 L 123.5 62.5 Z'],
};

/** Calm smile: the original lips path. */
const SMILE_PATH = 'M 90 89 Q 100 99 110 89 Q 100 94 90 89 Z';
/** Small downward curve centred at about (100, 92), for worried and sleepy. */
const FROWN_PATH = 'M 92 95 Q 100 87 108 95';
/** Big grin: a filled half-moon from (88, 86) to (112, 86) with control point (100, 100). */
const GRIN_PATH = 'M 88 86 Q 100 100 112 86 Z';
/**
 * Tear drop, 6 x 8 units, centred at about (87, 81): box x 84–90, y 77–85,
 * right of the cheek Patch (x ≤ 80), clear of the stitches, the sleepy lids
 * and the frown (x 92–108, y 87–95).
 */
const TEAR_PATH = 'M 87 77 Q 90 81 90 83 Q 90 85 87 85 Q 84 85 84 83 Q 84 81 87 77 Z';

function Eyes({ expression }: { expression: Expression }) {
  const c = AVATAR_COLOURS;
  if (expression === 'joyful' || expression === 'sleepy') {
    // Joyful: upward-curving crescents. Sleepy: closed, drooping lids.
    const lid = (x: number, y: number) =>
      expression === 'joyful' ? `M ${x - 8} ${y + 3} Q ${x} ${y - 7} ${x + 8} ${y + 3}` : `M ${x - 8} ${y - 1} Q ${x} ${y + 6} ${x + 8} ${y - 1}`;
    return (
      <g data-part="eyes">
        {EYE_CENTRES.map((e) => (
          <path
            key={e.x}
            data-part="eye-lid"
            d={lid(e.x, e.y)}
            fill="none"
            stroke={c.seam}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        ))}
      </g>
    );
  }
  const alarmed = expression === 'alarmed';
  const whiteR = alarmed ? 11 : 9;
  // Open eyes blink now and then (3.22); joyful and sleepy eyes are already closed.
  return (
    <g data-part="eyes" className="sp-blink">
      {EYE_CENTRES.map((e) => (
        <g key={e.x} data-part="eye">
          <circle data-part="eye-white" cx={e.x} cy={e.y} r={whiteR} fill={c.eyeWhite} stroke={c.seam} strokeWidth={1} />
          {alarmed ? (
            <circle cx={e.x} cy={e.y} r={3} fill={c.pupil} />
          ) : (
            <circle cx={e.x + 1} cy={e.y + 1} r={4} fill={c.pupil} />
          )}
        </g>
      ))}
    </g>
  );
}

function Mouth({ expression, lips }: { expression: Expression; lips: string }) {
  const c = AVATAR_COLOURS;
  switch (expression) {
    case 'worried':
    case 'sleepy':
      return (
        <g data-part="mouth">
          <path data-part="lips" d={FROWN_PATH} fill="none" stroke={lips} strokeWidth={3} strokeLinecap="round" />
        </g>
      );
    case 'alarmed':
      return (
        <g data-part="mouth">
          <ellipse data-part="lips" cx={100} cy={91} rx={5} ry={6} fill={lips} />
          <ellipse cx={100} cy={91} rx={3} ry={4} fill={c.pupil} />
        </g>
      );
    case 'joyful':
      return (
        <g data-part="mouth">
          <path data-part="lips" d={GRIN_PATH} fill={lips} />
          <rect data-part="tooth" x={94} y={86} width={12} height={3} rx={1} fill={c.bandage} />
        </g>
      );
    default:
      return (
        <g data-part="mouth">
          <path data-part="lips" d={SMILE_PATH} fill={lips} />
        </g>
      );
  }
}

/** Eyes, brows, mouth and (sleepy only) the tear, all inside FACE_FEATURE_BOX (3.13–3.19). */
function Face({ expression, lips }: { expression: Expression; lips: string }) {
  const c = AVATAR_COLOURS;
  return (
    <g data-part="face" data-expression={expression}>
      <Eyes expression={expression} />
      <g data-part="brows">
        {BROWS[expression].map((d) => (
          <path key={d} d={d} fill={c.seam} />
        ))}
      </g>
      <Mouth expression={expression} lips={lips} />
      {expression === 'sleepy' && (
        <path data-part="tear" d={TEAR_PATH} fill={c.sweat} stroke={c.sweatOutline} strokeWidth={0.8} />
      )}
    </g>
  );
}

/** Joyful sparkle centres, outside the face group. */
const SPARKLES: readonly { x: number; y: number }[] = [
  { x: 46, y: 52 },
  { x: 154, y: 52 },
  { x: 64, y: 14 },
];

/** A four-point sparkle about 10 units across. */
function Sparkle({ x, y }: { x: number; y: number }) {
  return (
    <path
      data-part="sparkle"
      d={`M ${x} ${y - 5} Q ${x + 1} ${y - 1} ${x + 5} ${y} Q ${x + 1} ${y + 1} ${x} ${y + 5} Q ${x - 1} ${y + 1} ${x - 5} ${y} Q ${x - 1} ${y - 1} ${x} ${y - 5} Z`}
      fill="#FFD166"
      stroke={AVATAR_COLOURS.swollenOutline}
      strokeWidth={0.6}
    />
  );
}

// Dress-up and craft details (design "Expressions and dress-up", 3.20, 3.29).
// Every shape uses plain coordinates: no transform attribute, no data-side.

/** Dress-up and craft colours. UI constants. */
export const DRESS_UP_COLOURS = {
  pumpkin: '#FF7A1A',
  pumpkinRib: '#D9600F',
  bat: '#4A2F6E',
  batOutline: '#FFF7EC',
  glow: '#FFD166',
  freckle: '#C98A6B',
  plaster: '#FFF7EC',
  plasterPad: '#F2DCC4',
} as const;

/** Rounds to `digits` decimals so the markup carries short numbers. */
function round(v: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

type PathSegment = readonly [cmd: 'M' | 'L' | 'Q' | 'C' | 'Z', ...coords: number[]];

/**
 * Path data from segments in a local frame, mapped point by point to the
 * viewBox. Only absolute M/L/Q/C/Z commands are produced.
 */
function pathFrom(segments: readonly PathSegment[], map: (x: number, y: number) => [number, number]): string {
  return segments
    .map(([cmd, ...coords]) => {
      const pts: string[] = [];
      for (let k = 0; k < coords.length; k += 2) {
        const [x, y] = map(coords[k], coords[k + 1]);
        pts.push(`${round(x)} ${round(y)}`);
      }
      return [cmd, ...pts].join(' ');
    })
    .join(' ');
}

/** The hat is drawn upright around (0, 0), then turned 15° clockwise and moved to its place. */
const HAT_CENTRE = { x: 125, y: 19 } as const;
const HAT_TILT_RAD = (15 * Math.PI) / 180;
function hatPoint(x: number, y: number): [number, number] {
  const cos = Math.cos(HAT_TILT_RAD);
  const sin = Math.sin(HAT_TILT_RAD);
  return [HAT_CENTRE.x + x * cos - y * sin, HAT_CENTRE.y + x * sin + y * cos];
}

const HAT_PATHS = {
  body: pathFrom(
    [
      ['M', 0, -9],
      ['C', 6, -12.5, 15, -10, 15, 0],
      ['C', 15, 10, 6, 11.5, 0, 9.5],
      ['C', -6, 11.5, -15, 10, -15, 0],
      ['C', -15, -10, -6, -12.5, 0, -9],
      ['Z'],
    ],
    hatPoint,
  ),
  ribs: [
    pathFrom([['M', -5, -9.3], ['Q', -9.5, 0, -5, 9.6]], hatPoint),
    pathFrom([['M', 5, -9.3], ['Q', 9.5, 0, 5, 9.6]], hatPoint),
  ],
  stem: pathFrom([['M', -2, -9], ['L', -1.6, -14.5], ['Q', 0.5, -16, 2.2, -14.8], ['L', 2.4, -9], ['Z']], hatPoint),
  tendril: pathFrom([['M', 2.2, -13.5], ['Q', 6, -17, 8, -14], ['Q', 9.5, -11, 6.5, -11.5]], hatPoint),
} as const;

/** A small pumpkin on the upper right of the head, inside HAT_BOX. No carved face. */
function PumpkinHat() {
  const d = DRESS_UP_COLOURS;
  return (
    <g data-part="hat">
      <path d={HAT_PATHS.body} fill={d.pumpkin} stroke={AVATAR_COLOURS.seam} strokeWidth={0.8} />
      {HAT_PATHS.ribs.map((rib) => (
        <path key={rib} d={rib} fill="none" stroke={d.pumpkinRib} strokeWidth={1.2} strokeLinecap="round" />
      ))}
      <path d={HAT_PATHS.stem} fill={AVATAR_COLOURS.seam} />
      <path d={HAT_PATHS.tendril} fill="none" stroke={AVATAR_COLOURS.seam} strokeWidth={1.2} strokeLinecap="round" />
    </g>
  );
}

/** Bat centres, one per BAT_BOXES entry. Each bat spans x ±15 and y -8.5..6 around its centre. */
const BAT_CENTRES: readonly [{ x: number; y: number }, { x: number; y: number }] = [
  { x: 23, y: 19 },
  { x: 176, y: 74 },
];

/** A small friendly bat: oval body, two scalloped wings, round ears and two eye dots. No teeth. */
function Bat({ x, y, className }: { x: number; y: number; className: string }) {
  const d = DRESS_UP_COLOURS;
  const at = (dx: number, dy: number): [number, number] => [x + dx, y + dy];
  const wing = (s: 1 | -1) =>
    pathFrom(
      [
        ['M', 3 * s, -2],
        ['Q', 9 * s, -9, 15 * s, -5],
        ['Q', 12 * s, -3, 12 * s, 1],
        ['Q', 10 * s, -1, 7 * s, 1],
        ['Q', 5 * s, -1, 3 * s, 2],
        ['Z'],
      ],
      at,
    );
  const ear = (s: 1 | -1) =>
    [at(3 * s, -5), at(2.5 * s, -8.5), at(1 * s, -5.5)].map(([px, py]) => `${round(px)},${round(py)}`).join(' ');
  return (
    <g data-part="bat" className={className}>
      <path d={wing(-1)} fill={d.bat} stroke={d.batOutline} strokeWidth={0.8} strokeLinejoin="round" />
      <path d={wing(1)} fill={d.bat} stroke={d.batOutline} strokeWidth={0.8} strokeLinejoin="round" />
      <polygon points={ear(-1)} fill={d.bat} stroke={d.batOutline} strokeWidth={0.8} strokeLinejoin="round" />
      <polygon points={ear(1)} fill={d.bat} stroke={d.batOutline} strokeWidth={0.8} strokeLinejoin="round" />
      <ellipse cx={x} cy={y} rx={4.5} ry={6} fill={d.bat} stroke={d.batOutline} strokeWidth={0.8} />
      <circle cx={round(x - 1.6)} cy={round(y - 2.5)} r={0.9} fill={d.glow} />
      <circle cx={round(x + 1.6)} cy={round(y - 2.5)} r={0.9} fill={d.glow} />
    </g>
  );
}

/**
 * Spark rays at the viewer's-left bolt (outer end x = 78, y 106–114), as
 * [x1, y1, x2, y2]; the viewer's-right bolt uses the mirror image x → 200 − x.
 */
const SPARK_RAYS: readonly (readonly [number, number, number, number])[] = [
  [75, 107, 71, 102.5],
  [74.5, 108.5, 68, 106],
  [74.5, 110, 67.5, 110.5],
];

/** Three short glowing strokes radiating outward from one bolt, inside SPARK_BOXES. */
function BoltSpark({ mirrored, className }: { mirrored: boolean; className: string }) {
  const mx = (x: number) => (mirrored ? 200 - x : x);
  return (
    <g data-part="spark" className={className} stroke={DRESS_UP_COLOURS.glow} strokeWidth={1.4} strokeLinecap="round">
      {SPARK_RAYS.map(([x1, y1, x2, y2]) => (
        <line key={`${x1},${y1}`} x1={mx(x1)} y1={y1} x2={mx(x2)} y2={y2} />
      ))}
    </g>
  );
}

/** Blush centres (rx 6, ry 3.5), inside the head circle. */
const BLUSH_CENTRES: readonly { x: number; y: number }[] = [
  { x: 72, y: 86 },
  { x: 128, y: 86 },
];

/** Freckle centres (r 1.2), three per side. */
const FRECKLES: readonly { x: number; y: number }[] = [
  { x: 66, y: 72 },
  { x: 63, y: 76 },
  { x: 68, y: 79 },
  { x: 134, y: 72 },
  { x: 137, y: 76 },
  { x: 132, y: 79 },
];

/**
 * Sticking plaster on the viewer's-left side of the head: a rounded strip
 * about 12 × 5 with corners (59.3, 54.9), (63.6, 57.4), (69.7, 47.1) and
 * (65.4, 44.6); the corners are the Q control points, so the strip stays
 * inside x 59.3–69.7, y 44.6–57.4 and inside the head circle.
 */
const PLASTER_STRIP =
  'M 60.1 53.6 L 64.6 45.9 Q 65.4 44.6 66.7 45.4 L 68.4 46.4 Q 69.7 47.1 68.9 48.4 ' +
  'L 64.4 56.1 Q 63.6 57.4 62.3 56.7 L 60.6 55.7 Q 59.3 54.9 60.1 53.6 Z';
const PLASTER_PAD = '62.1,51.9 64.9,53.5 66.9,50.1 64.1,48.5';
const PLASTER_DOTS: readonly { x: number; y: number }[] = [
  { x: 65.5, y: 47 },
  { x: 66.5, y: 47.6 },
  { x: 67.6, y: 48.2 },
  { x: 61.4, y: 53.8 },
  { x: 62.5, y: 54.4 },
  { x: 63.5, y: 55 },
];

/** A friendly plaster with nothing under it: no wound, no red, no stitches. */
function Plaster() {
  const d = DRESS_UP_COLOURS;
  return (
    <g data-part="plaster">
      <path d={PLASTER_STRIP} fill={d.plaster} stroke={d.freckle} strokeWidth={0.8} />
      <polygon points={PLASTER_PAD} fill={d.plasterPad} />
      {PLASTER_DOTS.map((p) => (
        <circle key={`${p.x},${p.y}`} cx={p.x} cy={p.y} r={0.4} fill={d.freckle} />
      ))}
    </g>
  );
}

/** Checked-fabric lines, every endpoint at least 1 unit inside the forehead patch outline. */
const FABRIC_CHECK_LINES: readonly (readonly [number, number, number, number])[] = [
  [116, 34, 116, 47],
  [126, 34, 126, 46],
  [108, 38, 130, 38],
  [112, 44, 134, 44],
];

/** Hand circles (same as the hands Patch) and stripe rows; stripes end 1 unit inside the edge. */
const HAND_CENTRES: readonly { x: number; y: number }[] = [
  { x: 45, y: 184 },
  { x: 155, y: 184 },
];
const HAND_R = 10;
const STRIPE_ROWS = [-4, 0, 4] as const;

function FabricLines({ part, lines }: { part: string; lines: readonly (readonly [number, number, number, number])[] }) {
  return (
    <g data-part={part} stroke={AVATAR_COLOURS.seam} strokeOpacity={0.35} strokeWidth={1}>
      {lines.map(([x1, y1, x2, y2]) => (
        <line key={`${x1},${y1},${x2},${y2}`} x1={x1} y1={y1} x2={x2} y2={y2} />
      ))}
    </g>
  );
}

const FABRIC_STRIPE_LINES = HAND_CENTRES.flatMap((h) =>
  STRIPE_ROWS.map((dy) => {
    // Rounded down, so each end stays at least 1 unit inside the circle edge.
    const half = Math.floor((Math.sqrt(HAND_R * HAND_R - dy * dy) - 1) * 100) / 100;
    return [round(h.x - half, 2), h.y + dy, round(h.x + half, 2), h.y + dy] as const;
  }),
);

function RateIcons({ params }: { params: AvatarParameters }) {
  const heart = rateLabel(params.bands.heartRate);
  const breathing = rateLabel(params.bands.respiratoryRate);
  return (
    <div
      data-part="rate-icons"
      className="sp-rate-static mt-2 justify-center gap-3 text-sm text-[#FFF7EC]"
    >
      <span data-rate="heart" data-rate-label={heart} className="rounded-full border border-[#FF7A1A] px-3 py-1">
        Heart: {heart}
      </span>
      <span
        data-rate="breathing"
        data-rate-label={breathing}
        className="rounded-full border border-[#FF7A1A] px-3 py-1"
      >
        Breathing: {breathing}
      </span>
    </div>
  );
}

function SpeechBand({ speech }: { speech: string | undefined }) {
  return (
    <div data-part="speech-band" className="relative h-[8.5rem] w-full shrink-0">
      {hasSpeech(speech) && (
        <div
          data-part="speech-bubble"
          className="absolute inset-x-2 bottom-3 mx-auto max-w-sm rounded-2xl bg-[#FFF7EC] px-3 py-2 text-[#2E1A47] shadow"
          style={{ overflowWrap: 'anywhere', fontSize: 'clamp(0.75rem, 2.5vw, 1rem)', lineHeight: 1.35 }}
        >
          <p className="whitespace-pre-wrap">{speech}</p>
          <span
            aria-hidden="true"
            className="absolute -bottom-2 left-1/2 h-0 w-0 -translate-x-1/2 border-x-8 border-t-8 border-x-transparent border-t-[#FFF7EC]"
          />
        </div>
      )}
    </div>
  );
}

export function StitchedPatient({ params, statusSentence, speech, variant = 'live' }: StitchedPatientProps) {
  const palette = SKIN_PALETTES[params.skinTone];
  const lost = variant === 'lost';
  const expression = expressionFor(params.overallStatus, variant);
  const c = AVATAR_COLOURS;
  // One-time celebration: the classes appear in the render where the first
  // side is decompressed; CSS runs the animation once (3.26, 3.27).
  const celebrate = params.decompressedSides.length > 0;
  const boltClass = celebrate ? 'sp-celebrate-bolt' : undefined;
  const headStitches = STITCHES.slice(0, 5);
  const handStitches = STITCHES.slice(5);

  const breathStyle = cssVars({
    '--sp-breath-period': `${params.breathing.periodS}s`,
    '--sp-breath-depth': `${params.breathing.depth}`,
  });
  const beatStyle = cssVars({ '--sp-beat-period': `${params.heartbeat.periodS}s` });

  return (
    <div className="sp-avatar mx-auto flex w-full max-w-md flex-col items-center" data-variant={variant}>
      <SpeechBand speech={speech} />

      <div className="aspect-[200/280] w-full">
        <svg
          role="img"
          aria-label={statusSentence}
          viewBox="0 0 200 280"
          width="100%"
          height="100%"
        >
          {/* Torso: gown and sleeves; breathes. */}
          <g
            data-part="torso"
            className={classes('sp-breathe', params.breathing.stopped && 'sp-breath-stopped')}
            style={breathStyle}
          >
            <rect x={30} y={124} width={30} height={52} rx={14} fill={c.gown} />
            <rect x={140} y={124} width={30} height={52} rx={14} fill={c.gown} />
            <path d="M 50 120 Q 100 108 150 120 L 160 252 L 40 252 Z" fill={c.gown} />
          </g>

          {/* Head area; tilts gently while the patient is live or rescued (3.23). */}
          <g data-part="head-tilt" className={lost ? undefined : 'sp-tilt'}>
            {/* Head patch with neck, hair, face and the two neck bolts. */}
            <Patch name="head" lost={lost}>
              <rect x={90} y={100} width={20} height={20} rx={4} fill={palette.patches[0]} />
              <rect data-part="bolt" className={boltClass} x={78} y={106} width={12} height={8} rx={4} fill={c.bolt} />
              <rect data-part="bolt" className={boltClass} x={110} y={106} width={12} height={8} rx={4} fill={c.bolt} />
              <circle cx={100} cy={64} r={42} fill={palette.patches[0]} stroke={c.seam} strokeWidth={1.5} />
              <path d="M 90 26 Q 93 10 100 22 Q 105 8 110 26 Z" fill={c.hair} />
              <Face expression={expression} lips={palette.lips} />
            </Patch>

            <Patch name="forehead" lost={lost}>
              <path
                d="M 104 26 Q 130 28 138 46 L 108 50 Z"
                fill={palette.patches[1]}
                stroke={c.seam}
                strokeWidth={1.2}
                strokeDasharray="3 2"
              />
              <FabricLines part="fabric-check" lines={FABRIC_CHECK_LINES} />
            </Patch>

            <Patch name="cheek" lost={lost}>
              <path
                d="M 60 80 Q 64 96 80 100 L 78 84 Z"
                fill={palette.patches[2]}
                stroke={c.seam}
                strokeWidth={1.2}
                strokeDasharray="3 2"
              />
            </Patch>

            {/* Craft details; drawn before the stitches so every stitch stays on top. */}
            {BLUSH_CENTRES.map((b) => (
              <ellipse key={b.x} data-part="blush" cx={b.x} cy={b.y} rx={6} ry={3.5} fill={palette.blush} />
            ))}
            {FRECKLES.map((f) => (
              <circle key={`${f.x},${f.y}`} data-part="freckle" cx={f.x} cy={f.y} r={1.2} fill={DRESS_UP_COLOURS.freckle} />
            ))}
            <Plaster />

            {headStitches.map((s) => (
              <CrossStitch key={`${s.x},${s.y}`} x={s.x} y={s.y} />
            ))}

            {params.sweating && SWEAT_DROPS.map((d) => <SweatDrop key={`${d.x},${d.y}`} x={d.x} y={d.y} />)}

            <PumpkinHat />

            {/* Joyful sparkles around the head, outside the face group. */}
            {expression === 'joyful' && SPARKLES.map((s) => <Sparkle key={`${s.x},${s.y}`} x={s.x} y={s.y} />)}
          </g>

          <Patch name="hands" lost={lost}>
            <circle cx={45} cy={184} r={10} fill={palette.patches[3]} stroke={c.seam} strokeWidth={1.2} />
            <circle cx={155} cy={184} r={10} fill={palette.patches[3]} stroke={c.seam} strokeWidth={1.2} />
            <FabricLines part="fabric-stripe" lines={FABRIC_STRIPE_LINES} />
          </Patch>

          {handStitches.map((s) => (
            <CrossStitch key={`${s.x},${s.y}`} x={s.x} y={s.y} />
          ))}

          <BoltSpark mirrored={false} className="sp-spark" />
          <BoltSpark mirrored className="sp-spark sp-spark-delay" />
          <Bat x={BAT_CENTRES[0].x} y={BAT_CENTRES[0].y} className="sp-bat" />
          <Bat x={BAT_CENTRES[1].x} y={BAT_CENTRES[1].y} className="sp-bat sp-bat-delay" />

          {/* Side-specific chest elements: direct children of <svg>, no transforms here or on any ancestor. */}
          {SIDES.map((side) => (
            <ChestHalf key={side} side={side} swollen={params.swollenSides.includes(side)} />
          ))}
          {SIDES.filter((side) => params.decompressedSides.includes(side)).map((side) => (
            <DecompressionMarks key={side} side={side} />
          ))}

          {/* Stitched-heart patch; pulses with the heartbeat and hops once on the first Decompression. */}
          <g data-part="heart-hop" className={celebrate ? 'sp-celebrate-heart' : undefined}>
            <path
              data-part="heart"
              className={classes('sp-beat', params.heartbeat.stopped && 'sp-beat-stopped')}
              style={beatStyle}
              d="M 100 162 C 84 150 88 136 100 144 C 112 136 116 150 100 162 Z"
              fill={c.heart}
              stroke={c.seam}
              strokeWidth={1.2}
              strokeDasharray="2 2"
            />
          </g>
        </svg>
      </div>

      <RateIcons params={params} />
    </div>
  );
}

export default StitchedPatient;
