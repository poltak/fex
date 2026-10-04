import { describe, expect, it } from 'vitest';
import { formatHistoryDate, formatHistoryRate, getHistoryChange, getHistoryRange, HISTORY_PERIODS, validateHistoryRecord, validateHistoryRows } from '../src/history.js';

describe('history date ranges', () => {
  it('uses inclusive UTC dates and subtracts calendar periods', () => {
    const now = Date.parse('2024-03-31T23:30:00-07:00');
    expect(getHistoryRange({ period: '1W', now })).toEqual({ from: '2024-03-25', to: '2024-04-01' });
    expect(getHistoryRange({ period: '1M', now: Date.parse('2024-03-31T12:00:00Z') })).toEqual({ from: '2024-02-29', to: '2024-03-31' });
    expect(getHistoryRange({ period: '3M', now: Date.parse('2024-03-31T12:00:00Z') })).toEqual({ from: '2023-12-31', to: '2024-03-31' });
  });

  it('clamps leap-year subtraction and rejects unknown periods', () => {
    expect(getHistoryRange({ period: '1Y', now: Date.parse('2024-02-29T00:00:00Z') })).toEqual({ from: '2023-02-28', to: '2024-02-29' });
    expect(getHistoryRange({ period: '5Y', now: Date.parse('2026-09-27T00:00:00Z') })).toEqual({ from: '2021-09-27', to: '2026-09-27' });
    expect(HISTORY_PERIODS).toEqual(['1W', '1M', '3M', '1Y', '5Y']);
    expect(() => getHistoryRange({ period: '2M', now: 0 })).toThrow('period');
  });
});

describe('history response and record validation', () => {
  it('sorts points and keeps one exact duplicate date', () => {
    expect(validateHistoryRows({
      base: 'USD', quote: 'EUR', from: '2026-01-01', to: '2026-01-03',
      rows: [
        { base: 'USD', quote: 'EUR', date: '2026-01-03', rate: 0.92 },
        { base: 'USD', quote: 'EUR', date: '2026-01-01', rate: '0.9' },
        { base: 'USD', quote: 'EUR', date: '2026-01-01', rate: '0.9' },
      ],
    })).toEqual([{ date: '2026-01-01', rate: '0.9' }, { date: '2026-01-03', rate: '0.92' }]);
    expect(validateHistoryRows({ base: 'USD', quote: 'EUR', from: '2026-01-01', to: '2026-01-03', rows: [] })).toEqual([]);
  });

  it.each([
    [{ base: 'USD', quote: 'JPY', date: '2026-01-01', rate: '1' }],
    [{ base: 'USD', quote: 'EUR', date: '2026-02-30', rate: '1' }],
    [{ base: 'USD', quote: 'EUR', date: '2026-01-04', rate: '1' }],
    [{ base: 'USD', quote: 'EUR', date: '2026-01-01', rate: '0' }],
    [{ base: 'USD', quote: 'EUR', date: '2026-01-01', rate: 'NaN' }],
  ])('rejects malformed API row %j', rows => {
    expect(() => validateHistoryRows({ base: 'USD', quote: 'EUR', from: '2026-01-01', to: '2026-01-03', rows })).toThrow();
  });

  it('rejects conflicting duplicate dates and malformed arrays', () => {
    const row = { base: 'USD', quote: 'EUR', date: '2026-01-01', rate: '0.9' };
    expect(() => validateHistoryRows({ base: 'USD', quote: 'EUR', from: '2026-01-01', to: '2026-01-03', rows: [row, { ...row, rate: '0.91' }] })).toThrow('conflicting');
    expect(() => validateHistoryRows({ base: 'USD', quote: 'EUR', from: '2026-01-01', to: '2026-01-03', rows: {} })).toThrow('response');
  });

  it('normalizes records and rejects points outside their query bounds', () => {
    const input = { base: 'USD', quote: 'EUR', from: '2026-01-01', to: '2026-01-03', points: [{ date: '2026-01-03', rate: 0.92 }, { date: '2026-01-01', rate: 0.9 }], checkedAt: 10, lastUsedAt: 11 };
    expect(validateHistoryRecord(input)).toEqual({ ...input, points: [{ date: '2026-01-01', rate: '0.9' }, { date: '2026-01-03', rate: '0.92' }] });
    expect(() => validateHistoryRecord({ ...input, points: [{ date: '2026-01-04', rate: '1' }] })).toThrow('point');
  });
});

describe('history calculations and presentation helpers', () => {
  it('calculates signed changes with decimal precision and handles flat or short series', () => {
    expect(getHistoryChange({ points: [{ date: '2026-01-01', rate: '0.00000000000000000001' }, { date: '2026-01-02', rate: '0.00000000000000000002' }] })).toEqual({ value: '+100', direction: 'up' });
    expect(getHistoryChange({ points: [{ date: '2026-01-01', rate: '2' }, { date: '2026-01-02', rate: '1.5' }] })).toEqual({ value: '-25', direction: 'down' });
    expect(getHistoryChange({ points: [{ date: '2026-01-01', rate: '2' }, { date: '2026-01-02', rate: '2' }] })).toEqual({ value: '0', direction: 'unchanged' });
    expect(getHistoryChange({ points: [{ date: '2026-01-01', rate: '2' }] })).toBeNull();
  });

  it('formats dates in UTC and rates in the requested locale', () => {
    expect(formatHistoryDate({ date: '2026-09-27', locale: 'en-US' })).toBe('Sep 27, 2026');
    expect(formatHistoryDate({ date: '2026-02-30' })).toBe('—');
    expect(formatHistoryRate({ rate: '26241.5', locale: 'en-US' })).toBe('26,241.5');
    expect(formatHistoryRate({ rate: 'invalid' })).toBe('—');
  });
});
