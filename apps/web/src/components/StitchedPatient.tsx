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
import type { AvatarParameters, Side, VitalBand } from '@/types';

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
}

/** Skin_Tone fills (design palette table). UI constants, not clinical values. */
export const SKIN_PALETTES: Record<SkinTone, SkinPalette> = {
  // Warm peach tones, rose lips.
  healthy: { patches: ['#F6C9A8', '#EFB48F', '#F9D7BC', '#E8A985'], lips: '#D9667A' },
  // Desaturated beige-grey tones, pale pink lips.
  pale: { patches: ['#D8CEC4', '#CBBFB3', '#E2DAD2', '#C2B5A8'], lips: '#E8B4BC' },
  // The pale tones with blue lips.
  cyanotic: { patches: ['#D8CEC4', '#CBBFB3', '#E2DAD2', '#C2B5A8'], lips: '#5B7BD5' },
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
  { x: 118, y: 56 },
  { x: 130, y: 54 },
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
  const c = AVATAR_COLOURS;

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

          {/* Head patch with neck, hair, face and the two neck bolts. */}
          <Patch name="head" lost={lost}>
            <rect x={90} y={100} width={20} height={20} rx={4} fill={palette.patches[0]} />
            <rect data-part="bolt" x={78} y={106} width={12} height={8} rx={4} fill={c.bolt} />
            <rect data-part="bolt" x={110} y={106} width={12} height={8} rx={4} fill={c.bolt} />
            <circle cx={100} cy={64} r={42} fill={palette.patches[0]} stroke={c.seam} strokeWidth={1.5} />
            <path d="M 90 26 Q 93 10 100 22 Q 105 8 110 26 Z" fill={c.hair} />
            <circle cx={84} cy={70} r={9} fill={c.eyeWhite} stroke={c.seam} strokeWidth={1} />
            <circle cx={116} cy={70} r={9} fill={c.eyeWhite} stroke={c.seam} strokeWidth={1} />
            <circle cx={85} cy={71} r={4} fill={c.pupil} />
            <circle cx={117} cy={71} r={4} fill={c.pupil} />
            <path data-part="lips" d="M 90 89 Q 100 99 110 89 Q 100 94 90 89 Z" fill={palette.lips} />
          </Patch>

          <Patch name="forehead" lost={lost}>
            <path
              d="M 104 26 Q 130 28 138 52 L 108 58 Z"
              fill={palette.patches[1]}
              stroke={c.seam}
              strokeWidth={1.2}
              strokeDasharray="3 2"
            />
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

          <Patch name="hands" lost={lost}>
            <circle cx={45} cy={184} r={10} fill={palette.patches[3]} stroke={c.seam} strokeWidth={1.2} />
            <circle cx={155} cy={184} r={10} fill={palette.patches[3]} stroke={c.seam} strokeWidth={1.2} />
          </Patch>

          {STITCHES.map((s) => (
            <CrossStitch key={`${s.x},${s.y}`} x={s.x} y={s.y} />
          ))}

          {params.sweating && SWEAT_DROPS.map((d) => <SweatDrop key={`${d.x},${d.y}`} x={d.x} y={d.y} />)}

          {/* Side-specific chest elements: no transforms here or on any ancestor. */}
          {SIDES.map((side) => (
            <ChestHalf key={side} side={side} swollen={params.swollenSides.includes(side)} />
          ))}
          {SIDES.filter((side) => params.decompressedSides.includes(side)).map((side) => (
            <DecompressionMarks key={side} side={side} />
          ))}

          {/* Stitched-heart patch; pulses with the heartbeat. */}
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
        </svg>
      </div>

      <RateIcons params={params} />
    </div>
  );
}

export default StitchedPatient;
