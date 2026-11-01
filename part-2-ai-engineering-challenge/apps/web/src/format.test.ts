import { describe, expect, it } from 'vitest';
import { formatMoney, localInputToUtcIso, moneyInputValue, parseMoney } from './format';

describe('money', () => {
  it.each([
    ['5000', 500000],
    ['5,000.00', 500000],
    ['5000.5', 500050],
    ['0.07', 7],
    ['0', 0],
    ['10000000.99', 1000000099],
  ])('parses %s to %i minor units', (text, minor) => {
    expect(parseMoney(text)).toBe(minor);
  });

  it.each(['', 'abc', '-5', '1.234', '1e3', '5.', '.5', '1,2,3.456', '99999999999999999'])('rejects %j', (text) => {
    expect(parseMoney(text)).toBeNull();
  });

  it('round-trips without floating point error', () => {
    for (const minor of [0, 1, 7, 10, 19, 29, 1005, 500050, 123456789]) {
      expect(parseMoney(moneyInputValue(minor))).toBe(minor);
    }
    expect(formatMoney(500050)).toBe('5,000.50');
  });
});

describe('datetime input', () => {
  it('is interpreted as UTC', () => {
    expect(localInputToUtcIso('2026-12-01T09:30')).toBe('2026-12-01T09:30:00.000Z');
    expect(localInputToUtcIso('nonsense')).toBeNull();
    expect(localInputToUtcIso('2026-13-45T99:99')).toBeNull();
  });
});
