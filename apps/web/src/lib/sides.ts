/**
 * Side handling for the Play mode Avatar (design "sides.ts").
 *
 * Sides are anatomical: named from the patient's point of view. The Avatar
 * faces the viewer, so the patient's Left is drawn on the viewer's right half
 * of the 200 x 280 viewBox (x in [100, 200]) and the patient's Right on the
 * viewer's left half (x in [0, 100]) (Requirement 3.7).
 */

import type { ExamRecordEntry, InterventionRecordEntry, ScheduledInsult, Side } from '@/types';

export const PNEUMOTHORAX_ACTION = 'SETensionPneumothorax';
export const DECOMPRESSION_ACTION = 'SENeedleDecompression';

/** Canonical output order for side lists. */
const SIDE_ORDER: readonly Side[] = ['Left', 'Right'];

function asSide(value: unknown): Side | undefined {
  return value === 'Left' || value === 'Right' ? value : undefined;
}

/**
 * Swollen_Sides and Decompressed_Sides at `simulationTime`.
 *
 * - A `SETensionPneumothorax` insult with `simulationTime >= timeSeconds` makes
 *   its side swollen, unless `active` contains an `SENeedleDecompression` on the
 *   same side with `simulationTime >= insult.timeSeconds` (4.13, 4.14, 4.16, 4.18).
 * - Decompressed_Sides are the sides of all `SENeedleDecompression` entries in
 *   `active` (4.15). `active` is expected to be limited to the Branch_Lineage.
 *
 * Action names and side strings are matched exactly; anything else is ignored.
 * Both lists are in `['Left', 'Right']` order without duplicates.
 */
export function computeSides(
  simulationTime: number,
  insults: ScheduledInsult[],
  active: InterventionRecordEntry[],
): { swollenSides: Side[]; decompressedSides: Side[] } {
  const decompressions: { side: Side; time: number }[] = [];
  for (const entry of active) {
    const side = asSide(entry.side);
    if (entry.action === DECOMPRESSION_ACTION && side) {
      decompressions.push({ side, time: entry.simulationTime });
    }
  }

  const swollen = new Set<Side>();
  for (const insult of insults) {
    const side = asSide(insult.parameters?.side);
    if (insult.action !== PNEUMOTHORAX_ACTION || !side) continue;
    if (simulationTime < insult.timeSeconds) continue;
    const treated = decompressions.some((d) => d.side === side && d.time >= insult.timeSeconds);
    if (!treated) swollen.add(side);
  }

  const decompressed = new Set<Side>(decompressions.map((d) => d.side));

  return {
    swollenSides: SIDE_ORDER.filter((s) => swollen.has(s)),
    decompressedSides: SIDE_ORDER.filter((s) => decompressed.has(s)),
  };
}

/** Which Swollen_Sides may be drawn; `'all'` keeps play-mode behaviour (bedside-exam 9.1, 9.5). */
export type RevealedSides = readonly Side[] | 'all';

/**
 * The Affected_Side insult: the first `SETensionPneumothorax` insult in list
 * order with a valid side and a finite `timeSeconds`, else `null`.
 */
export function affectedInsult(
  insults: readonly ScheduledInsult[],
): { side: Side; timeSeconds: number } | null {
  for (const insult of insults) {
    if (insult.action !== PNEUMOTHORAX_ACTION) continue;
    const side = asSide(insult.parameters?.side);
    if (!side || !Number.isFinite(insult.timeSeconds)) continue;
    return { side, timeSeconds: insult.timeSeconds };
  }
  return null;
}

/**
 * Found_Sides: the sides of Active_Exam_Entries with `abnormal === true` and a
 * side, in `['Left', 'Right']` order without duplicates (bedside-exam 9.1,
 * decision 14). Side-neutral entries and normal findings add no side.
 */
export function foundSides(active: readonly ExamRecordEntry[]): Side[] {
  const found = new Set<Side>();
  for (const entry of active) {
    const side = asSide(entry.side);
    if (entry.abnormal === true && side) found.add(side);
  }
  return SIDE_ORDER.filter((s) => found.has(s));
}

/**
 * Shown_Swollen_Sides: a copy of `swollen` for `'all'`, else the sides in both
 * `swollen` and `revealed`, in `swollen` order (bedside-exam 9.1).
 */
export function shownSwollenSides(swollen: readonly Side[], revealed: RevealedSides): Side[] {
  if (revealed === 'all') return [...swollen];
  return swollen.filter((s) => revealed.includes(s));
}

export type ViewerHalf = 'viewerLeft' | 'viewerRight';

/** The patient's Left is on the viewer's right, and the patient's Right on the viewer's left. */
export function viewerHalf(side: Side): ViewerHalf {
  return side === 'Left' ? 'viewerRight' : 'viewerLeft';
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SideGeometry {
  chest: Rect;
  swollenChest: Rect;
  needle: { x1: number; y1: number; x2: number; y2: number };
  bandage: Rect;
}

/** Avatar viewBox size and centre line. */
export const VIEWBOX_WIDTH = 200;
export const VIEWBOX_HEIGHT = 280;
/** x of the vertical centre line that separates the two halves. */
export const AVATAR_CENTRE_X = VIEWBOX_WIDTH / 2;

/** Geometry for the patient's Left, drawn in the viewer's right half (x in [100, 200]). */
const LEFT_GEOMETRY: SideGeometry = {
  chest: { x: 102, y: 120, width: 46, height: 56 },
  swollenChest: { x: 101, y: 115, width: 56, height: 66 },
  needle: { x1: 118, y1: 136, x2: 132, y2: 124 },
  bandage: { x: 112, y: 134, width: 14, height: 8 },
};

function mirrorRect(r: Rect): Rect {
  return { x: VIEWBOX_WIDTH - (r.x + r.width), y: r.y, width: r.width, height: r.height };
}

/** Geometry for the patient's Right: the Left geometry mirrored about x = 100. */
const RIGHT_GEOMETRY: SideGeometry = {
  chest: mirrorRect(LEFT_GEOMETRY.chest),
  swollenChest: mirrorRect(LEFT_GEOMETRY.swollenChest),
  needle: {
    x1: VIEWBOX_WIDTH - LEFT_GEOMETRY.needle.x1,
    y1: LEFT_GEOMETRY.needle.y1,
    x2: VIEWBOX_WIDTH - LEFT_GEOMETRY.needle.x2,
    y2: LEFT_GEOMETRY.needle.y2,
  },
  bandage: mirrorRect(LEFT_GEOMETRY.bandage),
};

/**
 * Side-specific SVG geometry. `Left` lies in x [100, 200] and `Right` in
 * x [0, 100]. The swollen chest is wider and taller than the normal chest and
 * stays in the same half (3.7, 4.17, 4.23). Returns a fresh copy.
 */
export function sideGeometry(side: Side): SideGeometry {
  const g = side === 'Left' ? LEFT_GEOMETRY : RIGHT_GEOMETRY;
  return {
    chest: { ...g.chest },
    swollenChest: { ...g.swollenChest },
    needle: { ...g.needle },
    bandage: { ...g.bandage },
  };
}
