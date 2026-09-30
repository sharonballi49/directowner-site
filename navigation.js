(function () {
  const header = document.querySelector('.site-header');
  const nav = header?.querySelector('.site-nav');
  const button = header?.querySelector('.menu-toggle');
  const links = nav?.querySelector('.nav-links');
  if (!button || !links) return;
  links.id = links.id || 'site-navigation';
  nav.classList.add('has-menu');
  button.type = 'button';
  button.setAttribute('aria-controls', links.id);
  function setOpen(open) {
    nav.classList.toggle('is-open', open);
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }
  setOpen(false);
  button.addEventListener('click', () => setOpen(button.getAttribute('aria-expanded') !== 'true'));
  header.addEventListener('keydown', event => {
    if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      button.focus();
    }
  });
})();
