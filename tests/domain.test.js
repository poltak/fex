import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js-light';
import { parseAmount, createConverter, formatAmount, formatChecked, formatEditable, formatUnitRate, rateDates, isOldRate, normalizeSearch } from '../src/domain.js';
import { FALLBACK_CATALOG, DEFAULT_CODES } from '../src/catalog.js';

const convertAmount = ({ rates, ...amount }) => createConverter({ rates })(amount);
const rates = { EUR: { rate: '0.8', date: '2026-09-25' }, VND: { rate: '25000', date: '2026-09-24' }, GBP: { rate: '0.75', date: '2026-09-25' } };
describe('amount parsing', () => {
  it.each([['en-US','1,234.56'],['vi-VN','1.234,56'],['de-DE','1.234,56'],['fr-FR','1\u202f234,56'],['fr-FR','1\u00a0234,56']])('parses %s', (locale,text) => expect(parseAmount({text,locale})).toEqual({status:'valid',value:'1234.56'}));
  it.each([['en-US','12,34'],['vi-VN','1,234.56'],['de-DE','1.234.56'],['fr-FR','1 23,45'],['en-US','1 234,567'],['en-US','-1'],['en-US','1e3'],['en-US','Infinity']])('rejects invalid %s %s', (locale,text) => expect(parseAmount({text,locale}).status).toBe('invalid'));
  it('keeps draft states', () => { expect(parseAmount({text:''}).status).toBe('empty'); expect(parseAmount({text:'1.'}).status).toBe('incomplete'); expect(parseAmount({text:'.'}).status).toBe('incomplete'); expect(parseAmount({text:'0'}).value).toBe('0'); });
  it('accepts an unambiguous alternative decimal', () => { expect(parseAmount({text:'1.25',locale:'de-DE'}).value).toBe('1.25'); expect(parseAmount({text:'1.234',locale:'de-DE'}).value).toBe('1234'); });
  it('enforces entered limits', () => { expect(parseAmount({text:'999999999999999.123456789012'}).status).toBe('valid'); expect(parseAmount({text:'1000000000000000'}).status).toBe('invalid'); expect(parseAmount({text:'0.1234567890123'}).status).toBe('invalid'); });
  it.each(['ar-EG', 'fa-IR', 'bn-BD', 'hi-IN', 'de-CH'])('accepts its own editable and grouped values in %s', locale => {
    const amount = '123456.78';
    for (const text of [formatEditable({ amount, locale }), new Intl.NumberFormat(locale).format(Number(amount))]) {
      expect(parseAmount({ text, locale })).toEqual({ status: 'valid', value: amount });
    }
  });
  it('rejects malformed Indian groups instead of changing the amount', () => {
    expect(parseAmount({ text: '12,34,567.89', locale: 'en-IN' }).value).toBe('1234567.89');
    for (const text of ['123,45,678', '1,234,56', '1,23,456,789']) expect(parseAmount({ text, locale: 'en-IN' }).status).toBe('invalid');
  });
});
describe('decimal conversion', () => {
  it('uses exact cross rates and USD identity', () => { expect(convertAmount({amount:'10',source:'EUR',target:'VND',rates})).toBe('312500'); expect(convertAmount({amount:'10.1234',source:'USD',target:'USD',rates:{}})).toBe('10.1234'); });
  it('returns unavailable for missing or invalid rates', () => { expect(convertAmount({amount:'10',source:'USD',target:'JPY',rates})).toBeNull(); expect(convertAmount({amount:'10',source:'EUR',target:'USD',rates:{EUR:{rate:'0',date:''}}})).toBeNull(); });
  it('switches repeatedly without display rounding', () => { const convert = createConverter({rates}); let amount = '0.123456789012'; for(let i=0;i<100;i++) { amount = convert({amount,source:'USD',target:'VND'}); amount = convert({amount,source:'VND',target:'EUR'}); amount = convert({amount,source:'EUR',target:'USD'}); } expect(amount).toBe('0.123456789012'); });
  it('limits repeating-decimal switch error to internal precision', () => {
    const convert = createConverter({ rates });
    let amount = '0.123456789012';
    for (let i = 0; i < 100; i++) {
      amount = convert({ amount, source: 'GBP', target: 'EUR' });
      amount = convert({ amount, source: 'EUR', target: 'GBP' });
    }
    expect(new Decimal(amount).minus('0.123456789012').abs().lt('0.000000000000000000000000000000000001')).toBe(true);
    expect(formatAmount({ amount, currency: 'GBP' })).toBe('0.12');
  });
  it('keeps the source fixed when new rates arrive', () => {
    const amount = '10.123456789012';
    const updated = { ...rates, EUR: { rate: '0.9', date: '2026-09-26' } };
    expect(convertAmount({ amount, source: 'USD', target: 'USD', rates: updated })).toBe(amount);
    expect(convertAmount({ amount, source: 'USD', target: 'EUR', rates: updated })).toBe('9.1111111101108');
  });
  it('converts all available fixture codes', () => { for(const target of Object.keys(rates)) expect(convertAmount({amount:'1',source:'USD',target,rates})).toBe(rates[target].rate); });
});
describe('presentation', () => {
  it('preserves tiny nonzero results', () => { expect(formatAmount({amount:'0.000001',currency:'USD'})).toBe('<0.01'); expect(formatAmount({amount:'0.1',currency:'VND'})).toBe('<1'); expect(formatAmount({amount:'0',currency:'USD'})).toBe('0.00'); expect(formatUnitRate({source:'VND',target:'USD',convert:createConverter({rates})})).toBe('1 VND ≈ 0.00004 USD'); });
  it('handles large amounts without Number precision loss', () => expect(formatAmount({amount:'12345678901234567890.125',currency:'USD'})).toBe('12,345,678,901,234,567,890.13'));
  it('keeps full editable precision', () => expect(formatEditable({amount:'0.0000000000001234567890123456789',locale:'vi-VN'})).toBe('0,0000000000001234567890123456789'));
  it('uses the same digit system for whole and fractional digits', () => {
    expect(formatEditable({ amount: '123.45', locale: 'ar-EG' })).toBe('١٢٣٫٤٥');
    expect(formatAmount({ amount: '123.45', currency: 'USD', locale: 'ar-EG' })).toBe('١٢٣٫٤٥');
  });
  it('uses currency minor units', () => { expect(formatAmount({amount:'1.2345',currency:'KWD'})).toBe('1.235'); expect(formatAmount({amount:'1234.5',currency:'VND',locale:'vi-VN'})).toBe('1.235'); });
});
describe('metadata and dates', () => {
  it('describes the age of the last check', () => {
    const now = 10 * 86400000;
    expect(formatChecked({ checkedAt: now - 59999, now })).toBe('Checked just now');
    expect(formatChecked({ checkedAt: now - 59 * 60000, now })).toBe('Checked 59 min ago');
    expect(formatChecked({ checkedAt: now - 23 * 3600000, now })).toBe('Checked 23 hr ago');
    expect(formatChecked({ checkedAt: now - 86400000, now })).toBe('Checked 1 day ago');
    expect(formatChecked({ checkedAt: now - 3 * 86400000, now })).toBe('Checked 3 days ago');
    expect(formatChecked({ checkedAt: now + 60000, now })).toBe('Checked just now');
  });
  it('collects both legs and excludes USD identity', () => expect(rateDates({source:'EUR',codes:['USD','VND'],rates})).toEqual({dates:['2026-09-24','2026-09-25'],oldest:'2026-09-24',newest:'2026-09-25'}));
  it('uses UTC calendar dates and strict seven-day age', () => { expect(isOldRate({date:'2026-09-18',now:Date.parse('2026-09-25T23:59:59Z')})).toBe(false); expect(isOldRate({date:'2026-09-18',now:Date.parse('2026-09-26T00:00:00Z')})).toBe(true); });
  it('rejects invalid dates and does not mark future dates old', () => { expect(isOldRate({date:'2026-02-30'})).toBe(false); expect(isOldRate({date:'not a date'})).toBe(false); expect(isOldRate({date:'2026-09-27',now:Date.parse('2026-09-26T00:00:00Z')})).toBe(false); });
  it('ships the complete official snapshot and accent search', () => { expect(FALLBACK_CATALOG.length).toBeGreaterThan(160); expect(new Set(FALLBACK_CATALOG.map(row=>row.code)).size).toBe(FALLBACK_CATALOG.length); for(const code of DEFAULT_CODES) expect(FALLBACK_CATALOG.some(row=>row.code===code)).toBe(true); expect(normalizeSearch('Vietnamese Đồng')).toBe('vietnamese dong'); });
});
