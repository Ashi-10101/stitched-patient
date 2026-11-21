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
  /** Flat skin shade, darker than every patch colour of the same Skin_Tone (3.47, 3.48). */
  shade: string;
}

/** Skin_Tone fills (design palette table). UI constants, not clinical values. */
export const SKIN_PALETTES: Record<SkinTone, SkinPalette> = {
  // Warm peach tones, rose lips.
  healthy: {
    patches: ['#F6C9A8', '#EFB48F', '#F9D7BC', '#E8A985'],
    lips: '#D9667A',
    blush: '#F59AB0',
    shade: '#D4937A',
  },
  // Desaturated beige-grey tones, pale pink lips.
  pale: {
    patches: ['#D8CEC4', '#CBBFB3', '#E2DAD2', '#C2B5A8'],
    lips: '#E8B4BC',
    blush: '#E9C9CF',
    shade: '#A99C90',
  },
  // The pale tones with blue lips; the pale shade, so the blue cue stays on the lips.
  cyanotic: {
    patches: ['#D8CEC4', '#CBBFB3', '#E2DAD2', '#C2B5A8'],
    lips: '#5B7BD5',
    blush: '#E9C9CF',
    shade: '#A99C90',
  },
};

/** Other drawing colours. */
export const AVATAR_COLOURS = {
  gown: '#A9D6F5',
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

/** One outline style for the character, the scene and the Quilt (3.34). */
export const OUTLINE_COLOUR = '#3B2433';
export const OUTLINE_WIDTH = 1.5;
const OUTLINE = { stroke: OUTLINE_COLOUR, strokeWidth: OUTLINE_WIDTH } as const;

/** Eye colours for the open Expressions (3.49): a warm brown iris and a white highlight. */
export const IRIS = '#8A5A3B';
export const EYE_HIGHLIGHT = '#FFFFFF';

/** Gown shade and print colours (the gown itself is AVATAR_COLOURS.gown). UI constants. */
export const GOWN_SHADE = '#7FB3DB';
export const GOWN_DOT = '#F4FAFF';

/** Beanie colours: the accent orange and a green stem (the only green, and not skin). */
export const BEANIE = '#FF7A1A';
export const BEANIE_STEM = '#6E8B3D';

/** Quilt colours (3.47, 3.55). UI constants. */
export const QUILT_HEM = '#9C93B5';
export const QUILT_COLOURS = ['#B993C9', '#D49A6E', '#84B0A0', '#BBAA86'] as const;
export const QUILT_SHADE = '#6F5A86';

/** Muted night-room colours; none is brighter than the darkest healthy patch (3.55). */
export const SCENE_COLOURS = {
  glass: '#1F1433',
  frame: '#5A4378',
  moon: '#B8B09A',
  crater: '#A39C88',
  bat: '#4A2F6E',
  batEye: '#C9A44A',
  ivPole: '#7A7890',
  ivBag: '#8FA9B8',
  ivTube: '#8FA9B8',
  headboard: '#6E6A86',
  pillow: '#9C93B5',
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
/** Hat on the head (x 70–130, y 2–32). */
export const HAT_BOX: LayoutBox = { x: 70, y: 2, width: 60, height: 30 };
/** Bats inside the window glass, each over the moon: x 10–30, y 30–42 and x 28–48, y 14–26 (3.54). */
export const BAT_BOXES: readonly [LayoutBox, LayoutBox] = [
  { x: 10, y: 30, width: 20, height: 12 },
  { x: 28, y: 14, width: 20, height: 12 },
];
/** Head circle: centre (100, 64), radius 42, so x 58–142, y 22–106 (3.42). */
export const HEAD_CENTRE = { x: 100, y: 64 } as const;
export const HEAD_RADIUS = 42;
/** Window_Region: frame x 4–56, y 6–80 (glass x 8–52, y 10–70; sill y 72–80) (3.40). */
export const WINDOW_BOX: LayoutBox = { x: 4, y: 6, width: 52, height: 74 };
/** Moon: centre (30, 32), radius 13, so x 17–43, y 19–45. */
export const MOON = { cx: 30, cy: 32, r: 13 } as const;
/** IV_Region: x 184–198, y 4–240 (3.41). */
export const IV_BOX: LayoutBox = { x: 184, y: 4, width: 14, height: 236 };
/** Gown_Opening between the chest halves' inner edges: x 98–102, y 120–176 (3.52). */
export const GOWN_OPENING: LayoutBox = { x: 98, y: 120, width: 4, height: 56 };
/** Smallest y of every Quilt coordinate, control points included; below CHEST_REGION (3.39). */
export const QUILT_TOP_Y = 188;
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

/**
 * Head-area cross-stitch centres along the patch seams. The two hand
 * stitches sit on the arm seams at (31, 150) and (169, 150) (ARM_STITCH).
 */
const HEAD_STITCHES: readonly { x: number; y: number }[] = [
  { x: 106, y: 42 },
  // On the forehead's lower seam, above the brows (brow tops at y 52).
  { x: 118, y: 48 },
  { x: 130, y: 47 },
  { x: 69, y: 82 },
  { x: 79, y: 92 },
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
function ChestHalf({ side, swollen, fill }: { side: Side; swollen: boolean; fill: string }) {
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
      fill={fill}
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

/**
 * `skin` is the head Patch colour. Open curves inside a Patch (eye lids,
 * frown) fill their thin sliver with it, so every fill inside a Patch group
 * is a hex colour and the sliver blends into the head circle beneath.
 */
function Eyes({ expression, skin }: { expression: Expression; skin: string }) {
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
            fill={skin}
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
  // Iris r 6 inside the white; pupil inside the iris; highlight centred 2.8 units
  // from the eye centre, inside the iris (3.49).
  return (
    <g data-part="eyes" className="sp-blink">
      {EYE_CENTRES.map((e) => (
        <g key={e.x} data-part="eye">
          <circle data-part="eye-white" cx={e.x} cy={e.y} r={whiteR} fill={c.eyeWhite} stroke={c.seam} strokeWidth={1} />
          <circle data-part="iris" cx={e.x} cy={e.y} r={6} fill={IRIS} />
          {alarmed ? (
            <circle data-part="pupil" cx={e.x} cy={e.y} r={3} fill={c.pupil} />
          ) : (
            <circle data-part="pupil" cx={e.x + 1} cy={e.y + 1} r={4} fill={c.pupil} />
          )}
          <circle data-part="eye-highlight" cx={e.x + 2} cy={e.y - 2} r={1.6} fill={EYE_HIGHLIGHT} />
        </g>
      ))}
    </g>
  );
}

function Mouth({ expression, lips, skin }: { expression: Expression; lips: string; skin: string }) {
  const c = AVATAR_COLOURS;
  switch (expression) {
    case 'worried':
    case 'sleepy':
      return (
        <g data-part="mouth">
          <path data-part="lips" d={FROWN_PATH} fill={skin} stroke={lips} strokeWidth={3} strokeLinecap="round" />
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

/**
 * Small triangle nose, x 96.5–103.5, y 77–83: inside FACE_FEATURE_BOX, between
 * the eye-white boxes (x ≤ 95 and x ≥ 105 even for alarmed) and above every
 * lips box (y ≥ 85) (3.50).
 */
const NOSE_POINTS = '100,77 96.5,83 103.5,83';

/** Eyes, brows, nose, mouth and (sleepy only) the tear, all inside FACE_FEATURE_BOX (3.13–3.19, 3.50). */
function Face({ expression, lips, shade, skin }: { expression: Expression; lips: string; shade: string; skin: string }) {
  const c = AVATAR_COLOURS;
  return (
    <g data-part="face" data-expression={expression}>
      <Eyes expression={expression} skin={skin} />
      <g data-part="brows">
        {BROWS[expression].map((d) => (
          <path key={d} d={d} fill={c.seam} />
        ))}
      </g>
      <polygon data-part="nose" points={NOSE_POINTS} fill={shade} />
      <Mouth expression={expression} lips={lips} skin={skin} />
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
  glow: '#FFD166',
  freckle: '#C98A6B',
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

const identity = (x: number, y: number): [number, number] => [x, y];
/** Mirror about the centre line x = 100. */
const mirrorX = (x: number, y: number): [number, number] => [200 - x, y];

/** Beanie rib lines across the brim (x, from y 25 to 31). */
const BEANIE_RIBS: readonly number[] = [78, 86, 94, 102, 110, 118, 126];
/** Pumpkin ridges on the dome, ending under the brim. */
const BEANIE_RIDGES: readonly string[] = ['M 90 13 Q 85 18 86 26', 'M 110 13 Q 115 18 114 26'];

/**
 * A snug knitted pumpkin beanie on top of the head, inside HAT_BOX
 * (x 70–130, y 2–32): stem, dome, two ridges, brim and ribs. Its bottom
 * (y 32) is 10 units below the head top (y 22), so it sits on the head (3.43).
 */
function Beanie() {
  return (
    <g data-part="hat">
      <path d="M 97 2 L 103 2 L 102 12 L 98 12 Z" fill={BEANIE_STEM} {...OUTLINE} />
      <path d="M 72 30 C 70 4 130 4 128 30 Z" fill={BEANIE} {...OUTLINE} />
      {BEANIE_RIDGES.map((d) => (
        <path key={d} d={d} fill="none" {...OUTLINE} />
      ))}
      <rect x={70} y={24} width={60} height={8} rx={4} fill={BEANIE} {...OUTLINE} />
      {BEANIE_RIBS.map((x) => (
        <line key={x} x1={x} y1={25} x2={x} y2={31} {...OUTLINE} />
      ))}
    </g>
  );
}

/** Forehead and cheek skin pieces; each is a flat fill plus a dashed seam along its edge. */
const FOREHEAD_PATCH = 'M 104 26 Q 130 28 138 46 L 108 50 Z';
const CHEEK_PATCH = 'M 60 80 Q 64 96 80 100 L 78 84 Z';

/** Back hair mass behind the head, above y 46 (tilts with the head). */
const BACK_HAIR = 'M 60 46 Q 58 18 100 14 Q 142 18 140 46 L 132 40 Q 100 26 68 40 Z';

/**
 * Curled yarn hair locks from under the brim: three on the viewer's left in
 * x 60–80, y 28–46 and three on the viewer's right in x 120–140, y 28–43.
 * All lie above FACE_FEATURE_BOX (y ≥ 52) and end below the brim (y 32) (3.44).
 */
const HAIR_LOCKS: readonly string[] = [
  'M 68 30 Q 60 36 61 42 Q 64 38 70 34 Z',
  'M 72 28 Q 64 34 66 44 Q 70 40 74 32 Z',
  'M 77 30 Q 71 37 74 46 Q 78 40 80 32 Z',
  'M 123 30 Q 129 36 127 43 Q 122 39 120 32 Z',
  'M 128 28 Q 136 34 134 42 Q 130 39 126 32 Z',
  'M 132 30 Q 140 36 139 42 Q 136 38 130 34 Z',
];

/** Viewer's-left gown panel: shoulder, short sleeve (hem (20, 150)–(42, 150)) and side; box x 18–90, y 108–196. */
const GOWN_PANEL: readonly PathSegment[] = [
  ['M', 90, 112],
  ['Q', 56, 108, 30, 118],
  ['Q', 18, 126, 20, 150],
  ['L', 42, 150],
  ['Q', 44, 156, 48, 160],
  ['L', 54, 196],
  ['L', 58, 196],
  ['L', 60, 122],
  ['Q', 76, 114, 90, 112],
  ['Z'],
];
/** Gown shades on the viewer's-left panel: shoulder fold and underarm wedge. */
const GOWN_SHADES: readonly (readonly PathSegment[])[] = [
  [['M', 34, 122], ['Q', 40, 130, 38, 142], ['Q', 36, 130, 30, 124], ['Z']],
  [['M', 42, 150], ['Q', 46, 158, 52, 162], ['L', 48, 150], ['Z']],
];
/** Gown print dots on the viewer's-left shoulder and sleeve, outside every chest box. */
const GOWN_DOTS: readonly { x: number; y: number }[] = [
  { x: 27, y: 127 },
  { x: 37, y: 135 },
  { x: 28, y: 143 },
  { x: 40, y: 121 },
  { x: 72, y: 113 },
];

/**
 * Viewer's-left arm: forearm sharing the sleeve hem vertices (20, 150) and
 * (42, 150) (3.45), mitten and thumb from y 188, so every arm shape stays
 * clear of the chest boxes (swollen Right chest x 43–99, y 115–181) (3.46).
 */
const FOREARM: readonly PathSegment[] = [['M', 20, 150], ['L', 42, 150], ['L', 40, 188], ['L', 22, 188], ['Z']];
/** Arm seam along the sleeve hem, as a <line> so it carries no fill inside the hands Patch. */
const ARM_SEAM = { x1: 20, y1: 150, x2: 42, y2: 150 } as const;
const ARM_STITCH = { x: 31, y: 150 } as const;
const MITTEN: readonly PathSegment[] = [['M', 20, 188], ['Q', 18, 206, 30, 206], ['Q', 42, 206, 40, 188], ['Z']];
const THUMB: readonly PathSegment[] = [['M', 40, 192], ['Q', 46, 192, 44, 199], ['Q', 42, 201, 40, 199], ['Z']];

/** One gown panel with its shades and print dots; `mirrored` draws the viewer's-right panel. */
function GownPanel({ mirrored }: { mirrored: boolean }) {
  const map = mirrored ? mirrorX : identity;
  return (
    <>
      <path data-part="gown" d={pathFrom(GOWN_PANEL, map)} fill={AVATAR_COLOURS.gown} {...OUTLINE} />
      {GOWN_SHADES.map((s, k) => (
        <path key={k} data-part="shade" d={pathFrom(s, map)} fill={GOWN_SHADE} />
      ))}
      {GOWN_DOTS.map((p) => {
        const [cx, cy] = map(p.x, p.y);
        return <circle key={`${cx},${cy}`} data-part="gown-dot" cx={cx} cy={cy} r={1.3} fill={GOWN_DOT} />;
      })}
    </>
  );
}

/** One arm: forearm, seam with a cross-stitch at the sleeve hem, and a mitten hand. */
function Arm({ mirrored, skin, mitten }: { mirrored: boolean; skin: string; mitten: string }) {
  const map = mirrored ? mirrorX : identity;
  const [sx, sy] = map(ARM_STITCH.x, ARM_STITCH.y);
  const [x1, y1] = map(ARM_SEAM.x1, ARM_SEAM.y1);
  const [x2, y2] = map(ARM_SEAM.x2, ARM_SEAM.y2);
  return (
    <g data-part="arm">
      <path d={pathFrom(FOREARM, map)} fill={skin} {...OUTLINE} />
      <line
        data-part="seam"
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={AVATAR_COLOURS.seam}
        strokeWidth={1.2}
        strokeDasharray="3 2"
      />
      <CrossStitch x={sx} y={sy} />
      <g data-part="mitten">
        <path d={pathFrom(MITTEN, map)} fill={mitten} {...OUTLINE} />
        <path d={pathFrom(THUMB, map)} fill={mitten} {...OUTLINE} />
      </g>
    </g>
  );
}


/**
 * Bat centres, one per BAT_BOXES entry. Each bat spans x ±10 and y -7..5
 * around its centre (about 20 × 12), control points included.
 */
const BAT_CENTRES: readonly [{ x: number; y: number }, { x: number; y: number }] = [
  { x: 20, y: 37 },
  { x: 38, y: 21 },
];

/** A small friendly bat: oval body, two scalloped wings, round ears and two eye dots. No teeth. */
function Bat({ x, y, className }: { x: number; y: number; className: string }) {
  const sc = SCENE_COLOURS;
  const at = (dx: number, dy: number): [number, number] => [x + dx, y + dy];
  const wing = (s: 1 | -1) =>
    pathFrom(
      [
        ['M', 2 * s, -1.5],
        ['Q', 6 * s, -7, 10 * s, -4],
        ['Q', 8 * s, -2, 8 * s, 1],
        ['Q', 6.5 * s, -0.5, 4.5 * s, 1],
        ['Q', 3 * s, -0.5, 2 * s, 1.5],
        ['Z'],
      ],
      at,
    );
  const ear = (s: 1 | -1) =>
    [at(2 * s, -4), at(1.7 * s, -7), at(0.7 * s, -4.5)].map(([px, py]) => `${round(px)},${round(py)}`).join(' ');
  const outline = { stroke: OUTLINE_COLOUR, strokeWidth: OUTLINE_WIDTH };
  return (
    <g data-part="bat" className={className}>
      <path d={wing(-1)} fill={sc.bat} {...outline} />
      <path d={wing(1)} fill={sc.bat} {...outline} />
      <polygon points={ear(-1)} fill={sc.bat} {...outline} />
      <polygon points={ear(1)} fill={sc.bat} {...outline} />
      <ellipse cx={x} cy={y} rx={3} ry={5} fill={sc.bat} {...outline} />
      <circle cx={round(x - 1.1)} cy={round(y - 1.8)} r={0.8} fill={sc.batEye} />
      <circle cx={round(x + 1.1)} cy={round(y - 1.8)} r={0.8} fill={sc.batEye} />
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

/** Checked-fabric lines inside the quilt patch x 52–100, y 200–240, ending 1 unit inside its edge. */
const FABRIC_CHECK_LINES: readonly (readonly [number, number, number, number])[] = [
  [64, 201, 64, 239],
  [76, 201, 76, 239],
  [88, 201, 88, 239],
  [53, 210, 99, 210],
  [53, 220, 99, 220],
  [53, 230, 99, 230],
];

/** Striped-fabric lines inside the quilt patch x 100–148, y 240–280, ending 1 unit inside its edge. */
const FABRIC_STRIPE_LINES: readonly (readonly [number, number, number, number])[] = [
  [101, 248, 147, 248],
  [101, 256, 147, 256],
  [101, 264, 147, 264],
  [101, 272, 147, 272],
];

function FabricLines({ part, lines }: { part: string; lines: readonly (readonly [number, number, number, number])[] }) {
  return (
    <g data-part={part} stroke={AVATAR_COLOURS.seam} strokeOpacity={0.35} strokeWidth={1}>
      {lines.map(([x1, y1, x2, y2]) => (
        <line key={`${x1},${y1},${x2},${y2}`} x1={x1} y1={y1} x2={x2} y2={y2} />
      ))}
    </g>
  );
}

/**
 * The night room behind the bed (3.35, 3.38, 3.40, 3.41, 3.54): window,
 * moon, bats, IV pole, bag and tube, headboard and pillow, in that order.
 * Muted fills, flat colours, no animation besides the bats' sp-bat.
 */
function Scene() {
  const sc = SCENE_COLOURS;
  const outline = { stroke: OUTLINE_COLOUR, strokeWidth: OUTLINE_WIDTH };
  return (
    <g data-part="scene">
      <g data-part="window">
        <rect x={4} y={6} width={52} height={74} rx={3} fill={sc.frame} {...outline} />
        <rect x={8} y={10} width={44} height={60} fill={sc.glass} {...outline} />
        <rect x={4} y={72} width={52} height={8} fill={sc.frame} {...outline} />
      </g>
      <g data-part="moon">
        <circle cx={MOON.cx} cy={MOON.cy} r={MOON.r} fill={sc.moon} />
        <circle cx={25} cy={28} r={2} fill={sc.crater} />
        <circle cx={34} cy={37} r={2} fill={sc.crater} />
      </g>
      <Bat x={BAT_CENTRES[0].x} y={BAT_CENTRES[0].y} className="sp-bat" />
      <Bat x={BAT_CENTRES[1].x} y={BAT_CENTRES[1].y} className="sp-bat sp-bat-delay" />
      <g data-part="iv-pole">
        <rect x={190} y={8} width={2} height={232} fill={sc.ivPole} {...outline} />
        <path d="M 186 8 Q 186 4 191 4 Q 196 4 196 8" fill="none" {...outline} />
      </g>
      <g data-part="iv-bag">
        <rect x={184} y={12} width={14} height={36} rx={4} fill={sc.ivBag} {...outline} />
        <line x1={188} y1={22} x2={194} y2={22} {...outline} />
      </g>
      <path data-part="iv-tube" d="M 191 48 Q 186 140 188 236" fill="none" stroke={sc.ivTube} strokeWidth={1} />
      <g data-part="headboard">
        <rect x={10} y={110} width={8} height={126} fill={sc.headboard} {...outline} />
        <rect x={182} y={110} width={8} height={126} fill={sc.headboard} {...outline} />
        <circle cx={14} cy={108} r={5} fill={sc.headboard} {...outline} />
        <circle cx={186} cy={108} r={5} fill={sc.headboard} {...outline} />
        <rect x={14} y={114} width={172} height={6} fill={sc.headboard} {...outline} />
      </g>
      <g data-part="pillow">
        <rect x={26} y={104} width={148} height={48} rx={20} fill={sc.pillow} {...outline} />
        <path
          data-part="seam"
          d="M 40 128 Q 100 134 160 128"
          fill="none"
          stroke={AVATAR_COLOURS.seam}
          strokeWidth={1}
          strokeDasharray="3 2"
        />
      </g>
    </g>
  );
}

/** Quilt patch grid: four columns by two rows, each 48 × 40, below the hem at y 200. */
const QUILT_PATCHES: readonly { x: number; y: number; fill: string }[] = [200, 240].flatMap((y, row) =>
  [4, 52, 100, 148].map((x, col) => ({ x, y, fill: QUILT_COLOURS[(col + row * 2) % QUILT_COLOURS.length] })),
);
/** Dashed seams on the hem fold and the grid lines. */
const QUILT_SEAMS: readonly string[] = [
  'M 4 200 H 196',
  'M 4 240 H 196',
  'M 52 200 V 280',
  'M 100 200 V 280',
  'M 148 200 V 280',
];
const QUILT_STITCHES: readonly { x: number; y: number }[] = [
  { x: 52, y: 220 },
  { x: 148, y: 260 },
  { x: 100, y: 240 },
];
/** Shade ellipses under the two mittens. */
const MITTEN_SHADES: readonly { x: number; y: number }[] = [
  { x: 30, y: 208 },
  { x: 170, y: 208 },
];

/**
 * The Quilt over the lap (3.36, 3.37, 3.39): body with a turned-down hem,
 * patches, seams, stitches, the two fabric looks and flat shades. Its top
 * edge is QUILT_TOP_Y, below CHEST_REGION.
 */
function Quilt() {
  const outline = { stroke: OUTLINE_COLOUR, strokeWidth: OUTLINE_WIDTH };
  return (
    <g data-part="quilt">
      <path
        d={`M 4 194 Q 52 ${QUILT_TOP_Y} 100 192 Q 148 ${QUILT_TOP_Y} 196 194 L 196 280 L 4 280 Z`}
        fill={QUILT_HEM}
        {...outline}
      />
      <path data-part="shade" d="M 4 198 Q 100 202 196 198 L 196 200 L 4 200 Z" fill={QUILT_SHADE} />
      {QUILT_PATCHES.map((p) => (
        <rect
          key={`${p.x},${p.y}`}
          data-part="quilt-patch"
          x={p.x}
          y={p.y}
          width={48}
          height={40}
          fill={p.fill}
          {...outline}
        />
      ))}
      <FabricLines part="fabric-check" lines={FABRIC_CHECK_LINES} />
      <FabricLines part="fabric-stripe" lines={FABRIC_STRIPE_LINES} />
      {QUILT_SEAMS.map((d) => (
        <path
          key={d}
          data-part="seam"
          d={d}
          fill="none"
          stroke={AVATAR_COLOURS.seam}
          strokeWidth={1}
          strokeDasharray="3 2"
        />
      ))}
      {QUILT_STITCHES.map((s) => (
        <CrossStitch key={`${s.x},${s.y}`} x={s.x} y={s.y} />
      ))}
      {MITTEN_SHADES.map((m) => (
        <ellipse key={m.x} data-part="shade" cx={m.x} cy={m.y} rx={10} ry={2} fill={QUILT_SHADE} />
      ))}
    </g>
  );
}

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
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          {/* Night room behind the bed; first child of the SVG (3.35). */}
          <Scene />

          {/* Torso: gown and sleeves; breathes. */}
          <g
            data-part="torso"
            className={classes('sp-breathe', params.breathing.stopped && 'sp-breath-stopped')}
            style={breathStyle}
          >
            <path d="M 60 114 Q 100 106 140 114 L 146 196 L 54 196 Z" fill={palette.patches[1]} {...OUTLINE} />
            <GownPanel mirrored={false} />
            <GownPanel mirrored />
          </g>

          {/* Head area; tilts gently while the patient is live or rescued (3.23). */}
          <g data-part="head-tilt" className={lost ? undefined : 'sp-tilt'}>
            {/* Back hair first, behind the head; above y 46 so it never covers the gown. */}
            <path data-part="hair" d={BACK_HAIR} fill={c.hair} {...OUTLINE} />

            {/* Head patch with neck, chin shade, the two neck bolts, head circle, far-side shade and face. */}
            <Patch name="head" lost={lost}>
              <rect x={90} y={100} width={20} height={20} rx={4} fill={palette.patches[0]} {...OUTLINE} />
              <ellipse data-part="shade" cx={100} cy={108} rx={10} ry={2.5} fill={palette.shade} />
              <rect data-part="bolt" className={boltClass} x={78} y={106} width={12} height={8} rx={4} fill={c.bolt} {...OUTLINE} />
              <rect data-part="bolt" className={boltClass} x={110} y={106} width={12} height={8} rx={4} fill={c.bolt} {...OUTLINE} />
              <circle
                data-part="head"
                cx={HEAD_CENTRE.x}
                cy={HEAD_CENTRE.y}
                r={HEAD_RADIUS}
                fill={palette.patches[0]}
                {...OUTLINE}
              />
              <path data-part="shade" d="M 128 34 Q 150 64 118 101 Q 138 66 128 34 Z" fill={palette.shade} />
              <Face expression={expression} lips={palette.lips} shade={palette.shade} skin={palette.patches[0]} />
            </Patch>

            <Patch name="forehead" lost={lost}>
              <path d={FOREHEAD_PATCH} fill={palette.patches[1]} />
              <path data-part="seam" d={FOREHEAD_PATCH} fill={palette.patches[1]} stroke={c.seam} strokeWidth={1.2} strokeDasharray="3 2" />
            </Patch>

            <Patch name="cheek" lost={lost}>
              <path d={CHEEK_PATCH} fill={palette.patches[2]} />
              <path data-part="seam" d={CHEEK_PATCH} fill={palette.patches[2]} stroke={c.seam} strokeWidth={1.2} strokeDasharray="3 2" />
            </Patch>

            {/* Shade under the beanie brim. */}
            <path data-part="shade" d="M 74 32 Q 100 40 126 32 Z" fill={palette.shade} />

            {/* Craft details; drawn before the stitches so every stitch stays on top. */}
            {BLUSH_CENTRES.map((b) => (
              <ellipse key={b.x} data-part="blush" cx={b.x} cy={b.y} rx={6} ry={3.5} fill={palette.blush} />
            ))}
            {FRECKLES.map((f) => (
              <circle key={`${f.x},${f.y}`} data-part="freckle" cx={f.x} cy={f.y} r={1.2} fill={DRESS_UP_COLOURS.freckle} />
            ))}

            {HEAD_STITCHES.map((s) => (
              <CrossStitch key={`${s.x},${s.y}`} x={s.x} y={s.y} />
            ))}

            {HAIR_LOCKS.map((d) => (
              <path key={d} data-part="hair-lock" d={d} fill={c.hair} {...OUTLINE} />
            ))}

            <Beanie />

            {params.sweating && SWEAT_DROPS.map((d) => <SweatDrop key={`${d.x},${d.y}`} x={d.x} y={d.y} />)}

            {/* Joyful sparkles around the head, outside the face group. */}
            {expression === 'joyful' && SPARKLES.map((s) => <Sparkle key={`${s.x},${s.y}`} x={s.x} y={s.y} />)}
          </g>

          <BoltSpark mirrored={false} className="sp-spark" />
          <BoltSpark mirrored className="sp-spark sp-spark-delay" />

          {/* Side-specific chest elements: direct children of <svg>, no transforms here or on any ancestor. */}
          {SIDES.map((side) => (
            <ChestHalf key={side} side={side} swollen={params.swollenSides.includes(side)} fill={palette.patches[1]} />
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

          {/* Quilt over the lap; after the chest and heart, before the hands (3.36). */}
          <Quilt />

          {/* Arms last, so the mitten hands rest on the Quilt (3.36, 3.45). */}
          <Patch name="hands" lost={lost}>
            <Arm mirrored={false} skin={palette.patches[3]} mitten={palette.patches[2]} />
            <Arm mirrored skin={palette.patches[3]} mitten={palette.patches[2]} />
          </Patch>
        </svg>
      </div>

      <RateIcons params={params} />
    </div>
  );
}

export default StitchedPatient;
