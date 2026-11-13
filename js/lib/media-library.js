// Uploaded image library: where each image is used, filtering and month groups for the picker,
// and the 30-day schedule that removes images nothing has used for a month.
//
// Every place that can hold an image stores a media:<id> reference, so usage is found by scanning
// content for references, the same way the site build decides which images to bake.

const REF = /media:[a-f0-9-]{36}/g;
const refsIn = (value) => new Set(JSON.stringify(value ?? null).match(REF) || []);

export const CLEANUP_DAYS = 30;

export const usageKinds = {
  events: 'Events',
  team: 'Team & members',
  pages: 'Homepage & membership',
  forms: 'Forms',
  drafts: 'Unpublished drafts',
  other: 'Other content',
};

/** All references in published content and drafts. Anything listed here is never deleted. */
export const usedReferences = (data, drafts = {}) => refsIn([data, drafts]);

/** reference -> [{ kind, label }] for every place an image appears. */
export function mediaUsage(data, drafts = {}) {
  const usage = new Map();
  const add = (value, kind, label) => {
    for (const ref of refsIn(value)) {
      const list = usage.get(ref) || [];
      if (!list.some((u) => u.kind === kind && u.label === label)) list.push({ kind, label });
      usage.set(ref, list);
    }
  };
  for (const e of data?.events || []) add(e.value, 'events', e.value?.title || 'Event');
  for (const [id, entry] of Object.entries(data?.team || {})) {
    const group = id === 'founders' ? 'Founders' : `Committee ${id}`;
    for (const person of [...(entry.value?.members || []), ...(entry.value?.roster || [])])
      add(person, 'team', person.name ? `${person.name} · ${group}` : group);
  }
  add(data?.homepage?.value, 'pages', 'Homepage slideshow');
  add(data?.membership?.value, 'pages', 'Membership page');
  for (const f of data?.forms || []) add(f.value, 'forms', f.value?.title || 'Form');
  for (const [name, draft] of Object.entries(drafts)) add(draft, 'drafts', `Draft: ${name.replace(':', ' ')}`);
  for (const ref of usedReferences(data, drafts)) if (!usage.has(ref)) usage.set(ref, [{ kind: 'other', label: 'Website content' }]);
  return usage;
}

const monthKey = (date) => (date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` : '');
const monthLabel = (date) => (date ? date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : 'Date unknown');

/**
 * Images filtered by usage ('' = all, 'used', 'unused' or a usageKinds key) and search text, sorted
 * by upload date and grouped by month: [{ key, label, images }].
 */
export function libraryGroups(images, usage, { kind = '', query = '', order = 'newest' } = {}) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (img) => {
    const uses = usage.get(img.reference) || [];
    if (kind === 'unused' && uses.length) return false;
    if (kind === 'used' && !uses.length) return false;
    if (kind && !['used', 'unused'].includes(kind) && !uses.some((u) => u.kind === kind)) return false;
    const text = [img.name, ...uses.map((u) => u.label), monthLabel(img.createdAt)].join(' ').toLowerCase();
    return words.every((w) => text.includes(w));
  };
  const time = (img) => img.createdAt?.getTime?.() ?? 0;
  const sorted = images.filter(matches).sort((a, b) => (order === 'oldest' ? time(a) - time(b) : time(b) - time(a)));
  const groups = [];
  for (const img of sorted) {
    const key = monthKey(img.createdAt);
    if (groups.at(-1)?.key !== key) groups.push({ key, label: monthLabel(img.createdAt), images: [] });
    groups.at(-1).images.push(img);
  }
  return groups;
}

/** Counts for the usage filter: { all, used, unused, events, team, … }. */
export function usageCounts(images, usage) {
  const counts = { all: images.length, used: 0, unused: 0 };
  for (const kind of Object.keys(usageKinds)) counts[kind] = 0;
  for (const img of images) {
    const uses = usage.get(img.reference) || [];
    counts[uses.length ? 'used' : 'unused']++;
    for (const kind of new Set(uses.map((u) => u.kind))) counts[kind]++;
  }
  return counts;
}

const dayNumber = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);
export const addDays = (iso, days) => new Date((dayNumber(iso) + days) * 86400000).toISOString().slice(0, 10);

/**
 * The next cleanup state. unusedSince maps image id -> the first day (YYYY-MM-DD) it was seen unused;
 * an image that is used again leaves the map, and one unused for CLEANUP_DAYS is due for deletion.
 */
export function cleanupPlan(images, used, unusedSince = {}, today, days = CLEANUP_DAYS) {
  const next = {};
  const due = [];
  for (const img of images) {
    if (used.has(img.reference)) continue;
    const since = unusedSince[img.id] || today;
    next[img.id] = since;
    if (dayNumber(today) - dayNumber(since) >= days) due.push(img);
  }
  return { unusedSince: next, due };
}

/** The day an unused image will be removed, or '' when it is in use or not tracked yet. */
export const removalDay = (img, unusedSince = {}, days = CLEANUP_DAYS) => (unusedSince[img.id] ? addDays(unusedSince[img.id], days) : '');
