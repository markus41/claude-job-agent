import assert from 'node:assert/strict';
import { test } from 'node:test';
import { annualize, extractComp } from '../src/lib/comp.mjs';

test('extractComp: full range with commas', () => {
  assert.deepEqual(
    extractComp('The salary range for this role is $150,000 - $180,000 per year.'),
    { min: 150000, max: 180000, currency: 'USD', interval: 'yearly' }
  );
});

test('extractComp: GBP range', () => {
  assert.deepEqual(
    extractComp('Compensation: £45,000-£55,000 depending on experience'),
    { min: 45000, max: 55000, currency: 'GBP', interval: 'yearly' }
  );
});

test('extractComp: hourly rate', () => {
  assert.deepEqual(
    extractComp('Contract role paying $85/hr, 40 hours per week'),
    { min: 85, max: null, currency: 'USD', interval: 'hourly' }
  );
});

test('extractComp: bare k range without currency', () => {
  assert.deepEqual(
    extractComp('Base comp 150k-180k plus equity'),
    { min: 150000, max: 180000, currency: 'USD', interval: 'yearly' }
  );
});

test('extractComp: k only on upper bound', () => {
  assert.deepEqual(
    extractComp('We pay $150-180k for this level.'),
    { min: 150000, max: 180000, currency: 'USD', interval: 'yearly' }
  );
});

test('extractComp: en-dash range with K suffix', () => {
  assert.deepEqual(
    extractComp('$130K – $160K • Offers Equity'),
    { min: 130000, max: 160000, currency: 'USD', interval: 'yearly' }
  );
});

test('extractComp: ignores 401(k) and small dollar amounts', () => {
  assert.equal(extractComp('Great 401(k) match and a $500 signing bonus'), null);
  assert.equal(extractComp('No compensation details listed.'), null);
  assert.equal(extractComp(''), null);
  assert.equal(extractComp(null), null);
});

test('annualize: hourly converts at 2080 hours', () => {
  assert.deepEqual(
    annualize({ min: 50, max: 60, currency: 'USD', interval: 'hourly' }),
    { min: 104000, max: 124800 }
  );
  assert.deepEqual(
    annualize({ min: 150000, max: null, currency: 'USD', interval: 'yearly' }),
    { min: 150000, max: null }
  );
  assert.equal(annualize(null), null);
});
