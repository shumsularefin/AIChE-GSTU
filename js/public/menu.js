// Site header: mobile menu (Escape closes, focus stays inside while open) and the scrolled style.
const mobile = matchMedia('(max-width: 1080px)');

export function setupMenu() {
  const header = document.getElementById('site-header');
  const toggle = document.getElementById('menu-toggle');
  const menu = document.getElementById('site-menu');
  if (!header || !toggle || !menu) return;
  const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';
  // The menu is only hidden (inert) while it is collapsed on small screens.
  const sync = () => {
    menu.inert = mobile.matches && !isOpen();
  };
  const setOpen = (open, { focus = true } = {}) => {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menu.classList.toggle('active', open);
    header.classList.toggle('menu-open-header', open);
    document.getElementById('hamburger-menu')?.classList.toggle('open', open);
    document.body.classList.toggle('menu-open', open);
    sync();
    if (!focus) return;
    if (open) menu.querySelector('a')?.focus();
    else toggle.focus();
  };
  toggle.addEventListener('click', () => setOpen(!isOpen()));
  // Dropdowns: open on hover or keyboard focus on wide screens (CSS); the arrow buttons open them on
  // touch screens and in the mobile menu. Opening one closes the others.
  const closeSubmenus = (except) => {
    for (const button of menu.querySelectorAll('.submenu-toggle'))
      if (button !== except) {
        button.setAttribute('aria-expanded', 'false');
        button.parentElement.classList.remove('open');
      }
  };
  menu.addEventListener('click', (e) => {
    const button = e.target.closest('.submenu-toggle');
    if (!button) return;
    const open = button.getAttribute('aria-expanded') !== 'true';
    closeSubmenus(button);
    button.setAttribute('aria-expanded', String(open));
    button.parentElement.classList.toggle('open', open);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.has-menu')) closeSubmenus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !isOpen()) closeSubmenus();
  });
  menu.addEventListener('click', (e) => {
    if (e.target.closest('a') && isOpen()) setOpen(false, { focus: false });
  });
  document.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (e.key === 'Escape') setOpen(false);
    if (e.key === 'Tab') {
      const items = [...menu.querySelectorAll('a, .submenu-toggle')].filter((el) => el.offsetParent !== null).concat(toggle);
      const index = items.indexOf(document.activeElement);
      e.preventDefault();
      items[(index + (e.shiftKey ? items.length - 1 : 1)) % items.length].focus();
    }
  });
  mobile.addEventListener('change', () => {
    if (!mobile.matches && isOpen()) setOpen(false, { focus: false });
    sync();
  });
  sync();

  const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 24);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

/** Sections below the fold rise in as they scroll into view (never content that is already visible). */
export function setupReveal() {
  const items = [...document.querySelectorAll('[data-reveal]')];
  if (!items.length || matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('reveal-in');
        entry.target.classList.remove('reveal-pending');
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
  );
  for (const item of items) {
    if (item.getBoundingClientRect().top < innerHeight) continue;
    item.classList.add('reveal-pending');
    observer.observe(item);
  }
}
