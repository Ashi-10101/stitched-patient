import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AlarmState, Hint, Intervention, PlaybackSpeed } from '@/types';
import { getAlarmBgColor, getAlarmColor } from '@/lib/alarms';
import { playButtonText } from '@/lib/playCase';
import { VitalSign } from './VitalSign';
import { InterventionPanel } from './InterventionPanel';
import { PlaybackControls } from './PlaybackControls';
import { HintPanel } from './HintPanel';

const STATES: AlarmState[] = ['normal', 'warning', 'critical'];
const SPEEDS: PlaybackSpeed[] = ['1x', '2x', '4x'];
const noop = () => {};

/** All class tokens in the markup. */
function classTokens(html: string): Set<string> {
  const tokens = new Set<string>();
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    for (const t of m[1].split(/\s+/)) if (t) tokens.add(t);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Markup rendered by the components before this change (captured with
// renderToStaticMarkup on the unmodified components), written as literals.
// ---------------------------------------------------------------------------

const OLD_VITAL: Record<AlarmState, string> = {
  normal:
    '<div class="flex flex-col items-center justify-center p-6 rounded-lg bg-gray-800 border border-gray-700"><div class="text-sm text-gray-400 mb-2">HR</div><div class="text-5xl font-bold tabular-nums text-green-400">72</div><div class="text-sm text-gray-400 mt-2">bpm</div></div>',
  warning:
    '<div class="flex flex-col items-center justify-center p-6 rounded-lg bg-yellow-500/20 border border-gray-700"><div class="text-sm text-gray-400 mb-2">HR</div><div class="text-5xl font-bold tabular-nums text-yellow-500">72</div><div class="text-sm text-gray-400 mt-2">bpm</div></div>',
  critical:
    '<div class="flex flex-col items-center justify-center p-6 rounded-lg bg-red-500/20 border border-gray-700"><div class="text-sm text-gray-400 mb-2">HR</div><div class="text-5xl font-bold tabular-nums text-red-500">72</div><div class="text-sm text-gray-400 mt-2">bpm</div></div>',
};

const OLD_PANEL_ENABLED =
  '<div class="bg-gray-800 p-4 rounded-lg border border-gray-700"><h3 class="text-lg font-semibold mb-4">Interventions</h3><div class="grid grid-cols-1 gap-2"><button class="px-4 py-3 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed rounded text-left transition-colors font-medium">Needle decompression (left)</button></div></div>';
const OLD_PANEL_DISABLED =
  '<div class="bg-gray-800 p-4 rounded-lg border border-gray-700"><h3 class="text-lg font-semibold mb-4">Interventions</h3><div class="grid grid-cols-1 gap-2"><button disabled="" class="px-4 py-3 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed rounded text-left transition-colors font-medium">Needle decompression (left)</button></div></div>';

const OLD_SPEED_SELECTED = '<button class="px-3 py-1 rounded transition-colors bg-blue-600 text-white">';
const OLD_SPEED_OTHER =
  '<button class="px-3 py-1 rounded transition-colors bg-gray-700 text-gray-300 hover:bg-gray-600">';

function oldPlayback(playing: boolean, speed: PlaybackSpeed): string {
  const play = playing
    ? '<button class="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded font-semibold transition-colors" aria-label="Pause">⏸ Pause</button>'
    : '<button class="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded font-semibold transition-colors" aria-label="Play">▶ Play</button>';
  const speeds = SPEEDS.map((s) => `${s === speed ? OLD_SPEED_SELECTED : OLD_SPEED_OTHER}${s}</button>`).join('');
  return (
    '<div class="flex items-center gap-4 bg-gray-800 p-4 rounded-lg border border-gray-700">' +
    `<div class="flex items-center gap-2">${play}</div>` +
    `<div class="border-l border-gray-600 pl-4 flex items-center gap-2"><span class="text-sm text-gray-400">Speed:</span>${speeds}</div>` +
    '<div class="border-l border-gray-600 pl-4 flex items-center gap-2"><span class="text-sm text-gray-400">Sim Time:</span><span class="text-xl font-mono font-bold">1:05</span></div>' +
    '</div>'
  );
}

// ---------------------------------------------------------------------------

const NEEDLE: Intervention = {
  id: 'a',
  label: 'Needle decompression (left)',
  playLabel: 'Let air out',
  action: 'X',
};
const INTERVENTIONS: Intervention[] = [
  { id: 'nd-left', label: 'Needle decompression (left)', playLabel: 'Let the trapped air out (left)', action: 'NeedleDecompression' },
  { id: 'o2', label: 'Supplemental oxygen', playLabel: '   ', action: 'Oxygen' },
  { id: 'nd-right', label: 'Needle decompression (right)', action: 'NeedleDecompression' },
];

const LOCK = '<span aria-hidden="true" class="mr-2">🔒</span>';
const NOT_AVAILABLE = '<span class="block text-sm font-normal">Not available right now</span>';
const CHECK = '<span aria-hidden="true" class="mr-1">✓</span>';

/** Text content of each <button>, in document order. */
function buttonBodies(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1]);
}

describe('VitalSign', () => {
  it('renders exactly as before when alarmState is given', () => {
    for (const s of STATES) {
      expect(renderToStaticMarkup(<VitalSign label="HR" value={72} unit="bpm" alarmState={s} />)).toBe(OLD_VITAL[s]);
    }
  });

  it('has no alarm colour class without alarmState', () => {
    const html = renderToStaticMarkup(<VitalSign label="HR" value={72} unit="bpm" />);
    const tokens = classTokens(html);
    for (const s of STATES) {
      for (const cls of [getAlarmColor(s), getAlarmBgColor(s)]) {
        for (const t of cls.split(/\s+/)) expect(tokens.has(t)).toBe(false);
      }
    }
    expect(html).toContain('>72<');
    expect(html).toContain('>HR<');
    expect(html).toContain('>bpm<');
  });
});

describe('InterventionPanel', () => {
  it('renders exactly as before when enabled with default props', () => {
    expect(renderToStaticMarkup(<InterventionPanel interventions={[NEEDLE]} onApply={noop} />)).toBe(
      OLD_PANEL_ENABLED,
    );
  });

  it('keeps the old disabled markup and adds the lock icon and text', () => {
    const html = renderToStaticMarkup(<InterventionPanel interventions={[NEEDLE]} onApply={noop} disabled />);
    expect(html).toContain(LOCK);
    expect(html).toContain(NOT_AVAILABLE);
    expect(html.replace(LOCK, '').replace(NOT_AVAILABLE, '')).toBe(OLD_PANEL_DISABLED);
  });

  it('shows the clinical label by default, in array order', () => {
    const html = renderToStaticMarkup(<InterventionPanel interventions={INTERVENTIONS} onApply={noop} />);
    expect(buttonBodies(html)).toEqual(INTERVENTIONS.map((i) => i.label));
  });

  it('shows Play_Labels with getLabel = playButtonText, in array order', () => {
    const html = renderToStaticMarkup(
      <InterventionPanel interventions={INTERVENTIONS} onApply={noop} getLabel={playButtonText} />,
    );
    expect(buttonBodies(html)).toEqual([
      'Let the trapped air out (left)',
      'Supplemental oxygen',
      'Needle decompression (right)',
    ]);
  });

  it('disabledReason disables every button and is shown as visible text', () => {
    const html = renderToStaticMarkup(
      <InterventionPanel
        interventions={INTERVENTIONS}
        onApply={noop}
        getLabel={playButtonText}
        disabledReason="Waiting for the simulation"
      />,
    );
    const tags = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
    expect(tags).toHaveLength(3);
    for (const t of tags) expect(t).toContain('disabled=""');
    const bodies = buttonBodies(html);
    expect(bodies[0]).toBe(`${LOCK}Let the trapped air out (left)${NOT_AVAILABLE}`);
    for (const b of bodies) {
      expect(b).toContain(LOCK);
      expect(b).toContain(NOT_AVAILABLE);
    }
    expect(html).toContain('<p class="mt-3 text-sm text-gray-300">Waiting for the simulation</p>');
  });

  it('a whitespace-only disabledReason does not disable the buttons', () => {
    const html = renderToStaticMarkup(
      <InterventionPanel interventions={[NEEDLE]} onApply={noop} disabledReason="  " />,
    );
    expect(html).toBe(OLD_PANEL_ENABLED);
  });
});

describe('PlaybackControls', () => {
  const render = (playing: boolean, speed: PlaybackSpeed, variant?: 'clinician' | 'play') =>
    renderToStaticMarkup(
      <PlaybackControls
        playing={playing}
        speed={speed}
        simulationTime={65}
        onPlayPause={noop}
        onSpeedChange={noop}
        variant={variant}
      />,
    );

  it('default render equals the old markup apart from aria-pressed and the check mark', () => {
    for (const playing of [true, false]) {
      for (const speed of SPEEDS) {
        const html = render(playing, speed);
        const stripped = html.replace(/ aria-pressed="(true|false)"/g, '').replace(CHECK, '');
        expect(stripped).toBe(oldPlayback(playing, speed));
      }
    }
  });

  for (const variant of [undefined, 'play'] as const) {
    it(`selected speed has aria-pressed="true" and a check mark (variant ${variant ?? 'default'})`, () => {
      for (const playing of [true, false]) {
        for (const speed of SPEEDS) {
          const html = render(playing, speed, variant);
          const buttons = [...html.matchAll(/(<button[^>]*>)(.*?)<\/button>/g)].slice(1);
          expect(buttons).toHaveLength(3);
          buttons.forEach(([, tag, body], idx) => {
            const s = SPEEDS[idx];
            if (s === speed) {
              expect(tag).toContain('aria-pressed="true"');
              expect(body).toBe(`${CHECK}${s}`);
            } else {
              expect(tag).toContain('aria-pressed="false"');
              expect(body).toBe(s);
            }
          });
          expect(html).toContain(playing ? '⏸ Pause' : '▶ Play');
        }
      }
    });
  }

  it('variant="play" uses the Play palette instead of the clinician palette', () => {
    const tokens = classTokens(render(false, '2x', 'play'));
    expect(tokens.has('bg-[#2E1A47]')).toBe(true);
    expect(tokens.has('bg-[#FF7A1A]')).toBe(true);
    expect(tokens.has('bg-blue-600')).toBe(false);
    expect(tokens.has('bg-gray-800')).toBe(false);
  });
});

describe('InterventionPanel variant="play"', () => {
  /** Class tokens used only by the clinician panel. */
  const CLINICIAN_TOKENS = [
    'bg-gray-800',
    'bg-gray-700',
    'border-gray-700',
    'hover:bg-gray-600',
    'p-4',
    'grid-cols-1',
    'disabled:bg-gray-800',
    'text-gray-300',
  ];
  const PLAY_NOT_AVAILABLE = '<span class="block text-base font-normal">Not available right now</span>';
  const buttonTags = (html: string): string[] => [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
  const tagTokens = (tag: string): string[] => /class="([^"]*)"/.exec(tag)?.[1].split(/\s+/) ?? [];
  const text = (markup: string): string => markup.replace(/<[^>]+>/g, '');

  const renderPlay = (props: { disabled?: boolean; disabledReason?: string } = {}) =>
    renderToStaticMarkup(
      <InterventionPanel
        variant="play"
        interventions={INTERVENTIONS}
        onApply={noop}
        getLabel={playButtonText}
        {...props}
      />,
    );

  it('has no heading and none of the clinician box classes', () => {
    for (const props of [{}, { disabled: true }, { disabledReason: 'Waiting for the simulation' }]) {
      const html = renderPlay(props);
      expect(html).not.toContain('<h3');
      expect(text(html)).not.toContain('Interventions');
      const tokens = classTokens(html);
      for (const t of CLINICIAN_TOKENS) expect(tokens.has(t)).toBe(false);
    }
  });

  it('enabled: buttons in array order with getLabel text and the play button classes', () => {
    const html = renderPlay();
    expect(buttonBodies(html).map(text)).toEqual(INTERVENTIONS.map(playButtonText));
    const tags = buttonTags(html);
    expect(tags).toHaveLength(INTERVENTIONS.length);
    for (const tag of tags) {
      expect(tag).not.toContain('disabled=""');
      const tokens = tagTokens(tag);
      expect(tokens).toContain('border-[var(--sp-accent)]');
      expect(tokens).toContain('text-left');
      expect(tokens).toContain('w-full');
      expect(tokens).not.toContain('border-dashed');
    }
    expect(html).not.toContain('intervention-lock');
    expect(html).not.toContain('Not available right now');
  });

  it('disabled: each button is disabled, dashed, with a decorative lock and "Not available right now"', () => {
    const html = renderPlay({ disabled: true });
    const tags = buttonTags(html);
    const bodies = buttonBodies(html);
    expect(tags).toHaveLength(INTERVENTIONS.length);
    tags.forEach((tag, k) => {
      expect(tag).toContain('disabled=""');
      expect(tagTokens(tag)).toContain('border-dashed');
      expect(bodies[k]).toMatch(/<svg data-part="intervention-lock" aria-hidden="true"/);
      expect(bodies[k]).toContain(PLAY_NOT_AVAILABLE);
      expect(bodies[k].split('Not available right now')).toHaveLength(2);
      expect(text(bodies[k])).toBe(`${playButtonText(INTERVENTIONS[k])}Not available right now`);
    });
    expect(html).not.toMatch(/<p[\s>]/);
  });

  it('disabledReason: shown once, below the buttons', () => {
    const reason = 'Waiting for the simulation';
    const html = renderPlay({ disabledReason: reason });
    expect(html.split(reason)).toHaveLength(2);
    expect(html.indexOf(reason)).toBeGreaterThan(html.lastIndexOf('</button>'));
    expect(html).toContain(`<p class="text-base">${reason}</p>`);
    for (const tag of buttonTags(html)) expect(tag).toContain('disabled=""');
  });
});

describe('InterventionPanel default variant', () => {
  it('renders byte-identical markup to variant="clinician"', () => {
    const cases: Array<{ disabled?: boolean; disabledReason?: string }> = [
      {},
      { disabled: true },
      { disabledReason: 'Waiting for the simulation' },
    ];
    for (const props of cases) {
      for (const getLabel of [undefined, playButtonText]) {
        const byDefault = renderToStaticMarkup(
          <InterventionPanel interventions={INTERVENTIONS} onApply={noop} getLabel={getLabel} {...props} />,
        );
        const clinician = renderToStaticMarkup(
          <InterventionPanel
            variant="clinician"
            interventions={INTERVENTIONS}
            onApply={noop}
            getLabel={getLabel}
            {...props}
          />,
        );
        expect(byDefault).toBe(clinician);
      }
    }
  });
});

describe('HintPanel noTopMargin', () => {
  const HINTS: Hint[] = [{ text: 'First hint' }, { text: 'Second hint' }, { text: 'Third hint' }];
  const DEFAULT_ROOT_CLASS = 'mt-4 flex flex-col gap-3 text-base text-[var(--sp-text)]';
  const rootClass = (html: string): string | undefined =>
    /^<section data-part="hint-panel"[^>]*class="([^"]*)"/.exec(html)?.[1];
  const renderHints = (hintsRevealed: number, noTopMargin?: boolean) =>
    renderToStaticMarkup(
      <HintPanel hints={HINTS} hintsRevealed={hintsRevealed} onReveal={noop} noTopMargin={noTopMargin} />,
    );

  it('default output is unchanged and equals noTopMargin={false}', () => {
    for (const revealed of [0, 2, 3]) {
      const byDefault = renderHints(revealed);
      expect(rootClass(byDefault)).toBe(DEFAULT_ROOT_CLASS);
      expect(renderHints(revealed, false)).toBe(byDefault);
    }
  });

  it('noTopMargin drops only mt-4 from the root', () => {
    for (const revealed of [0, 2, 3]) {
      const byDefault = renderHints(revealed);
      const flush = renderHints(revealed, true);
      expect(rootClass(flush)?.split(/\s+/)).not.toContain('mt-4');
      expect(rootClass(flush)).toBe('flex flex-col gap-3 text-base text-[var(--sp-text)]');
      expect(flush).toBe(byDefault.replace(`class="${DEFAULT_ROOT_CLASS}"`, `class="${rootClass(flush)}"`));
    }
  });
});
