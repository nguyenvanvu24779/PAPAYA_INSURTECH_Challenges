/** Money is stored as integer minor units (cents); never as floating point. */
export function formatMoney(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  return `${sign}${whole}.${String(abs % 100).padStart(2, '0')}`;
}

/** "5,000.5" -> 500050. Returns null for anything that is not a plain amount with up to 2 decimals. */
export function parseMoney(text: string): number | null {
  const clean = text.replace(/[,\s]/g, '');
  const match = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(clean);
  if (!match) return null;
  const minor = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  return Number.isSafeInteger(minor) ? minor : null;
}

export function moneyInputValue(minor: number): string {
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}

/** `<input type="datetime-local">` value, interpreted as UTC, to an ISO instant. */
export function localInputToUtcIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const iso = `${value}:00.000Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export function utcIsoToLocalInput(iso: string): string {
  return iso.slice(0, 16);
}

export function formatTime(iso: string): string {
  return iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace(/Z$/, ' UTC');
}
