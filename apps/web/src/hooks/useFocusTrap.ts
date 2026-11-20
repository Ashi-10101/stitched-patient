/**
 * Focus trap for the play-mode modal panels (Rewind_Panel, Ending_Screen).
 *
 * While active, `useFocusTrap` moves focus to the first focusable control in
 * the container, wraps Tab and Shift+Tab inside it, calls `onEscape` on Escape
 * and, when it deactivates or unmounts, returns focus to a given element
 * (Requirements 11.5, 11.6, 11.10).
 *
 * The wrap rule lives in the pure helper `nextFocusIndex`, so tests need no DOM.
 *
 * Traps can be nested (the Rewind_Panel opens on top of the Ending_Screen).
 * Active traps are kept on a module-level stack and only the topmost trap
 * handles Tab, Shift+Tab and Escape. When the top trap closes, the one below
 * becomes the top again without re-running its initial focus.
 */

import { useEffect, useRef, type RefObject } from 'react';

/**
 * Elements the trap cycles through. Elements with `aria-disabled="true"` are
 * deliberately not excluded: they stay focusable (the View_Switcher relies on
 * this). Buttons and form fields with the `disabled` attribute do not match.
 */
export const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Index of the control that should receive focus after Tab or Shift+Tab.
 *
 * - `count` of 0, negative or not finite: returns -1 (nothing to focus).
 * - Tab (`shiftKey` false): returns `current + 1`; from the last index
 *   (`count - 1`) it wraps to 0.
 * - Shift+Tab (`shiftKey` true): returns `current - 1`; from the first index
 *   (0) it wraps to `count - 1`.
 * - `current` outside [0, count), including -1, `count`, larger values,
 *   non-integers and NaN: returns 0 for Tab and `count - 1` for Shift+Tab.
 */
export function nextFocusIndex(current: number, count: number, shiftKey: boolean): number {
  if (!Number.isFinite(count) || count <= 0) return -1;
  const last = Math.floor(count) - 1;
  if (last < 0) return -1;
  const inRange = Number.isInteger(current) && current >= 0 && current <= last;
  if (!inRange) return shiftKey ? last : 0;
  if (shiftKey) return current === 0 ? last : current - 1;
  return current === last ? 0 : current + 1;
}

/** Active traps, bottom first. The last entry is the trap that handles keys. */
const trapStack: symbol[] = [];

/** A fresh, unique token for one activation of a trap. */
export function createTrapToken(): symbol {
  return Symbol('focus-trap');
}

/**
 * Puts `token` on top of the stack. A token that is already on the stack is
 * ignored (not duplicated and not moved).
 */
export function pushTrap(token: symbol): void {
  if (!trapStack.includes(token)) trapStack.push(token);
}

/** Removes `token` wherever it is in the stack. Unknown tokens are ignored. */
export function removeTrap(token: symbol): void {
  const index = trapStack.indexOf(token);
  if (index >= 0) trapStack.splice(index, 1);
}

/** True when `token` is the topmost active trap. False for an empty stack. */
export function isTopTrap(token: symbol): boolean {
  return trapStack.length > 0 && trapStack[trapStack.length - 1] === token;
}

/** Empties the stack. For tests only. */
export function resetTrapStack(): void {
  trapStack.length = 0;
}

export type ReturnFocusTarget = HTMLElement | null | RefObject<HTMLElement | null>;

export interface FocusTrapOptions {
  /** The trap runs while this is true. */
  active: boolean;
  /** Called when Escape is pressed while the trap is active. */
  onEscape?: () => void;
  /** Element (or ref to it) that gets focus back when the trap deactivates. */
  returnFocusTo?: ReturnFocusTarget;
}

function resolveTarget(target: ReturnFocusTarget | undefined): HTMLElement | null {
  if (!target) return null;
  if ('current' in target) return target.current;
  return target;
}

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * Traps keyboard focus inside `containerRef` while `options.active` is true.
 * The keydown listener is attached to `document`, so Tab is still trapped
 * when focus has left the container (for example after a pointer click).
 * When traps are nested, only the topmost one handles keys.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement>, options: FocusTrapOptions): void {
  const { active } = options;
  const onEscapeRef = useRef(options.onEscape);
  const returnFocusRef = useRef(options.returnFocusTo);
  onEscapeRef.current = options.onEscape;
  returnFocusRef.current = options.returnFocusTo;

  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    const container = containerRef.current;
    if (!container) return;

    const token = createTrapToken();
    pushTrap(token);

    const first = focusableIn(container)[0];
    if (first) {
      first.focus();
    } else if (container.getAttribute('tabindex') === '-1') {
      container.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopTrap(token)) return;
      if (event.key === 'Escape') {
        onEscapeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      event.preventDefault();
      const controls = focusableIn(container);
      const current = controls.indexOf(document.activeElement as HTMLElement);
      const next = nextFocusIndex(current, controls.length, event.shiftKey);
      if (next >= 0) controls[next].focus();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      removeTrap(token);
      const target = resolveTarget(returnFocusRef.current);
      if (target && target.isConnected) target.focus();
    };
  }, [active, containerRef]);
}
