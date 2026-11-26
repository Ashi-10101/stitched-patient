/**
 * Speech live region (patient-speech Requirements 7.5 to 7.7; design
 * "SpeechLiveRegion.tsx", D8, D9).
 *
 * A polite, atomic, visually hidden region that holds only the
 * Displayed_Speech, separate from the StatusLine's region and from
 * `exam-live`. A repeated text renders the same content, so assistive
 * technology announces nothing new; a new text replaces the content and is
 * announced once; silence (null or blank) empties the region (7.6).
 *
 * With `fillAfterMount` the region renders empty first and shows its text only
 * after mount, because a region that already holds text when it mounts is not
 * reliably announced (D9). The Ending_Screen uses this; the Play_View's region
 * stays mounted while lines change and renders its text directly.
 */

'use client';

import { useEffect, useState } from 'react';

export interface SpeechLiveRegionProps {
  text: string | null;
  /** Render empty first and set the text after mount (D9). */
  fillAfterMount?: boolean;
}

export function SpeechLiveRegion({ text, fillAfterMount = false }: SpeechLiveRegionProps) {
  const [mounted, setMounted] = useState(!fillAfterMount);
  useEffect(() => setMounted(true), []);
  const shown = mounted && text !== null && /\S/.test(text) ? text : null;
  return (
    <div data-part="speech-live" className="sr-only" aria-live="polite" aria-atomic="true">
      {shown !== null && <p>{shown}</p>}
    </div>
  );
}
