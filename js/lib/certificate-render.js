// Draws chapter certificates as self-contained SVG (all text converted to outlines, so they look the
// same everywhere) and exports them as PDF. Three designs (see "shared pieces" below): Horizon for
// participation, Prestige for placement awards and Heritage for formal recognition.
import { certificateTypes, signatories, certificateURL, formalTypes } from './certificate-model.js';
import { escapeHTML as h } from './content-model.js';
import qrcode from '../vendor/qrcode.mjs';
import { parse } from '../vendor/opentype.min.mjs';
import { SITE_HOST } from './site-identity.js';

export const WIDTH = 1200;
export const HEIGHT = 849; // A4 landscape proportions

// AIChE chapter palette: deep navy, AIChE blue and sky, with the chapter logo's gold.
const NAVY = '#0b2341';
const NAVY_2 = '#153355';
const NAVY_DEEP = '#071a33';
const SKY = '#009cde';
const GOLD = '#c8992b';
const GOLD_2 = '#e0b54a';
const INK = NAVY;
const MUTED = '#5b6477';
const SAMPLE_RED = '#b3261e';

const FONTS = {
  serif: 'fonts/certificates/LibreBaskerville.ttf',
  serifItalic: 'fonts/certificates/LibreBaskerville-Italic.ttf',
  cinzel: 'fonts/certificates/Cinzel.ttf',
  script: 'fonts/certificates/GreatVibes-Regular.ttf',
  poppins: 'fonts/certificates/Poppins-Regular.ttf',
  poppinsLight: 'fonts/certificates/Poppins-Light.ttf',
  poppinsMedium: 'fonts/certificates/Poppins-Medium.ttf',
  poppinsSemiBold: 'fonts/certificates/Poppins-SemiBold.ttf',
  poppinsItalic: 'fonts/certificates/Poppins-Italic.ttf',
  poppinsMediumItalic: 'fonts/certificates/Poppins-MediumItalic.ttf',
  bebas: 'fonts/certificates/BebasNeue-Regular.ttf',
};
// The chapter lockup is 1200 × 533 (AIChE wordmark, Student Chapter, university name).
const LOCKUP_RATIO = 533 / 1200;
const ART = {
  lockup: 'images/brand/aiche-chapter-lockup.png',
  lockupWhite: 'images/brand/aiche-chapter-lockup-white.png',
  gstu: 'images/brand/gstu-logo.png',
  advisor: 'images/brand/advisor-signature.png',
  coadvisor: 'images/brand/coadvisor-signature.png',
};

// Placement colours: light, mid and dark stops of the metal gradient.
const AWARDS = {
  champion: { label: 'Champion', rank: '1', light: '#f8e7a8', mid: '#d4a537', dark: '#8a6416' },
  'runner-up': { label: 'First Runner-up', rank: '2', light: '#f4f6fa', mid: '#b9c3d1', dark: '#6f7b8e' },
  'second-runner-up': { label: 'Second Runner-up', rank: '3', light: '#f3c9a6', mid: '#c98552', dark: '#7a3f17' },
};

const FORMAL_TITLES = {
  instructor: 'Certificate of Appreciation',
  teacher: 'Certificate of Appreciation',
  guest: 'Certificate of Honour',
  delegate: 'Certificate of Recognition',
  institution: 'Certificate of Partnership',
  organization: 'Certificate of Partnership',
  executive: 'Certificate of Executive Service',
};

// ------------------------------------------------------------------ loading

const cache = new Map();
function once(key, load) {
  if (!cache.has(key))
    cache.set(
      key,
      load().catch((error) => {
        cache.delete(key);
        throw error;
      }),
    );
  return cache.get(key);
}
const fetchOk = (path) =>
  fetch(path).then((r) => {
    if (!r.ok) throw Error('Certificate artwork is unavailable. Please try again.');
    return r;
  });
const loadFont = (path) =>
  once(path, () =>
    fetchOk(path)
      .then((r) => r.arrayBuffer())
      .then(parse),
  );
const loadArt = (path) =>
  once(`art:${path}`, () =>
    fetchOk(path)
      .then((r) => r.blob())
      .then(
        (blob) =>
          new Promise((resolve) => Object.assign(new FileReader(), { onload: (e) => resolve(e.target.result) }).readAsDataURL(blob)),
      ),
  );
const load = (map) => Promise.all(Object.entries(map).map(async ([k, v]) => [k, await v])).then(Object.fromEntries);

// ------------------------------------------------------------------ drawing helpers

// Text is laid out glyph by glyph from advance widths, without OpenType shaping: some of these fonts use
// substitution tables that opentype.js cannot apply, and kerning in others yields invalid outlines.
const advance = (font, s, size) => {
  let width = 0;
  for (const ch of String(s)) width += (font.charToGlyph(ch).advanceWidth * size) / font.unitsPerEm;
  return width;
};
const glyphs = (font, s, x, y, size) => {
  const commands = [];
  let cursor = x;
  for (const ch of String(s)) {
    const glyph = font.charToGlyph(ch);
    commands.push(...glyph.getPath(cursor, y, size).commands);
    cursor += (glyph.advanceWidth * size) / font.unitsPerEm;
  }
  return { commands };
};

/** Path data with explicit separators (opentype.js can run numbers together, e.g. "M-4.010Q"). */
function pathData(path) {
  const n = (v) => (Math.abs(v) < 0.005 ? '0' : v.toFixed(2));
  let d = '';
  for (const c of path.commands) {
    if (c.type === 'M' || c.type === 'L') d += `${c.type}${n(c.x)} ${n(c.y)}`;
    else if (c.type === 'Q') d += `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`;
    else if (c.type === 'C') d += `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`;
    else if (c.type === 'Z') d += 'Z';
  }
  return d;
}

/** Outline for a run of text; a glyph with invalid coordinates is redrawn a hair to the side. */
function outline(font, s, x, y, size) {
  const clean = (d) => !/NaN|Infinity/.test(d);
  const d = pathData(glyphs(font, s, x, y, size));
  if (clean(d)) return d;
  let out = '';
  let cursor = x;
  for (const ch of s) {
    for (let i = 0; i < 12; i++) {
      const g = pathData(glyphs(font, ch, cursor + i * 0.011, y + i * 0.007, size));
      if (clean(g)) {
        out += g;
        break;
      }
    }
    cursor += advance(font, ch, size);
  }
  return out;
}

/** Text as an outline path. Shrinks to fit maxWidth; anchor is start, middle or end. */
function text(font, value, x, y, size, { fill = INK, anchor = 'start', maxWidth = Infinity, spacing = 0, attrs = '' } = {}) {
  const s = String(value ?? '');
  if (!s) return '';
  // Kerning in some of these fonts yields invalid outlines (NaN), so letters are spaced by advance widths only.
  const measure = (sz) => advance(font, s, sz) + spacing * (sz / size) * Math.max(0, [...s].length - 1);
  if (measure(size) > maxWidth) {
    const scale = maxWidth / measure(size);
    size *= scale;
    spacing *= scale;
  }
  let start = anchor === 'middle' ? x - measure(size) / 2 : anchor === 'end' ? x - measure(size) : x;
  let d;
  if (!spacing) d = outline(font, s, start, y, size);
  else {
    d = '';
    for (const ch of s) {
      d += outline(font, ch, start, y, size);
      start += advance(font, ch, size) + spacing;
    }
  }
  return `<path fill="${fill}" ${attrs} d="${d}"/>`;
}

function wrap(font, value, width, size) {
  const rows = [];
  let row = '';
  for (const word of String(value ?? '')
    .split(/\s+/)
    .filter(Boolean)) {
    const next = row ? `${row} ${word}` : word;
    if (row && advance(font, next, size) > width) {
      rows.push(row);
      row = word;
    } else row = next;
  }
  if (row) rows.push(row);
  return rows;
}

/** A paragraph that shrinks until it fits maxLines. */
function paragraph(font, value, x, y, width, size, { maxLines = 2, lineHeight = 1.45, minSize = size * 0.7, ...options } = {}) {
  let rows = wrap(font, value, width, size);
  while (rows.length > maxLines && size > minSize) {
    size -= 0.5;
    rows = wrap(font, value, width, size);
  }
  return {
    svg: rows.map((row, i) => text(font, row, x, y + i * size * lineHeight, size, { maxWidth: width, ...options })).join(''),
    height: rows.length * size * lineHeight,
  };
}

function qr(url, size, color) {
  const code = qrcode(0, 'M');
  code.addData(url);
  code.make();
  const n = code.getModuleCount();
  const cell = size / n;
  let d = '';
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (code.isDark(r, c))
        d += `M${(c * cell).toFixed(2)} ${(r * cell).toFixed(2)}h${cell.toFixed(3)}v${cell.toFixed(3)}h-${cell.toFixed(3)}z`;
  return `<path fill="${color}" d="${d}"/>`;
}

const labelDate = (s) =>
  s
    ? new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : 'Not recorded';

const ONES = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const ORDINAL = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
const words = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : ''));
function ordinalWords(n) {
  const w = words(n);
  const parts = w.split('-');
  const last = parts.pop();
  const ord = ORDINAL[last] || (last.endsWith('y') ? last.slice(0, -1) + 'ieth' : last + 'th');
  return [...parts, ord].join('-');
}
const yearWords = (y) => `two thousand${y % 1000 ? ' and ' + words(y % 1000) : ''}`;

/** "this sixteenth day of October, two thousand and twenty-six" */
export function formalDate(iso) {
  if (!iso) return 'on the date shown below';
  const d = new Date(iso + 'T12:00:00Z');
  const month = d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  return `this ${ordinalWords(d.getUTCDate())} day of ${month}, ${yearWords(d.getUTCFullYear())}`;
}

const svgOpen = (label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${h(label)}">`;

// ------------------------------------------------------------------ shared pieces
// Three designs, all on the 1200 × 849 artboard:
//  - Horizon (participation, achievement): white sheet with an angled navy panel holding the logo and QR
//  - Prestige (champion and runners-up): navy sheet, gold octagonal frame, placement ribbon and medal
//  - Heritage (instructors, teachers, guests, delegates, institutions, executive service): ivory and serif
// The hexagon, taken from the chapter mark, is the shared motif.

const signatoryLines = (s) => [s.name, `${s.role}, AIChE Student Chapter, GSTU`, s.title];

/** Points of a hexagon with a vertex at the top. */
const hexPoints = (cx, cy, r) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
const hexagon = (cx, cy, r, attrs = '') => `<polygon points="${hexPoints(cx, cy, r)}" ${attrs}/>`;

/** A honeycomb of outlined hexagons, used as a faint texture. */
const honeycomb = (id, stroke, r = 26) => {
  const w = Math.sqrt(3) * r;
  const h = 3 * r;
  return `<pattern id="${id}" width="${w.toFixed(2)}" height="${h}" patternUnits="userSpaceOnUse">
    <g fill="none" stroke="${stroke}" stroke-width=".8">${hexagon(w / 2, r, r)}${hexagon(0, 2.5 * r, r)}${hexagon(w, 2.5 * r, r)}</g>
  </pattern>`;
};

/** The QR code on a white tile with a quiet zone, so it scans on any background. */
const qrTile = (c, x, y, size, pad = 8) =>
  `<rect x="${x}" y="${y}" width="${size + pad * 2}" height="${size + pad * 2}" fill="#ffffff"/>
   <g transform="translate(${x + pad} ${y + pad})">${qr(certificateURL(c.id), size, NAVY)}</g>`;

/** Turns the dark signature artwork white (for the navy design). */
const WHITE_INK = '<filter id="whiteInk"><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0"/></filter>';

function signatureBlock(f, art, s, i, x, lineY, { ink = INK, sub = MUTED, white = false, width = 240 } = {}) {
  const [name, role, title] = signatoryLines(s);
  return `<image href="${i ? art.coadvisor : art.advisor}" x="${x - 80}" y="${lineY - 56}" width="160" height="52" preserveAspectRatio="xMidYMid meet"${white ? ' filter="url(#whiteInk)"' : ''}/>
    <line x1="${x - width / 2}" y1="${lineY}" x2="${x + width / 2}" y2="${lineY}" stroke="${white ? GOLD : ink}" stroke-width="1"/>
    ${text(f.semibold, name, x, lineY + 22, 15, { anchor: 'middle', fill: ink, maxWidth: width + 40 })}
    ${text(f.regular, role, x, lineY + 40, 11, { anchor: 'middle', fill: white ? GOLD_2 : GOLD, maxWidth: width + 60 })}
    ${text(f.regular, title, x, lineY + 56, 10.5, { anchor: 'middle', fill: sub, maxWidth: width + 60 })}`;
}

/** The GSTU emblem in a circle. */
const emblem = (art, cx, cy, r, ring) =>
  `<clipPath id="gstuEmblem"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
   <circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff"/>
   <image href="${art.gstu}" x="${cx - r * 1.17}" y="${cy - r * 1.24}" width="${r * 2.34}" height="${r * 2.48}" clip-path="url(#gstuEmblem)" preserveAspectRatio="xMidYMid slice"/>
   <circle cx="${cx}" cy="${cy}" r="${r + 0.5}" fill="none" stroke="${ring}" stroke-width="1.2"/>`;

const issuedLine = (c) => `Issued ${labelDate(c.dateIssued)} · Verify at ${SITE_HOST}`;

/** Text in two fonts on one centred line ("in the " + bold event title). */
function mixedLine(a, b, cx, y, size, { fill, maxWidth }) {
  const wa = advance(a.font, a.text, size);
  let sizeB = size;
  if (wa + advance(b.font, b.text, sizeB) > maxWidth)
    sizeB = Math.max(size * 0.6, (size * (maxWidth - wa)) / advance(b.font, b.text, size));
  const total = wa + advance(b.font, b.text, sizeB);
  const start = cx - total / 2;
  return (
    text(a.font, a.text, start, y, size, { fill: a.fill || fill }) + text(b.font, b.text, start + wa, y, sizeB, { fill: b.fill || fill })
  );
}

// ------------------------------------------------------------------ Horizon: participation and achievement

async function participationSVG(c, { preview }) {
  const f = await load({
    bebas: loadFont(FONTS.bebas),
    script: loadFont(FONTS.script),
    regular: loadFont(FONTS.poppins),
    light: loadFont(FONTS.poppinsLight),
    medium: loadFont(FONTS.poppinsMedium),
    semibold: loadFont(FONTS.poppinsSemiBold),
  });
  const art = await load({
    lockupWhite: loadArt(ART.lockupWhite),
    gstu: loadArt(ART.gstu),
    advisor: loadArt(ART.advisor),
    coadvisor: loadArt(ART.coadvisor),
  });
  const achievement = c.type === 'achievement';
  const cx = 800;
  const body = [
    text(f.regular, achievement ? 'In recognition of outstanding achievement in' : 'For successfully participating in', cx, 466, 15.5, {
      anchor: 'middle',
      fill: MUTED,
    }),
    text(f.semibold, c.event, cx, 497, 20, { anchor: 'middle', fill: NAVY, maxWidth: 660 }),
  ];
  let y = 527;
  body.push(text(f.light, 'Organized by the AIChE Student Chapter, GSTU.', cx, y, 14, { anchor: 'middle', fill: MUTED }));
  if (c.achievement) {
    const p = paragraph(f.light, c.achievement, cx, y + 21, 640, 14, { anchor: 'middle', fill: MUTED, maxLines: 2, lineHeight: 1.45 });
    body.push(p.svg);
    y += p.height;
  }
  body.push(text(f.medium, `Date: ${labelDate(c.eventDate || c.dateIssued)}`, cx, y + 23, 13.5, { anchor: 'middle', fill: NAVY }));
  const lockupW = 250;
  return `${svgOpen(`Certificate of ${achievement ? 'Achievement' : 'Participation'} for ${c.name}`)}<title>${h(`${c.name} — ${c.event} — ${c.id}`)}</title>
    <defs>${honeycomb('combLight', '#e9e4d6')}${honeycomb('combPanel', '#ffffff', 30)}
      <clipPath id="panel"><path d="M0 0H360L250 ${HEIGHT}H0Z"/></clipPath></defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="#fdfcf9"/>
    <rect x="300" width="${WIDTH - 300}" height="${HEIGHT}" fill="url(#combLight)" opacity=".55"/>
    <path d="M0 0H360L250 ${HEIGHT}H0Z" fill="${NAVY}"/>
    <rect width="360" height="${HEIGHT}" fill="url(#combPanel)" opacity=".07" clip-path="url(#panel)"/>
    <path d="M374 0H394L284 ${HEIGHT}H264Z" fill="${GOLD}"/>
    <path d="M406 0H412L302 ${HEIGHT}H296Z" fill="${SKY}"/>
    <path d="M${WIDTH} 0V128L${WIDTH - 128} 0Z" fill="${GOLD}"/><path d="M${WIDTH} 0V74L${WIDTH - 74} 0Z" fill="${NAVY}"/>
    <path d="M${WIDTH} ${HEIGHT}H${WIDTH - 220}L${WIDTH} ${HEIGHT - 26}Z" fill="${NAVY}"/>

    <image href="${art.lockupWhite}" x="36" y="58" width="${lockupW}" height="${lockupW * LOCKUP_RATIO}"/>
    <line x1="40" y1="${82 + lockupW * LOCKUP_RATIO}" x2="120" y2="${82 + lockupW * LOCKUP_RATIO}" stroke="${GOLD}" stroke-width="3"/>
    ${text(f.medium, 'AMERICAN INSTITUTE OF', 40, 230, 11, { fill: '#ffffff', spacing: 2.4 })}
    ${text(f.medium, 'CHEMICAL ENGINEERS', 40, 247, 11, { fill: '#ffffff', spacing: 2.4 })}
    ${qrTile(c, 40, 548, 140)}
    ${text(f.semibold, 'SCAN TO VERIFY', 40, 730, 11, { fill: GOLD_2, spacing: 2.4 })}
    ${text(f.regular, `Credential ID ${c.id}`, 40, 752, 8.6, { fill: '#ffffff', maxWidth: 215 })}
    ${text(f.regular, issuedLine(c), 40, 768, 8.2, { fill: '#c9d3e4', maxWidth: 205 })}

    ${text(f.bebas, 'CERTIFICATE', cx, 206, 112, { anchor: 'middle', fill: NAVY, spacing: 12 })}
    ${text(f.semibold, achievement ? 'OF ACHIEVEMENT' : 'OF PARTICIPATION', cx, 250, 21, { anchor: 'middle', fill: GOLD, spacing: 8 })}
    ${text(f.regular, 'THIS CERTIFICATE IS PROUDLY PRESENTED TO', cx, 310, 12.5, { anchor: 'middle', fill: MUTED, spacing: 3 })}
    ${text(f.script, c.name, cx, 398, 72, { anchor: 'middle', fill: NAVY, maxWidth: 640 })}
    <line x1="${cx - 300}" y1="424" x2="${cx + 300}" y2="424" stroke="${GOLD}" stroke-width="1.4"/>
    ${hexagon(cx, 424, 6, `fill="${GOLD}"`)}
    ${body.join('')}

    ${signatureBlock(f, art, signatories[0], 0, 575, 700)}
    ${emblem(art, cx, 690, 34, GOLD)}
    ${signatureBlock(f, art, signatories[1], 1, 1025, 700)}
    ${preview ? text(f.semibold, 'SAMPLE — NOT ISSUED', cx, 120, 13, { anchor: 'middle', fill: SAMPLE_RED, spacing: 2 }) : ''}
  </svg>`;
}

// ------------------------------------------------------------------ Prestige: champion and runners-up

async function awardSVG(c, { preview }) {
  const f = await load({
    cinzel: loadFont(FONTS.cinzel),
    bebas: loadFont(FONTS.bebas),
    script: loadFont(FONTS.script),
    regular: loadFont(FONTS.poppins),
    light: loadFont(FONTS.poppinsLight),
    semibold: loadFont(FONTS.poppinsSemiBold),
  });
  const art = await load({
    lockupWhite: loadArt(ART.lockupWhite),
    gstu: loadArt(ART.gstu),
    advisor: loadArt(ART.advisor),
    coadvisor: loadArt(ART.coadvisor),
  });
  const award = AWARDS[c.type];
  const cx = WIDTH / 2;
  // Octagonal frame: a rectangle with clipped corners.
  const frame = (inset, cut) => {
    const [l, t, r, b] = [inset, inset, WIDTH - inset, HEIGHT - inset];
    return `M${l + cut} ${t}H${r - cut}L${r} ${t + cut}V${b - cut}L${r - cut} ${b}H${l + cut}L${l} ${b - cut}V${t + cut}Z`;
  };
  const details = paragraph(
    f.light,
    `Organized by the AIChE Student Chapter, GSTU.${c.achievement ? ' ' + c.achievement : ''}`,
    cx,
    522,
    700,
    14,
    { anchor: 'middle', fill: '#c9d3e4', maxLines: 2, lineHeight: 1.5 },
  );
  const lockupW = 236;
  return `${svgOpen(`${award.label} certificate for ${c.name}`)}<title>${h(`${c.name} — ${award.label} — ${c.event} — ${c.id}`)}</title>
    <defs>
      <radialGradient id="glow" cx=".5" cy=".42" r=".7"><stop offset="0" stop-color="${NAVY_2}"/><stop offset="1" stop-color="${NAVY_DEEP}"/></radialGradient>
      <linearGradient id="metal" x2="1" y2=".35"><stop offset="0" stop-color="${award.mid}"/><stop offset=".5" stop-color="${award.light}"/><stop offset="1" stop-color="${award.mid}"/></linearGradient>
      <linearGradient id="goldLine" x2="1"><stop offset="0" stop-color="${GOLD}"/><stop offset=".5" stop-color="${GOLD_2}"/><stop offset="1" stop-color="${GOLD}"/></linearGradient>
      ${honeycomb('combDark', '#ffffff', 30)}${WHITE_INK}
    </defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#combDark)" opacity=".045"/>
    <path d="${frame(26, 46)}" fill="none" stroke="url(#goldLine)" stroke-width="2.4"/>
    <path d="${frame(38, 40)}" fill="none" stroke="${GOLD}" stroke-width=".8" opacity=".7"/>
    ${[
      [26, 26],
      [WIDTH - 26, 26],
      [26, HEIGHT - 26],
      [WIDTH - 26, HEIGHT - 26],
    ]
      .map(([x, y]) => hexagon(x + (x < cx ? 23 : -23), y + (y < 400 ? 23 : -23), 7, `fill="${GOLD}"`))
      .join('')}

    ${emblem(art, 128, 122, 40, GOLD)}
    <image href="${art.lockupWhite}" x="${cx - lockupW / 2}" y="64" width="${lockupW}" height="${lockupW * LOCKUP_RATIO}"/>
    ${qrTile(c, 1004, 68, 104, 7)}
    ${text(f.semibold, 'SCAN TO VERIFY', 1063, 208, 9.5, { anchor: 'middle', fill: GOLD_2, spacing: 1.8 })}

    ${text(f.cinzel, 'Certificate of Achievement', cx, 236, 40, { anchor: 'middle', fill: GOLD_2, spacing: 2, maxWidth: 760 })}
    ${text(f.regular, 'THIS CERTIFICATE IS PROUDLY PRESENTED TO', cx, 276, 12.5, { anchor: 'middle', fill: '#c9d3e4', spacing: 3 })}
    ${text(f.script, c.name, cx, 364, 76, { anchor: 'middle', fill: '#ffffff', maxWidth: 780 })}
    <path d="M${cx - 190} 392H${cx + 190}L${cx + 168} 415L${cx + 190} 438H${cx - 190}L${cx - 168} 415Z" fill="url(#metal)"/>
    ${text(f.bebas, award.label.toUpperCase(), cx, 427, 31, { anchor: 'middle', fill: NAVY_DEEP, spacing: 6, maxWidth: 300 })}
    ${mixedLine({ font: f.light, text: 'in the ' }, { font: f.semibold, text: c.event }, cx, 488, 18, { fill: '#ffffff', maxWidth: 820 })}
    ${details.svg}
    ${text(f.regular, `Date: ${labelDate(c.eventDate || c.dateIssued)}`, cx, 522 + details.height + 6, 13.5, { anchor: 'middle', fill: '#ffffff' })}

    ${hexagon(cx, 680, 64, 'fill="url(#metal)"')}${hexagon(cx, 680, 53, `fill="${NAVY_DEEP}"`)}${hexagon(cx, 680, 47, `fill="none" stroke="${award.mid}" stroke-width="1"`)}
    ${text(f.bebas, award.rank, cx, 702, 62, { anchor: 'middle', fill: award.light })}
    ${signatureBlock(f, art, signatories[0], 0, 300, 690, { ink: '#ffffff', sub: '#c9d3e4', white: true })}
    ${signatureBlock(f, art, signatories[1], 1, 900, 690, { ink: '#ffffff', sub: '#c9d3e4', white: true })}
    ${text(f.regular, `Credential ID ${c.id} · ${issuedLine(c)}`, cx, 790, 10, { anchor: 'middle', fill: '#9fb0c9', maxWidth: 820 })}
    ${preview ? text(f.semibold, 'SAMPLE — NOT ISSUED', cx, 812, 12, { anchor: 'middle', fill: '#ff8a80', spacing: 2 }) : ''}
  </svg>`;
}

// ------------------------------------------------------------------ Heritage: formal recognition

async function formalSVG(c, { preview }) {
  const f = await load({
    cinzel: loadFont(FONTS.cinzel),
    serif: loadFont(FONTS.serif),
    serifItalic: loadFont(FONTS.serifItalic),
    regular: loadFont(FONTS.poppins),
    semibold: loadFont(FONTS.poppinsSemiBold),
  });
  const art = await load({
    lockup: loadArt(ART.lockup),
    gstu: loadArt(ART.gstu),
    advisor: loadArt(ART.advisor),
    coadvisor: loadArt(ART.coadvisor),
  });
  const PAPER = '#fbf8ef';
  const cx = WIDTH / 2;
  const title = FORMAL_TITLES[c.type] || 'Certificate of Recognition';
  const term = String(c.event || '').replace(/^Executive service · /, '');
  const citation =
    c.achievement ||
    (c.type === 'executive'
      ? `in recognition of dedicated executive service to the AIChE Student Chapter, GSTU during the ${term} term`
      : `${certificateTypes[c.type]?.[1] || 'in recognition of distinguished service to'} ${c.event}`);
  const nameY = 394;
  const top = c.designation ? 470 : 452;
  const cite = paragraph(f.serif, citation, cx, top, 800, 17, { anchor: 'middle', fill: '#2c3445', maxLines: 2, lineHeight: 1.55 });
  const given = paragraph(
    f.serifItalic,
    `Given under the seal of the AIChE Student Chapter, GSTU, ${formalDate(c.dateIssued)}.`,
    cx,
    top + cite.height + 8,
    820,
    13,
    {
      anchor: 'middle',
      fill: '#4a5262',
      maxLines: 2,
    },
  );
  const lockupW = 236;
  const corner = (x, y) => `${hexagon(x, y, 11, `fill="${NAVY}"`)}${hexagon(x, y, 4.5, `fill="${GOLD}"`)}`;
  const divider = (y) =>
    `<line x1="${cx - 170}" y1="${y}" x2="${cx - 14}" y2="${y}" stroke="${GOLD}" stroke-width="1"/>${hexagon(cx, y, 6, `fill="none" stroke="${GOLD}" stroke-width="1.2"`)}<line x1="${cx + 14}" y1="${y}" x2="${cx + 170}" y2="${y}" stroke="${GOLD}" stroke-width="1"/>`;
  return `${svgOpen(`${title} for ${c.name}`)}<title>${h(`${c.name} — ${c.event} — ${c.id}`)}</title>
    <defs>${honeycomb('combIvory', '#e6dcc2', 34)}</defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="${PAPER}"/>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#combIvory)" opacity=".35"/>
    <g fill="none" stroke="${NAVY}" opacity=".05">${[90, 150, 210, 270].map((r) => hexagon(cx, 430, r, 'stroke-width="2"')).join('')}</g>
    <rect x="22" y="22" width="${WIDTH - 44}" height="${HEIGHT - 44}" fill="none" stroke="${NAVY}" stroke-width="2.5"/>
    <rect x="34" y="34" width="${WIDTH - 68}" height="${HEIGHT - 68}" fill="none" stroke="${GOLD}" stroke-width="1"/>
    <rect x="${cx - 260}" y="22" width="520" height="7" fill="${NAVY}"/><rect x="${cx - 180}" y="29" width="360" height="3" fill="${GOLD}"/>
    ${corner(34, 34)}${corner(WIDTH - 34, 34)}${corner(34, HEIGHT - 34)}${corner(WIDTH - 34, HEIGHT - 34)}

    <image href="${art.lockup}" x="${cx - lockupW - 24}" y="62" width="${lockupW}" height="${lockupW * LOCKUP_RATIO}"/>
    <line x1="${cx}" y1="70" x2="${cx}" y2="${58 + lockupW * LOCKUP_RATIO}" stroke="${GOLD}" stroke-width="1"/>
    ${emblem(art, cx + 64, 114, 38, GOLD)}
    ${text(f.semibold, 'GOPALGANJ SCIENCE AND', cx + 114, 110, 9.5, { fill: '#14713a', spacing: 1 })}
    ${text(f.semibold, 'TECHNOLOGY UNIVERSITY', cx + 114, 125, 9.5, { fill: '#14713a', spacing: 1 })}

    ${text(f.cinzel, 'American Institute of Chemical Engineers · Student Chapter', cx, 210, 13.5, { anchor: 'middle', fill: GOLD, spacing: 2.2, maxWidth: 820 })}
    ${text(f.serif, title, cx, 262, 38, { anchor: 'middle', fill: NAVY, maxWidth: 820 })}
    ${divider(288)}
    ${text(f.serifItalic, 'is proudly presented to', cx, 328, 16, { anchor: 'middle', fill: '#4a5262' })}
    ${text(f.cinzel, c.name, cx, nameY, 50, { anchor: 'middle', fill: NAVY, maxWidth: 880 })}
    ${c.designation ? text(f.serifItalic, c.designation, cx, 428, 17, { anchor: 'middle', fill: '#3a4152', maxWidth: 680 }) : ''}
    ${cite.svg}${given.svg}

    ${signatureBlock(f, art, signatories[0], 0, 255, 690, { width: 250 })}
    ${signatureBlock(f, art, signatories[1], 1, WIDTH - 255, 690, { width: 250 })}
    ${hexagon(cx, 660, 92, `fill="${GOLD}"`)}${hexagon(cx, 660, 85, `fill="${NAVY}"`)}${hexagon(cx, 660, 80, `fill="none" stroke="${GOLD_2}" stroke-width=".8"`)}
    ${qrTile(c, cx - 55, 605, 96, 7)}
    ${text(f.semibold, `Credential ID ${c.id}`, cx, 778, 10, { anchor: 'middle', fill: NAVY, maxWidth: 360 })}
    ${text(f.regular, issuedLine(c), cx, 794, 9.5, { anchor: 'middle', fill: MUTED, maxWidth: 360 })}
    ${preview ? text(f.semibold, 'SAMPLE — NOT ISSUED', cx, 814, 11, { anchor: 'middle', fill: SAMPLE_RED, spacing: 1.6 }) : ''}
  </svg>`;
}
// ------------------------------------------------------------------ public API

export async function certificateSVG(c, { preview = false } = {}) {
  if (formalTypes.includes(c.type)) return formalSVG(c, { preview });
  return AWARDS[c.type] ? awardSVG(c, { preview }) : participationSVG(c, { preview });
}

/** pdf-lib, loaded on first use (it is large and only needed for downloads). */
export function loadPdfLib() {
  return once('pdf-lib', async () => {
    if (!window.PDFLib)
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'js/vendor/pdf-lib.min.js';
        s.onload = resolve;
        s.onerror = () => reject(Error('The PDF tools could not load. Check your connection and try again.'));
        document.head.append(s);
      });
    return window.PDFLib;
  });
}

export async function downloadCertificate(c, { preview = false } = {}) {
  const svg = await certificateSVG(c, { preview });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // 2× the artboard keeps text and the QR code crisp in print.
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH * 2;
    canvas.height = HEIGHT * 2;
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const PDFLib = await loadPdfLib();
    const pdf = await PDFLib.PDFDocument.create();
    const page = pdf.addPage([841.89, 595.28]);
    const image = await pdf.embedPng(canvas.toDataURL('image/png'));
    page.drawImage(image, { x: 0, y: 0, width: 841.89, height: 595.28 });
    pdf.setTitle(`${preview ? 'Sample - ' : ''}${c.name} - ${c.event}`);
    pdf.setAuthor('AIChE Student Chapter, GSTU');
    // The whole page links to the verification record.
    const link = pdf.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [0, 0, 841.89, 595.28],
      Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFLib.PDFString.of(certificateURL(c.id)) },
    });
    page.node.set(PDFLib.PDFName.of('Annots'), pdf.context.obj([pdf.context.register(link)]));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([await pdf.save()], { type: 'application/pdf' }));
    a.download = `${preview ? 'SAMPLE-' : ''}${c.id}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } finally {
    URL.revokeObjectURL(url);
  }
}
