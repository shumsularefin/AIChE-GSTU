// Image fields: upload from the device (optimized in the browser) or choose a previously uploaded
// image. The stored reference (media:<id>) is managed automatically; nobody types image paths.
import { resolveImage } from '../public/media.js';
import { h, $, $$, toast, openDialog, busy, confirmDialog, errorMessage } from './ui.js';
import {
  CLEANUP_DAYS,
  cleanupPlan,
  libraryGroups,
  mediaUsage,
  removalDay,
  usageCounts,
  usageKinds,
  usedReferences,
} from '../lib/media-library.js';

const MAX_BYTES = 280000;

/** Resizes to at most 1400 px and compresses to a JPEG data URL under the database limit. */
export async function prepareImage(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw Error('Choose a JPG, PNG or WebP image.');
  if (file.size > 15 * 1024 * 1024) throw Error('Choose an image smaller than 15 MB.');
  const bitmap = await createImageBitmap(file);
  for (const longest of [1400, 1100, 900]) {
    const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.7, 0.58, 0.45]) {
      const data = canvas.toDataURL('image/jpeg', quality);
      if (data.length <= MAX_BYTES) {
        bitmap.close();
        return data;
      }
    }
  }
  bitmap.close();
  throw Error('This image is too detailed to store. Crop it or choose a smaller image.');
}

export async function previewInto(img, reference) {
  img.removeAttribute('src');
  img.hidden = !reference;
  if (!reference) return;
  try {
    img.src = await resolveImage(reference);
  } catch {
    img.alt = 'Image unavailable';
  }
}

export const imageFieldHTML = ({ name, value = '', label = 'Image', hint = '' }) => `
  <div class="ed-field ed-image-field" data-image-field="${h(name)}">
    <span class="ed-label">${h(label)}</span>
    <input type="hidden" name="${h(name)}" value="${h(value)}">
    <div class="ed-image-box"><img alt="Selected image" width="160" height="120"${value ? '' : ' hidden'}><span class="ed-image-empty"${value ? ' hidden' : ''}>No image selected</span></div>
    <div class="ed-actions">
      <button type="button" class="ed-btn ed-btn-small" data-upload>Upload from device</button>
      <button type="button" class="ed-btn ed-btn-small ed-btn-quiet" data-library>Choose uploaded image</button>
      <button type="button" class="ed-btn ed-btn-small ed-btn-quiet" data-clear${value ? '' : ' hidden'}>Remove image</button>
    </div>
    <input type="file" accept="image/jpeg,image/png,image/webp" hidden data-ignore>
    ${hint ? `<small>${hint}</small>` : ''}
  </div>`;

/** Wires every image field inside root. onChange is called after the stored reference changes. */
export function wireImageFields(root, app, onChange = () => {}) {
  for (const box of $$('[data-image-field]', root)) {
    const input = $('input[type="hidden"]', box);
    const file = $('input[type="file"]', box);
    const img = $('img', box);
    const empty = $('.ed-image-empty', box);
    const clear = $('[data-clear]', box);
    const set = (reference) => {
      input.value = reference;
      empty.hidden = !!reference;
      clear.hidden = !reference;
      previewInto(img, reference);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      onChange(reference);
    };
    previewInto(img, input.value);
    $('[data-upload]', box).addEventListener('click', () => file.click());
    file.addEventListener('change', () =>
      busy($('[data-upload]', box), 'Uploading…', async () => {
        const reference = await uploadFile(app, file.files[0]);
        file.value = '';
        if (reference) set(reference);
      }),
    );
    $('[data-library]', box).addEventListener('click', async () => {
      const reference = await chooseImage(app);
      if (reference) set(reference);
    });
    clear.addEventListener('click', () => set(''));
  }
}

export async function uploadFile(app, file) {
  if (!file) return '';
  const data = await prepareImage(file);
  const reference = await app.cloud.uploadImage(data, file.name || 'image.jpg');
  app.imageCache = null;
  toast('Image uploaded and optimized. Publish the section to use it on the website.');
  return reference;
}

const dayLabel = (date) => (date ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const isoLabel = (iso) => (iso ? dayLabel(new Date(`${iso}T00:00:00Z`)) : '');

/**
 * Removes uploaded images nothing has used for CLEANUP_DAYS days. Runs when the dashboard opens; no
 * server code is needed. Every editor's dashboard clears the images its own drafts use, and the
 * super-admin's dashboard (which may delete any image) does the full check once a day.
 * Resolves with the number of images removed.
 */
export async function cleanUpImages(app, today = new Date().toISOString().slice(0, 10)) {
  const state = await app.cloud.imageCleanup();
  if (!state) return 0; // The published security rules predate image cleanup.
  app.imageCleanup = state;
  const used = usedReferences(app.data, app.drafts.all());
  const usedIds = new Set([...used].map((ref) => ref.slice(6)));
  const release = (s) => ({ ...s, unusedSince: Object.fromEntries(Object.entries(s.unusedSince).filter(([id]) => !usedIds.has(id))) });
  if (app.role !== 'super-admin' || state.checkedOn === today) {
    app.imageCleanup = (await app.cloud.updateImageCleanup(release)) || state;
    return 0;
  }
  const images = await app.cloud.images();
  const { due } = cleanupPlan(images, used, state.unusedSince, today);
  const removed = new Set();
  for (const img of due) {
    try {
      await app.cloud.deleteImage(img.id, img.name, `Removed automatically after ${CLEANUP_DAYS} days unused:`);
      removed.add(img.id);
    } catch (error) {
      console.warn('Image cleanup skipped', img.id, error);
    }
  }
  const remaining = images.filter((img) => !removed.has(img.id));
  app.imageCache = remaining;
  app.imageCleanup =
    (await app.cloud.updateImageCleanup((s) => ({
      unusedSince: cleanupPlan(remaining, used, s.unusedSince, today).unusedSince,
      checkedOn: today,
    }))) || state;
  return removed.size;
}

const figureHTML = (app, img, uses) => {
  const removal = removalDay(img, app.imageCleanup?.unusedSince);
  const canDelete = app.role === 'super-admin' || img.createdBy === app.user?.uid;
  const where = uses.length
    ? `<small class="ed-library-use" title="${h(uses.map((u) => u.label).join('\n'))}">${h(uses[0].label)}${uses.length > 1 ? ` +${uses.length - 1} more` : ''}</small>`
    : `<small class="ed-library-unused">Unused${removal ? ` · removed ${h(isoLabel(removal))}` : ''}</small>${canDelete ? `<button type="button" class="ed-link ed-danger-text" data-delete="${h(img.id)}">Delete now</button>` : ''}`;
  return `<figure role="listitem"><button type="button" class="ed-library-pick" data-pick="${h(img.reference)}" title="${h(img.name)}"><img src="${h(img.image)}" alt="${h(img.name)}" loading="lazy"></button><figcaption>${h(img.name)}<span>${h(dayLabel(img.createdAt))}</span></figcaption>${where}</figure>`;
};

/** Image library dialog. Resolves with the chosen reference, or undefined. */
export function chooseImage(app, { multiple = false } = {}) {
  app.libraryFilter ??= { kind: '', query: '', order: 'newest' };
  return openDialog(
    `<h2>Uploaded images</h2><div class="ed-dialog-body"><div class="ed-library-tools">
      <label class="ed-field"><span class="ed-label">Search</span><input type="search" data-q placeholder="File name, event, person or month" value="${h(app.libraryFilter.query)}" data-ignore></label>
      <label class="ed-field"><span class="ed-label">Show</span><select data-kind data-ignore></select></label>
      <label class="ed-field"><span class="ed-label">Order</span><select data-order data-ignore><option value="newest">Newest first</option><option value="oldest"${app.libraryFilter.order === 'oldest' ? ' selected' : ''}>Oldest first</option></select></label>
      <div class="ed-library-upload"><button type="button" class="ed-btn ed-btn-small" data-upload-new>Upload from device</button><input type="file" accept="image/jpeg,image/png,image/webp" hidden ${multiple ? 'multiple' : ''}></div>
    </div><p class="ed-muted ed-library-note" data-summary>Images unused for ${CLEANUP_DAYS} days are removed automatically.</p><div class="ed-library" role="list"><p class="ed-muted">Loading images…</p></div></div><div class="ed-actions"><button type="button" class="ed-btn ed-btn-quiet" data-close>Close</button></div>`,
    async (dialog, close) => {
      const grid = $('.ed-library', dialog);
      const file = $('input[type="file"]', dialog);
      const kindSelect = $('[data-kind]', dialog);
      let usage = new Map();
      function show() {
        const filter = (app.libraryFilter = {
          kind: kindSelect.value,
          query: $('[data-q]', dialog).value.trim(),
          order: $('[data-order]', dialog).value,
        });
        const groups = libraryGroups(app.imageCache, usage, filter);
        const shown = groups.reduce((n, g) => n + g.images.length, 0);
        $('[data-summary]', dialog).textContent =
          `${shown} of ${app.imageCache.length} image${app.imageCache.length === 1 ? '' : 's'}. Images unused for ${CLEANUP_DAYS} days are removed automatically.`;
        grid.innerHTML = groups.length
          ? groups
              .map(
                (g) =>
                  `<section class="ed-library-month" aria-label="${h(g.label)}"><h3>${h(g.label)} <span>${g.images.length}</span></h3><div class="ed-library-grid">${g.images.map((img) => figureHTML(app, img, usage.get(img.reference) || [])).join('')}</div></section>`,
              )
              .join('')
          : `<p class="ed-muted">${app.imageCache.length ? 'No images match. Clear the search or choose “All images”.' : 'No images uploaded yet.'}</p>`;
      }
      async function load() {
        try {
          app.imageCache ??= await app.cloud.images();
          app.imageCleanup ??= (await app.cloud.imageCleanup().catch(() => null)) || { unusedSince: {} };
        } catch (error) {
          grid.innerHTML = `<p class="ed-error-text">${h(errorMessage(error))}</p>`;
          return;
        }
        usage = mediaUsage(app.data, app.drafts.all());
        const counts = usageCounts(app.imageCache, usage);
        const options = [
          ['', `All images (${counts.all})`],
          ['used', `In use (${counts.used})`],
          ['unused', `Unused (${counts.unused})`],
          ...Object.entries(usageKinds)
            .filter(([kind]) => counts[kind])
            .map(([kind, label]) => [kind, `${label} (${counts[kind]})`]),
        ];
        const current = options.some(([v]) => v === app.libraryFilter.kind) ? app.libraryFilter.kind : '';
        kindSelect.innerHTML = options
          .map(([v, label]) => `<option value="${v}"${v === current ? ' selected' : ''}>${h(label)}</option>`)
          .join('');
        show();
      }
      $('[data-q]', dialog).addEventListener('input', () => app.imageCache && show());
      kindSelect.addEventListener('change', () => app.imageCache && show());
      $('[data-order]', dialog).addEventListener('change', () => app.imageCache && show());
      dialog.addEventListener('click', async (e) => {
        const pick = e.target.closest('[data-pick]');
        const remove = e.target.closest('[data-delete]');
        if (pick) close(pick.dataset.pick);
        if (e.target.closest('[data-upload-new]')) file.click();
        if (remove) {
          const image = app.imageCache.find((i) => i.id === remove.dataset.delete);
          if (
            !(await confirmDialog({
              title: 'Delete this image?',
              body: `<p>${h(image.name)} is not used anywhere on the website. It will be removed permanently.</p>`,
              confirm: 'Delete image',
              danger: true,
            }))
          )
            return;
          await busy(remove, 'Deleting…', async () => {
            await app.cloud.deleteImage(image.id, image.name);
            app.imageCache = null;
            await load();
            toast('Image deleted.');
          });
        }
      });
      file.addEventListener('change', () =>
        busy($('[data-upload-new]', dialog), 'Uploading…', async () => {
          let last;
          for (const f of file.files) last = await uploadFile(app, f);
          file.value = '';
          if (last && !multiple) close(last);
          else await load();
        }),
      );
      await load();
    },
    { wide: true },
  );
}
