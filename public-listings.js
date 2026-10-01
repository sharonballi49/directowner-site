(function () {
  const results = document.getElementById('public-listings');
  if (!results) return;
  const status = document.getElementById('inventory-status');
  const count = document.getElementById('result-count');
  const controls = {
    type: document.getElementById('filter-type'),
    minPrice: document.getElementById('filter-price'),
    maxPrice: document.getElementById('filter-max-price'),
    query: document.getElementById('filter-search'),
    location: document.getElementById('filter-location'),
    sort: document.getElementById('filter-sort')
  };
  const params = new URLSearchParams(location.search);
  Object.entries(controls).forEach(([name, control]) => {
    if (control && params.has(name)) control.value = params.get(name);
  });
  const limit = Number(results.dataset.limit) || Infinity;
  const rules = window.DirectOwnerInventory;
  let listings = [];
  let client;
  let loaded = false;
  const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function message(text, error = false) {
    status.textContent = text;
    status.classList.toggle('error', error);
  }
  function empty(title, description) {
    const box = element('div', 'inventory-empty');
    box.append(element('h3', '', title), element('p', '', description));
    const link = element('a', 'btn btn-primary', 'List Your Vehicle');
    link.href = 'sell.html';
    box.append(link);
    results.append(box);
  }
  function card(item) {
    const article = element('article', 'listing-card');
    const placeholder = element('div', 'listing-image inventory-photo-placeholder', 'Photo not provided');
    const photo = item.photo_paths?.[0];
    if (photo) {
      const image = element('img', 'listing-image');
      image.src = client.storage.from('vehicle-photos').getPublicUrl(photo).data.publicUrl;
      image.alt = `${item.title} vehicle photo`;
      image.loading = 'lazy';
      image.addEventListener('error', () => image.replaceWith(placeholder), { once: true });
      article.append(image);
    } else article.append(placeholder);
    const content = element('div', 'listing-content');
    const mileage = item.mileage == null ? 'Mileage not provided' : `${Number(item.mileage).toLocaleString('en-US')} miles`;
    const link = element('a', 'btn btn-primary', 'View Details');
    link.href = `active-listing.html?id=${encodeURIComponent(item.id)}`;
    content.append(
      element('span', 'listing-type', item.vehicle_type),
      element('h3', '', item.title),
      element('p', 'listing-price', money(item.price_cents)),
      element('p', 'listing-meta', `${mileage} • ${item.seller_location || 'Location not provided'}`),
      link
    );
    if (window.DirectOwnerBuyerTools) {
      const actions = element('div', 'buyer-listing-actions');
      const plan = element('a', 'btn btn-secondary', 'Buyer tools');
      plan.href = `buyer-tools.html?id=${encodeURIComponent(item.id)}`;
      actions.append(plan, window.DirectOwnerBuyerTools.saveButton(item));
      content.append(actions);
    }
    article.append(content);
    return article;
  }
  function render() {
    if (!loaded) return;
    const filters = Object.fromEntries(Object.entries(controls).map(([name, control]) => [name, control?.value || '']));
    const visible = listings.filter(item => rules.matches(item, filters));
    if (filters.sort === 'price-low') visible.sort((a, b) => a.price_cents - b.price_cents);
    else if (filters.sort === 'price-high') visible.sort((a, b) => b.price_cents - a.price_cents);
    results.replaceChildren();
    if (count) count.textContent = `${visible.length} listing${visible.length === 1 ? '' : 's'} found`;
    if (!listings.length) {
      message('We are welcoming our first owner listings.');
      empty('Listings coming soon', 'Be among the first to list your vehicle. Test and example listings are not offered for sale.');
    } else if (!visible.length) {
      message('No listings match your search.');
      empty('Try another search', 'Change your filters or clear them to see all available vehicles.');
    } else {
      message('Review seller-provided details and arrange an independent inspection before buying.');
      visible.slice(0, limit).forEach(item => results.append(card(item)));
    }
  }
  Object.values(controls).forEach(control => control?.addEventListener('input', render));
  document.getElementById('clear-filters')?.addEventListener('click', () => {
    Object.values(controls).forEach(control => { if (control) control.value = ''; });
    controls.sort.value = 'newest';
    history.replaceState(null, '', location.pathname);
    render();
  });
  document.getElementById('browse-filters')?.addEventListener('submit', event => event.preventDefault());
  async function load() {
    try {
      if (!window.supabase || !rules) throw new Error('Inventory service unavailable');
      client = window.supabase.createClient(window.DIRECTOWNER_SUPABASE_URL, window.DIRECTOWNER_SUPABASE_PUBLISHABLE_KEY);
      let query = client.from('listings').select('id,title,description,vehicle_type,year,make,model,price_cents,mileage,seller_location,created_at,status,moderation_status,is_test,photo_paths').eq('status', 'active').eq('moderation_status', 'approved');
      rules.testIds.forEach(id => { query = query.neq('id', id); });
      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      listings = (data || []).filter(rules.isPublic);
      loaded = true;
      render();
    } catch (error) {
      message('We could not load listings right now. Please refresh or contact DirectOwner support.', true);
      const retry = element('button', 'btn btn-secondary', 'Try Again');
      retry.type = 'button';
      retry.addEventListener('click', () => { results.replaceChildren(); message('Loading listings...'); load(); });
      results.replaceChildren(retry);
    }
  }
  load();
})();
