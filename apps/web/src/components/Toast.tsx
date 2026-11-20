/**
 * Short, non-blocking notice for the Play view (design "Toast").
 *
 * `role="status"` makes assistive technology announce the message politely.
 * The toast never takes focus (no autoFocus, no tabIndex). It calls
 * `onClose` once, `TOAST_MS` after it mounts or after `message` changes; the
 * timer is cleared on unmount so a closed view is never called back.
 */

'use client';

import { useEffect, useRef } from 'react';

export const TOAST_MS = 3000;

/**
 * Calls `onClose` once after `ms`. Returns a cancel function that clears the
 * timer; calling it after the timer fired is harmless.
 */
export function startToastTimer(onClose: () => void, ms: number = TOAST_MS): () => void {
  const id = setTimeout(onClose, ms);
  return () => clearTimeout(id);
}

export interface ToastProps {
  message: string;
  onClose: () => void;
}

export function Toast({ message, onClose }: ToastProps) {
  // Keep the latest onClose without restarting the timer when only the
  // callback identity changes.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => startToastTimer(() => onCloseRef.current()), [message]);

  return (
    <div
      role="status"
      data-part="toast"
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border-2 border-[var(--sp-accent)] bg-[var(--sp-bg)] px-4 py-3 text-base font-semibold text-[var(--sp-text)] shadow-lg"
    >
      {message}
    </div>
  );
}

export default Toast;
