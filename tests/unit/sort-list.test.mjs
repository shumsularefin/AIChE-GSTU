import test from 'node:test';
import assert from 'node:assert/strict';
import { optionDate, orderOptions } from '../../js/lib/sort-list.js';

const o = (textContent) => ({ textContent, dataset: {} });

test('event dropdown options are dated from either date style', () => {
  assert.equal(optionDate(o('Science Fair (2027-03-10)')), '2027-03-10');
  assert.equal(optionDate(o('BEYOND THE BENCH · 30 September 2026')), '2026-09-30');
  assert.equal(optionDate(o('Executive service · 2024-2025 · 18 October 2026')), '2026-10-18');
  assert.equal(optionDate(o('Another event (type it below)')), '');
  const opts = [o('Another event'), o('A · 1 May 2025'), o('B · 2 June 2026')];
  assert.deepEqual(orderOptions(opts, 'oldest').map((x) => x.textContent), ['Another event', 'A · 1 May 2025', 'B · 2 June 2026']);
  assert.deepEqual(orderOptions(opts, 'newest').map((x) => x.textContent), ['Another event', 'B · 2 June 2026', 'A · 1 May 2025']);
});
