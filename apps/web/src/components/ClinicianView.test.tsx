import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getAlarmBgColor, getAlarmColor, getAlarmState } from '@/lib/alarms';
import { initialSessionState, sessionReducer, type SessionAction, type SessionUiState } from '@/lib/sessionState';
import type {
  SimulationSession,
  SimulationSessionActions,
  SimulationSessionNotices,
} from '@/hooks/useSimulationSession';
import { buildInterventionEntry } from '@/lib/interventionRecord';
import { checkedScriptedLine, type SpeechKey } from '@/lib/speechSelector';
import { CASE, CASE_LEFT, CASE_RIGHT } from '@/test/caseFixtures';
import type { CaseData, SessionMetadata, VitalSigns } from '@/types';
import {
  ACTION_ERROR_TEXT,
  CASE_NOT_LOADED_TEXT,
  ClinicianView,
  PAUSE_FAILED_TEXT,
  clinicianAlarmState,
  forkFromTimeline,
  forkTimeFor,
  interventionsDisabled,
  nextActionError,
  runTimelineFork,
} from './ClinicianView';
import { EndingBanner, openPlayView } from './EndingBanner';

const LABELS = ['Heart Rate', 'SpO₂', 'MAP', 'Resp Rate', 'EtCO₂', 'Tidal Volume'];
const ALARM_CLASSES = (['normal', 'warning', 'critical'] as const).flatMap((s) => [
  getAlarmColor(s),
  getAlarmBgColor(s),
]);
const OLD_CHIP = 'Educational simulation, not for clinical use';

const SESSION: SessionMetadata = {
  session_id: 's1',
  case_id: CASE.id,
  created_at: '',
  current_branch_id: 'b1',
  branches: [{ branch_id: 'b1', created_at: '', event_count: 0 }],
};

/** Normal-band vitals for the fixture case, at time `t`. */
function sample(t: number, over: Partial<VitalSigns> = {}): VitalSigns {
  return {
    simulation_time: t,
    heart_rate: 80,
    respiratory_rate: 16,
    spo2: 0.97,
    mean_arterial_pressure: 90,
    etco2: 40,
    tidal_volume: 500,
    ...over,
  };
}

function build(...actions: SessionAction[]): SessionUiState {
  return actions.reduce(sessionReducer, initialSessionState());
}

const LOADED: SessionAction[] = [
  { type: 'caseLoaded', caseData: CASE, storedView: 'clinician' },
  { type: 'sessionLoaded', session: SESSION },
  {
    type: 'checkpointsLoaded',
    byBranch: { b1: [{ checkpoint_id: 'c1', simulation_time: 42, created_at: '', is_automatic: true }] },
  },
  { type: 'connectionChanged', connected: true },
];

function stubActions(): SimulationSessionActions {
  return {
    selectView: vi.fn(),
    setPlaying: vi.fn(async () => {}),
    setSpeed: vi.fn(async () => {}),
    applyIntervention: vi.fn(async () => 'ok' as const),
    revealHint: vi.fn(),
    loadLineageCheckpoints: vi.fn(async () => 'ok' as const),
    fork: vi.fn(async () => 'ok' as const),
    performExam: vi.fn(),
  };
}

function render(state: SessionUiState, notices: Partial<SimulationSessionNotices> = {}): string {
  return renderToStaticMarkup(
    <ClinicianView
      sim={{ state, actions: stubActions(), notices: { pauseFailed: false, streamError: null, ...notices } }}
    />,
  );
}

/** Markup of the VitalSign tile with the given label. */
function tile(html: string, label: string): string {
  const parts = html.split('<div class="flex flex-col items-center');
  const found = parts.find((p) => p.includes(`>${label}</div>`));
  if (!found) throw new Error(`tile ${label} not found`);
  // A tile is its outer div plus three inner divs: it ends at the fourth `</div>`.
  return found.split('</div>').slice(0, 4).join('</div>');
}

function expectNeutral(html: string): void {
  for (const label of LABELS) {
    const t = tile(html, label);
    expect(t).toContain('text-gray-100');
    expect(t).toContain('bg-gray-900');
    for (const cls of ALARM_CLASSES) expect(t).not.toContain(cls);
  }
}

describe('ClinicianView', () => {
  it('shows clinical labels and no Play_Label', () => {
    const html = render(build(...LOADED, { type: 'sampleReceived', sample: sample(10) }));
    for (const i of CASE.interventions) {
      expect(html).toContain(i.label);
      if (i.playLabel) expect(html).not.toContain(i.playLabel);
    }
  });

  it('gives a warning-band SpO2 (0.93) the warning colour', () => {
    const html = render(build(...LOADED, { type: 'sampleReceived', sample: sample(10, { spo2: 0.93 }) }));
    const t = tile(html, 'SpO₂');
    expect(t).toContain(getAlarmColor('warning'));
    expect(t).toContain(getAlarmBgColor('warning'));
    expect(t).toContain('93.0');
    expect(tile(html, 'Heart Rate')).toContain(getAlarmColor('normal'));
  });

  it('keeps the readout texts for the baseline sample (15.14)', () => {
    const baseline = sample(10, {
      heart_rate: 72,
      respiratory_rate: 12,
      spo2: 0.974,
      mean_arterial_pressure: 95,
      etco2: 36,
      tidal_volume: 535,
    });
    const html = render(build(...LOADED, { type: 'sampleReceived', sample: baseline }));
    const expected: Record<string, string> = {
      'Heart Rate': '72',
      'SpO₂': '97.4',
      MAP: '95',
      'Resp Rate': '12',
      'EtCO₂': '36',
      'Tidal Volume': '535',
    };
    for (const [label, text] of Object.entries(expected)) {
      expect(tile(html, label)).toContain(`tabular-nums ${getAlarmColor('normal')}">${text}</div>`);
    }
  });

  it('shows raw RR 11.9999 as "12" with the normal colour, not the warning colour (15.17)', () => {
    const html = render(build(...LOADED, { type: 'sampleReceived', sample: sample(10, { respiratory_rate: 11.9999 }) }));
    const t = tile(html, 'Resp Rate');
    expect(t).toContain('>12</div>');
    expect(t).toContain(getAlarmColor('normal'));
    expect(t).toContain(getAlarmBgColor('normal'));
    expect(t).not.toContain(getAlarmColor('warning'));
    expect(t).not.toContain(getAlarmBgColor('warning'));
  });

  it('clinicianAlarmState: undefined without alarms or a Displayed_Value, normal without thresholds', () => {
    expect(clinicianAlarmState(null, 'heartRate', 72)).toBeUndefined();
    expect(clinicianAlarmState(CASE.alarms, 'heartRate', NaN)).toBeUndefined();
    const alarms = structuredClone(CASE.alarms);
    delete alarms.etCO2;
    expect(clinicianAlarmState(alarms, 'etCO2', 10)).toBe('normal');
    expect(clinicianAlarmState(CASE.alarms, 'respiratoryRate', 11.9999)).toBe('normal');
    expect(clinicianAlarmState(CASE.alarms, 'spO2', 0.93)).toBe('warning');
  });

  it('shows neutral readouts before the first sample', () => {
    expectNeutral(render(build(...LOADED)));
  });

  it('shows the Ending banner only when an Ending is set', () => {
    const none = render(build(...LOADED, { type: 'sampleReceived', sample: sample(10) }));
    expect(none).not.toContain('Ending:');
    expect(none).not.toContain('Open Play view');

    const limit = CASE.play?.endings.lost.timeLimitSeconds;
    expect(limit).toBeTypeOf('number');
    const lostState = build(...LOADED, { type: 'sampleReceived', sample: sample(limit as number) });
    expect(lostState.ending.ending).toBe('lost');
    const lost = render(lostState);
    expect(lost).toContain('Ending: Lost');
    expect(lost).toContain('Open Play view');
    expect(lost).toContain('role="status"');
  });

  it('shows neutral readouts and the message when the case failed', () => {
    const state = build(
      { type: 'caseFailed', message: 'boom' },
      { type: 'sessionLoaded', session: SESSION },
      { type: 'connectionChanged', connected: true },
      { type: 'sampleReceived', sample: sample(10, { spo2: 0.5, heart_rate: 200 }) },
    );
    const html = render(state);
    expectNeutral(html);
    expect(html).toContain(CASE_NOT_LOADED_TEXT);
    expect(html).not.toContain('Interventions');
  });

  it('does not contain the old warning chip', () => {
    expect(render(build(...LOADED))).not.toContain(OLD_CHIP);
  });

  it('shows the stream error in the error box', () => {
    const html = render(build(...LOADED), { streamError: 'WebSocket error - connection lost' });
    expect(html).toMatch(/<div class="p-3 bg-red-500\/10 border border-red-500 rounded text-red-400">WebSocket error - connection lost<\/div>/);
  });

  it('gives EtCO2 and Tidal Volume the normal colour when the case has no threshold for them', () => {
    // Under the real case thresholds both values are critical, so a normal colour
    // here shows that absent thresholds are treated as normal.
    const etco2 = 10;
    const tidalVolume = 1000;
    expect(getAlarmState(etco2, CASE.alarms.etCO2!)).toBe('critical');
    expect(getAlarmState(tidalVolume, CASE.alarms.tidalVolume!)).toBe('critical');

    const caseData = structuredClone(CASE);
    delete caseData.alarms.etCO2;
    delete caseData.alarms.tidalVolume;
    const html = render(
      build(
        { type: 'caseLoaded', caseData, storedView: 'clinician' },
        ...LOADED.slice(1),
        { type: 'sampleReceived', sample: sample(10, { etco2: etco2, tidal_volume: tidalVolume }) },
      ),
    );

    const others = (['warning', 'critical'] as const).flatMap((s) => [getAlarmColor(s), getAlarmBgColor(s)]);
    for (const label of ['EtCO₂', 'Tidal Volume']) {
      const t = tile(html, label);
      expect(t).toContain(getAlarmColor('normal'));
      expect(t).toContain(getAlarmBgColor('normal'));
      for (const cls of others) expect(t).not.toContain(cls);
    }
  });

  it('disables interventions while not connected', () => {
    const state = build(...LOADED.slice(0, 3));
    expect(render(state)).toContain('Not available right now');
    expect(interventionsDisabled(true, false)).toBe(false);
    expect(interventionsDisabled(false, false)).toBe(true);
    expect(interventionsDisabled(true, true)).toBe(true);
  });

  it('interventionsDisabled takes no fork input: two parameters, same results (8.16)', () => {
    expect(interventionsDisabled.length).toBe(2);
    expect(interventionsDisabled(true, false)).toBe(false);
    expect(interventionsDisabled(false, false)).toBe(true);
    expect(interventionsDisabled(true, true)).toBe(true);
    expect(interventionsDisabled(false, true)).toBe(true);
  });
});

describe('ClinicianView without the bedside exam (bedside-exam decision 9, 12.6)', () => {
  const VARIANTS: Array<[string, CaseData, string]> = [
    ['left', CASE_LEFT, 'needle-decompression-left'],
    ['right', CASE_RIGHT, 'needle-decompression-right'],
  ];

  it.each(VARIANTS)(
    'shows no Exam_Button, no Findings_List and no Side_Reveal_Text for the %s Resolved_Case',
    (_id, caseData, requiredId) => {
      const base: SessionAction[] = [{ type: 'caseLoaded', caseData, storedView: 'clinician' }, ...LOADED.slice(1)];
      const none = build(...base, { type: 'sampleReceived', sample: sample(10) });
      const limit = caseData.play!.endings.lost.timeLimitSeconds as number;
      const lost = build(...base, { type: 'sampleReceived', sample: sample(limit) });
      const rescued = build(
        ...base,
        {
          type: 'interventionSucceeded',
          entry: buildInterventionEntry(caseData.interventions.find((i) => i.id === requiredId)!, 40, 'b1'),
        },
        { type: 'sampleReceived', sample: sample(40) },
        { type: 'sampleReceived', sample: sample(70) },
      );
      expect(caseData.play?.exam).toBeDefined();
      expect([none, lost, rescued].map((s) => s.ending.ending)).toEqual(['none', 'lost', 'rescued']);

      const sideRevealText = caseData.play!.sideRevealText!;
      expect(sideRevealText.trim()).not.toBe('');
      for (const state of [none, lost, rescued]) {
        const html = render(state);
        expect(html).not.toContain('data-control="exam"');
        expect(html).not.toContain('data-part="findings-list"');
        expect(html).not.toContain('data-part="side-reveal"');
        expect(html).not.toContain(sideRevealText);
      }
    },
  );
});

describe('forkTimeFor', () => {
  it('returns the Simulation_Time of a current-Branch Checkpoint', () => {
    expect(forkTimeFor(build(...LOADED), 'c1')).toBe(42);
  });

  it('returns undefined for an unknown Checkpoint or before the Session loads', () => {
    expect(forkTimeFor(build(...LOADED), 'missing')).toBeUndefined();
    expect(forkTimeFor(initialSessionState(), 'c1')).toBeUndefined();
  });
});

describe('forkFromTimeline', () => {
  const state = build(
    { type: 'sessionLoaded', session: SESSION },
    {
      type: 'checkpointsLoaded',
      byBranch: {
        b1: [{ checkpoint_id: 'c90', simulation_time: 90, created_at: '', is_automatic: true }],
        b2: [{ checkpoint_id: 'c-other', simulation_time: 30, created_at: '', is_automatic: true }],
      },
    },
  );

  it('forks once at the Simulation_Time of a current-Branch Checkpoint', () => {
    const fork = vi.fn();
    expect(forkFromTimeline(state, fork, 'c90')).toBe(true);
    expect(fork).toHaveBeenCalledTimes(1);
    expect(fork).toHaveBeenCalledWith('c90', 90);
  });

  it('does not fork for an unknown Checkpoint or one of another Branch', () => {
    expect(state.checkpointsByBranch.b2?.[0]?.checkpoint_id).toBe('c-other');
    const fork = vi.fn();
    expect(forkFromTimeline(state, fork, 'missing')).toBe(false);
    expect(forkFromTimeline(state, fork, 'c-other')).toBe(false);
    expect(fork).not.toHaveBeenCalled();
  });
});

describe('EndingBanner', () => {
  it('renders nothing while the Ending is none', () => {
    expect(renderToStaticMarkup(<EndingBanner ending="none" onSelectView={() => {}} />)).toBe('');
  });

  it('states the Ending in words', () => {
    expect(renderToStaticMarkup(<EndingBanner ending="rescued" onSelectView={() => {}} />)).toContain(
      'Ending: Rescued',
    );
  });

  it('"Open Play view" selects the Play view', () => {
    const select = vi.fn();
    openPlayView(select);
    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith('play');
  });
});

describe('nextActionError', () => {
  it('is true after an error, false after ok, and unchanged after skipped', () => {
    for (const previous of [false, true]) {
      expect(nextActionError(previous, 'error')).toBe(true);
      expect(nextActionError(previous, 'ok')).toBe(false);
      expect(nextActionError(previous, 'skipped')).toBe(previous);
    }
  });
});

describe('runTimelineFork', () => {
  const state = build(...LOADED);

  it.each(['ok', 'error'] as const)('forks once at a known Checkpoint and returns its outcome (%s)', async (result) => {
    const fork = vi.fn(async () => result);
    await expect(runTimelineFork(state, fork, 'c1')).resolves.toBe(result);
    expect(fork).toHaveBeenCalledTimes(1);
    expect(fork).toHaveBeenCalledWith('c1', 42);
  });

  it('returns error when the fork throws', async () => {
    const fork = vi.fn(async (): Promise<'ok' | 'error'> => {
      throw new Error('network down');
    });
    await expect(runTimelineFork(state, fork, 'c1')).resolves.toBe('error');
    expect(fork).toHaveBeenCalledTimes(1);
  });

  it('returns skipped without forking for an unknown Checkpoint', async () => {
    const fork = vi.fn(async () => 'ok' as const);
    await expect(runTimelineFork(state, fork, 'missing')).resolves.toBe('skipped');
    expect(fork).not.toHaveBeenCalled();
  });
});

describe('ClinicianView action error and pause notice', () => {
  const PAUSE_NOTICE = /<p role="status"[^>]*>The simulation could not be paused\.<\/p>/;

  it('exports the spec texts', () => {
    expect(ACTION_ERROR_TEXT).toBe("That didn't work. Please try again.");
    expect(PAUSE_FAILED_TEXT).toBe('The simulation could not be paused.');
  });

  it('shows the pause notice only when notices.pauseFailed is true', () => {
    const state = build(...LOADED, { type: 'sampleReceived', sample: sample(10) });
    expect(render(state, { pauseFailed: true })).toMatch(PAUSE_NOTICE);
    expect(render(state, { pauseFailed: false })).not.toContain(PAUSE_FAILED_TEXT);
  });

  it('shows no action error box before any action', () => {
    // The role="alert" box with ACTION_ERROR_TEXT appears only after a failed
    // Intervention or fork, which sets state inside the component. A static
    // render cannot trigger that, so its behaviour is covered through
    // nextActionError and runTimelineFork above, and here only its absence.
    const html = render(build(...LOADED, { type: 'sampleReceived', sample: sample(10) }), { pauseFailed: true });
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('That didn&#x27;t work. Please try again.');
  });
});

describe('ClinicianView without patient speech (patient-speech 7.8, 12.6)', () => {
  const SPEECH = CASE.play!.speech!;
  const CRITICAL_SPO2_SENTENCE = 'His lips are turning blue and he is fighting for breath.';
  /** Every Speech_Line of the case: Status_Speech_Entries, Early_Lines and Rescued_Lines. */
  const ALL_LINES = [...(SPEECH.status ?? []).flatMap((e) => e.lines), ...(SPEECH.early ?? []), ...(SPEECH.rescued ?? [])];

  /** The case with `play.speech` deleted and nothing else changed. */
  const NO_SPEECH_CASE: CaseData = structuredClone(CASE);
  delete NO_SPEECH_CASE.play!.speech;

  /** The escaping renderToStaticMarkup applies to text content. */
  const esc = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

  const loadedWith = (caseData: CaseData): SessionAction[] => [
    { type: 'caseLoaded', caseData, storedView: 'clinician' },
    ...LOADED.slice(1),
  ];

  const at = (...times: number[]): SessionAction[] =>
    times.map((t) => ({ type: 'sampleReceived', sample: sample(t) }) as SessionAction);

  /** The session actions after the case loads, for one named moment. */
  const MOMENTS: Array<{ name: string; key: SpeechKey; steps: (caseData: CaseData) => SessionAction[] }> = [
    { name: 'before the insult', key: 'silent', steps: () => at(10) },
    { name: 'the first early line', key: 'early', steps: () => at(10, 30) },
    {
      name: 'a Status_Rule line (critical SpO2)',
      key: `status:${CRITICAL_SPO2_SENTENCE}`,
      steps: () => [...at(10, 30), { type: 'sampleReceived', sample: sample(45, { spo2: 0.8 }) }],
    },
    {
      name: 'the rescued Ending',
      key: 'rescued',
      steps: (caseData) => [
        {
          type: 'interventionSucceeded',
          entry: buildInterventionEntry(caseData.interventions.find((i) => i.id === 'needle-decompression-left')!, 40, 'b1'),
        },
        ...at(40, 70),
      ],
    },
  ];

  /**
   * Renders the Clinician_View with a whole session object, as SessionScreen
   * passes the hook result: `speech` is the Displayed_Speech that the hook
   * would show, the checked Scripted_Line. ClinicianViewProps picks only
   * `state`, `actions` and `notices`, so `speech` is present but not read.
   */
  function renderSession(state: SessionUiState): { html: string; speech: string | null } {
    const speech = checkedScriptedLine(state.speech, state.caseData);
    const sim: SimulationSession = {
      state,
      activeInterventions: [],
      statusSentence: null,
      speech,
      actions: stubActions(),
      notices: { pauseFailed: false, streamError: null },
    };
    return { html: renderToStaticMarkup(<ClinicianView sim={sim} />), speech };
  }

  it('the case has a Speech_Section and the copy has none', () => {
    expect(ALL_LINES.length).toBeGreaterThan(0);
    expect(CASE.play?.speech).toBeDefined();
    expect(NO_SPEECH_CASE.play).toBeDefined();
    expect(NO_SPEECH_CASE.play?.speech).toBeUndefined();
  });

  it.each(MOMENTS)('renders equal markup with and without play.speech at $name', ({ key, steps }) => {
    const withSpeech = build(...loadedWith(CASE), ...steps(CASE));
    const withoutSpeech = build(...loadedWith(NO_SPEECH_CASE), ...steps(NO_SPEECH_CASE));

    // Not vacuous: with the Speech_Section the state holds the expected Speech_Key
    // and, except before the insult, a line that passes the Speech_Check.
    expect(withSpeech.speech?.key).toBe(key);
    expect(withoutSpeech.speech?.line ?? null).toBeNull();
    expect(withoutSpeech.ending.ending).toBe(withSpeech.ending.ending);

    const a = renderSession(withSpeech);
    const b = renderSession(withoutSpeech);
    expect(b.speech).toBeNull();
    if (key === 'silent') {
      expect(a.speech).toBeNull();
    } else {
      expect(a.speech).not.toBeNull();
      expect(a.speech).toBe(withSpeech.speech?.line);
    }

    expect(a.html).toBe(b.html);
    for (const html of [a.html, b.html]) {
      expect(html).not.toContain('data-part="speech-bubble"');
      expect(html).not.toContain('data-part="speech-live"');
      for (const line of ALL_LINES) {
        expect(html).not.toContain(esc(line));
        expect(html).not.toContain(line);
      }
    }
  });
});
