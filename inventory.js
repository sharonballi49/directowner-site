// Shared public inventory rules. Test records remain available in the owner's dashboard.
(function (root) {
  const testIds = new Set(['3dcae366-5b6a-4a34-93a7-a7605c526925']);
  const normalize = value => String(value ?? '').trim().toLowerCase();
  function isTestId(id) { return testIds.has(normalize(id)); }
  function isPublic(item) { return item.status === 'active' && !item.is_test && !isTestId(item.id); }
  function matches(item, filters = {}) {
    const haystack = normalize([item.title, item.make, item.model, item.description].join(' '));
    return (!filters.type || item.vehicle_type === filters.type)
      && Number(item.price_cents) >= Number(filters.minPrice || 0) * 100
      && (filters.maxPrice === '' || filters.maxPrice == null || Number(item.price_cents) <= Number(filters.maxPrice) * 100)
      && (!normalize(filters.query) || haystack.includes(normalize(filters.query)))
      && (!normalize(filters.location) || normalize(item.seller_location).includes(normalize(filters.location)));
  }
  root.DirectOwnerInventory = { isTestId, isPublic, matches, testIds: Array.from(testIds) };
})(typeof window !== 'undefined' ? window : globalThis);
