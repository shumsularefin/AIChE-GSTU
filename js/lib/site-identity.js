// The chapter's name and web address, shared by the build, the public pages and the Chapter Editor.
// When the Firebase project is created, set SITE_ORIGIN to its Hosting address (or custom domain)
// and follow DEPLOYMENT.md; QR codes, share links, the sitemap and calendar files all use it.
export const SITE_ORIGIN = 'https://aiche-gstu.web.app';
export const SITE_HOST = new URL(SITE_ORIGIN).host;
/** Firebase Hosting site ID (the part before .web.app). */
export const HOSTING_SITE = SITE_HOST.split('.')[0];
export const CHAPTER_NAME = 'AIChE Student Chapter, GSTU';
