import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, cleanupPlan, libraryGroups, mediaUsage, removalDay, usageCounts, usedReferences } from '../../js/lib/media-library.js';

const ref = (n) => `media:00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const img = (n, date, name = `photo-${n}.jpg`) => ({
  id: ref(n).slice(6),
  reference: ref(n),
  name,
  createdAt: date ? new Date(`${date}T10:00:00Z`) : undefined,
});
const data = {
  events: [{ value: { id: 'green-day', title: 'Green Day', image: ref(1) } }],
  team: { 2026: { value: { members: [{ name: 'Nadia Rahman', image: ref(2) }], roster: [] } } },
  homepage: { value: { images: [ref(3), 'images/optimized/slide01-1600.webp'] } },
  membership: { value: { intro: 'Join us' } },
  forms: [],
  future: { banner: ref(6) },
};
const drafts = { 'event:new': { value: { title: 'Seminar', image: ref(4) }, baseRevision: 0 } };
const images = [
  img(1, '2026-10-02'),
  img(2, '2026-09-20'),
  img(3, '2026-10-15'),
  img(4, '2026-08-01'),
  img(5, '2026-10-20', 'Poster draft.jpg'),
  img(6),
  img(7, '2026-09-01'),
];

test('media library: usage is found by scanning content and drafts for media references', () => {
  const usage = mediaUsage(data, drafts);
  assert.deepEqual(usage.get(ref(1)), [{ kind: 'events', label: 'Green Day' }]);
  assert.deepEqual(usage.get(ref(2)), [{ kind: 'team', label: 'Nadia Rahman · Committee 2026' }]);
  assert.deepEqual(usage.get(ref(3)), [{ kind: 'pages', label: 'Homepage slideshow' }]);
  assert.deepEqual(usage.get(ref(4)), [{ kind: 'drafts', label: 'Draft: event new' }]);
  assert.deepEqual(usage.get(ref(6)), [{ kind: 'other', label: 'Website content' }], 'unknown places still count as used');
  assert.ok(!usage.has(ref(5)));
  assert.equal(usedReferences(data, drafts).size, 5);
  assert.deepEqual(usageCounts(images, usage), { all: 7, used: 5, unused: 2, events: 1, team: 1, pages: 1, forms: 0, drafts: 1, other: 1 });
});

test('media library: filter by usage, search, and sort by upload date in month groups', () => {
  const usage = mediaUsage(data, drafts);
  const view = (filter) => libraryGroups(images, usage, filter).map((g) => [g.label, g.images.map((i) => i.name)]);
  assert.deepEqual(view({}), [
    ['October 2026', ['Poster draft.jpg', 'photo-3.jpg', 'photo-1.jpg']],
    ['September 2026', ['photo-2.jpg', 'photo-7.jpg']],
    ['August 2026', ['photo-4.jpg']],
    ['Date unknown', ['photo-6.jpg']],
  ]);
  assert.deepEqual(view({ order: 'oldest' })[1], ['August 2026', ['photo-4.jpg']]);
  assert.deepEqual(view({ kind: 'unused' }), [
    ['October 2026', ['Poster draft.jpg']],
    ['September 2026', ['photo-7.jpg']],
  ]);
  assert.deepEqual(view({ kind: 'team' }), [['September 2026', ['photo-2.jpg']]]);
  assert.deepEqual(view({ query: 'nadia' }), [['September 2026', ['photo-2.jpg']]], 'search covers where an image is used');
  assert.deepEqual(view({ query: 'green day' }), [['October 2026', ['photo-1.jpg']]]);
  assert.deepEqual(view({ kind: 'used', query: 'august' }), [['August 2026', ['photo-4.jpg']]]);
});

test('media library: images are removed after 30 days unused; using one again resets its clock', () => {
  const used = usedReferences(data, drafts);
  const first = cleanupPlan(images, used, {}, '2026-10-23');
  assert.deepEqual(
    first,
    { unusedSince: { [img(5).id]: '2026-10-23', [img(7).id]: '2026-10-23' }, due: [] },
    'old uploads are not removed on the first check',
  );

  const later = cleanupPlan(images, used, { ...first.unusedSince, [img(1).id]: '2026-01-01', gone: '2026-01-01' }, '2026-11-22');
  assert.deepEqual(
    later.due.map((i) => i.name),
    ['Poster draft.jpg', 'photo-7.jpg'],
  );
  assert.ok(!(img(1).id in later.unusedSince), 'images in use leave the record');
  assert.ok(!('gone' in later.unusedSince), 'deleted images leave the record');
  assert.deepEqual(cleanupPlan(images, used, first.unusedSince, '2026-11-21').due, [], 'day 29 keeps the image');

  assert.equal(addDays('2026-10-23', 30), '2026-11-22');
  assert.equal(removalDay(img(5), first.unusedSince), '2026-11-22');
  assert.equal(removalDay(img(1), first.unusedSince), '');
});
