// Entry point for every public page.
import { setupMenu, setupReveal } from './menu.js';
import { setupMedia } from './media.js';
import { setupHomepage } from './homepage.js';
import { setupLiveContent } from './live-content.js';
import { setupFormPopups } from './form-popup.js';
import { setupGallery } from './gallery.js';
import { autoSort, autoSortSelects } from '../lib/sort-list.js';

setupMenu();
setupMedia();
setupHomepage();
setupLiveContent();
setupFormPopups();
setupGallery();
setupReveal();
// Event and news archives get a Sort dropdown (the homepage teasers keep their order).
autoSort(document.querySelector('main') || document.body, '.event-grid:not([data-nosort]), .news-grid:not(.news-grid-home)');
autoSortSelects(document.body);
