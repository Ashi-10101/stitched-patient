/**
 * Session page: opens one simulation session and shows it in the Play or
 * Clinician view. All I/O lives in `useSimulationSession`; the layout lives
 * in `SessionScreen`.
 */

'use client';

import { useParams } from 'next/navigation';
import { useSimulationSession } from '@/hooks/useSimulationSession';
import { SessionScreen } from '@/components/SessionScreen';

export default function SessionPage() {
  const { sessionId } = useParams() as { sessionId: string };
  const sim = useSimulationSession(sessionId);
  return <SessionScreen sim={sim} />;
}
