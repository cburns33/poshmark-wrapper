function words(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/\band\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const compact = value => words(value).replace(/ /g, '');

export function createFilter(rules) {
  const blocked = rules.blocked_brands.map(brand => ({
    key: compact(brand),
    titlePattern: new RegExp(`(?:^| )${words(brand).split(' ').join(' *')}(?: |$)`),
  }));

  return listing => {
    if (listing.currency !== 'USD' || !Number.isFinite(listing.asking_price_cents)) return false;
    if (listing.asking_price_cents > rules.max_price_cents) return false;
    if (listing.availability && listing.availability !== 'available') return false;
    const brandKey = compact(listing.brand);
    if (blocked.some(item => item.key === brandKey)) return false;
    if (!brandKey && rules.title_fallback) {
      const title = words(listing.title);
      if (blocked.some(item => item.titlePattern.test(title))) return false;
    }
    return true;
  };
}
