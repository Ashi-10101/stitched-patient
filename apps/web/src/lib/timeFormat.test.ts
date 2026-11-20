import { describe, expect, it } from 'vitest';
import { formatMSS, remainingSeconds } from './timeFormat';

describe('formatMSS (Requirements 5.15, 10.5, 12.5)', () => {
  it.each<[number, string]>([
    [0, '0:00'],
    [90, '1:30'],
    [605, '10:05'],
    [725, '12:05'],
    [3600, '60:00'],
  ])('formats %d s as %s', (seconds, expected) => {
    expect(formatMSS(seconds)).toBe(expected);
  });

  it('rounds fractional seconds down', () => {
    expect(formatMSS(90.9)).toBe('1:30');
    expect(formatMSS(0.4)).toBe('0:00');
    expect(formatMSS(59.999)).toBe('0:59');
    expect(formatMSS(119.5)).toBe('1:59');
  });

  it.each<[number, string]>([
    [-1, 'negative'],
    [-0.5, 'negative fraction'],
    [-0, 'negative zero'],
    [Number.NaN, 'NaN'],
    [Number.POSITIVE_INFINITY, 'Infinity'],
    [Number.NEGATIVE_INFINITY, '-Infinity'],
  ])('gives "0:00" for %d (%s)', (seconds) => {
    expect(formatMSS(seconds)).toBe('0:00');
  });
});

describe('remainingSeconds (Requirement 5.15)', () => {
  it('returns the full limit when there is no sample yet', () => {
    expect(remainingSeconds(600, null)).toBe(600);
  });

  it('returns limit minus latest below the limit', () => {
    expect(remainingSeconds(600, 150)).toBe(450);
  });

  it('returns 0 at and above the limit', () => {
    expect(remainingSeconds(600, 600)).toBe(0);
    expect(remainingSeconds(600, 750)).toBe(0);
  });

  it('returns a fractional result unrounded', () => {
    expect(remainingSeconds(600, 150.25)).toBe(449.75);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'treats a non-finite latest (%d) like no sample and returns the full limit',
    (latest) => {
      expect(remainingSeconds(600, latest)).toBe(600);
    },
  );
});
