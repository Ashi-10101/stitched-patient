import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FOCUSABLE_SELECTOR,
  createTrapToken,
  isTopTrap,
  nextFocusIndex,
  pushTrap,
  removeTrap,
  resetTrapStack,
} from './useFocusTrap';

describe('nextFocusIndex', () => {
  it('moves forward with Tab and wraps from the last control to the first', () => {
    expect(nextFocusIndex(0, 3, false)).toBe(1);
    expect(nextFocusIndex(1, 3, false)).toBe(2);
    expect(nextFocusIndex(2, 3, false)).toBe(0);
  });

  it('moves backward with Shift+Tab and wraps from the first control to the last', () => {
    expect(nextFocusIndex(2, 3, true)).toBe(1);
    expect(nextFocusIndex(1, 3, true)).toBe(0);
    expect(nextFocusIndex(0, 3, true)).toBe(2);
  });

  it('stays on the only control with Tab and Shift+Tab', () => {
    expect(nextFocusIndex(0, 1, false)).toBe(0);
    expect(nextFocusIndex(0, 1, true)).toBe(0);
  });

  it('returns -1 when there is nothing to focus', () => {
    expect(nextFocusIndex(0, 0, false)).toBe(-1);
    expect(nextFocusIndex(-1, 0, true)).toBe(-1);
    expect(nextFocusIndex(0, -2, false)).toBe(-1);
    expect(nextFocusIndex(0, Number.NaN, false)).toBe(-1);
    expect(nextFocusIndex(0, Number.POSITIVE_INFINITY, true)).toBe(-1);
  });

  it('goes to the first control with Tab when the current index is outside the list', () => {
    for (const current of [-1, 3, 10, 1.5, Number.NaN]) {
      expect(nextFocusIndex(current, 3, false)).toBe(0);
    }
  });

  it('goes to the last control with Shift+Tab when the current index is outside the list', () => {
    for (const current of [-1, 3, 10, 1.5, Number.NaN]) {
      expect(nextFocusIndex(current, 3, true)).toBe(2);
    }
  });
});

describe('FOCUSABLE_SELECTOR', () => {
  it('matches enabled controls, links with href and tabbable elements', () => {
    for (const part of [
      'button:not([disabled])',
      'a[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ]) {
      expect(FOCUSABLE_SELECTOR).toContain(part);
    }
  });

  it('keeps aria-disabled elements focusable', () => {
    expect(FOCUSABLE_SELECTOR).not.toContain('aria-disabled');
  });
});

describe('trap stack', () => {
  beforeEach(() => resetTrapStack());
  afterEach(() => resetTrapStack());

  it('makes only the most recently pushed trap the top', () => {
    const outer = createTrapToken();
    const inner = createTrapToken();
    pushTrap(outer);
    pushTrap(inner);
    expect(isTopTrap(inner)).toBe(true);
    expect(isTopTrap(outer)).toBe(false);
  });

  it('makes the trap below the top again when the top is removed', () => {
    const outer = createTrapToken();
    const inner = createTrapToken();
    pushTrap(outer);
    pushTrap(inner);
    removeTrap(inner);
    expect(isTopTrap(outer)).toBe(true);
    expect(isTopTrap(inner)).toBe(false);
  });

  it('keeps the top when a trap below it is removed', () => {
    const outer = createTrapToken();
    const inner = createTrapToken();
    pushTrap(outer);
    pushTrap(inner);
    removeTrap(outer);
    expect(isTopTrap(inner)).toBe(true);
    removeTrap(inner);
    expect(isTopTrap(outer)).toBe(false);
  });

  it('ignores removing a trap twice or removing an unknown token', () => {
    const outer = createTrapToken();
    const inner = createTrapToken();
    pushTrap(outer);
    pushTrap(inner);
    removeTrap(inner);
    removeTrap(inner);
    removeTrap(createTrapToken());
    expect(isTopTrap(outer)).toBe(true);
  });

  it('reports no top trap when the stack is empty', () => {
    const token = createTrapToken();
    expect(isTopTrap(token)).toBe(false);
    pushTrap(token);
    removeTrap(token);
    expect(isTopTrap(token)).toBe(false);
  });

  it('ignores pushing a token that is already on the stack', () => {
    const outer = createTrapToken();
    const inner = createTrapToken();
    pushTrap(outer);
    pushTrap(inner);
    pushTrap(outer);
    expect(isTopTrap(inner)).toBe(true);
    removeTrap(inner);
    expect(isTopTrap(outer)).toBe(true);
    removeTrap(outer);
    expect(isTopTrap(outer)).toBe(false);
  });

  it('leaves only the second token after a Strict-Mode-like activate, clean up, activate', () => {
    const first = createTrapToken();
    const second = createTrapToken();
    pushTrap(first);
    removeTrap(first);
    pushTrap(second);
    expect(isTopTrap(second)).toBe(true);
    expect(isTopTrap(first)).toBe(false);
    removeTrap(second);
    expect(isTopTrap(second)).toBe(false);
  });
});
