/**
 * Session screen: what the session page shows for a `useSimulationSession`
 * result (play-mode design "Session page refactor"; Requirements 1.1–1.6,
 * 1.8–1.11).
 *
 * Presentational only: it makes no API call and owns no session state. The
 * Safety_Notice is rendered exactly once, above every mode. The loading and
 * connecting screens replace only the view content; the hook keeps running.
 */

'use client';

import type { SimulationSession } from '@/hooks/useSimulationSession';
import type { SessionUiState } from '@/lib/sessionState';
import { ClinicianView } from './ClinicianView';
import { PlayView } from './PlayView';
import { SafetyNotice } from './SafetyNotice';
import { ViewSwitcher } from './ViewSwitcher';

export const LOADING_TEXT = 'Loading session...';
export const CONNECTING_TEXT = 'Connecting to simulation...';

export type SessionScreenMode = 'loading' | 'connecting' | 'play' | 'clinician';

/**
 * Which content the screen shows, in this order:
 * - 'loading' while the case loads;
 * - 'connecting' while the Vitals_Stream is not open and no sample has been
 *   delivered yet (after a sample, a disconnect keeps the current view);
 * - 'play' when the Play view is selected and the case has a Play_Section;
 * - 'clinician' otherwise (including a case that failed to load).
 */
export function sessionScreenMode(
  state: Pick<SessionUiState, 'caseStatus' | 'connected' | 'latestSample' | 'view' | 'caseData'>,
): SessionScreenMode {
  if (state.caseStatus === 'loading') return 'loading';
  if (!state.connected && state.latestSample === null) return 'connecting';
  if (state.view === 'play' && state.caseData?.play !== undefined) return 'play';
  return 'clinician';
}

export interface SessionScreenProps {
  sim: SimulationSession;
}

export function SessionScreen({ sim }: SessionScreenProps) {
  const { state, actions, notices } = sim;
  const mode = sessionScreenMode(state);

  const switcher = (
    <ViewSwitcher
      view={state.view}
      caseStatus={state.caseStatus}
      hasPlay={state.caseData?.play !== undefined}
      onSelect={actions.selectView}
    />
  );

  return (
    <>
      <SafetyNotice />
      {mode === 'play' ? (
        <main className="min-h-[calc(100vh-var(--notice-h))]">
          <PlayView sim={sim} toolbarStart={switcher} />
        </main>
      ) : (
        <main className="min-h-[calc(100vh-var(--notice-h))] p-6 space-y-6">
          {switcher}
          {mode === 'loading' && (
            <div role="status" className="flex flex-col items-center justify-center py-24 text-center">
              <div className="text-xl">{LOADING_TEXT}</div>
            </div>
          )}
          {mode === 'connecting' && (
            <div role="status" className="flex flex-col items-center justify-center py-24 text-center">
              <div className="text-xl">{CONNECTING_TEXT}</div>
              {notices.streamError && <div className="mt-2 text-base text-red-400">{notices.streamError}</div>}
            </div>
          )}
          {mode === 'clinician' && <ClinicianView sim={sim} />}
        </main>
      )}
    </>
  );
}
