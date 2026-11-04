const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const architecture = fs.readFileSync(
  path.join(__dirname, '..', 'docs', 'MOBILE-ARCHITECTURE.md'),
  'utf8'
);

test('mobile parity plan covers both platforms and the 5.8.0 capability baseline', () => {
  for (const phrase of [
    'Android', 'iPhone', 'Safari Web Extension', 'Facebook native app',
    'Post text and image drafts', 'Templates / examples',
    'Group links, lists, batches, presets', 'Ordered multi-group queue',
    'Smart Scheduler / recurring schedules', 'Duplicate-post protection',
    'Multi-image handling / compression / EXIF removal',
    'Lead Finder / visible ad phone extraction',
    'Progress and operation logs', 'License / trial / payment status',
    'Backup / restore / CSV export', 'Checkpoint handling'
  ]) {
    assert.ok(architecture.includes(phrase), `Missing parity requirement: ${phrase}`);
  }
});

test('queue contract treats ambiguous submission as UNKNOWN and forbids blind retry', () => {
  assert.match(architecture, /timeout after a submit action becomes `UNKNOWN`/);
  assert.match(architecture, /never blindly retry an uncertain post/);
});

test('mobile architecture documents native Facebook and background execution limits', () => {
  assert.match(architecture, /Neither platform can inject into the native Facebook app/);
  assert.match(architecture, /Background execution is OS-controlled/);
  assert.match(architecture, /No claim of identical automation until Android and iOS device-level acceptance tests pass/);
});

test('completion requires per-platform device acceptance evidence', () => {
  assert.match(architecture, /device-level acceptance record for both platforms/);
  assert.match(architecture, /only mark 5\.8\.0 parity complete after evidence is attached/);
});
