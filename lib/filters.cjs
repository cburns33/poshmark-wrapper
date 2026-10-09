function words(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' ').replace(/\band\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}
const compact = value => words(value).replace(/ /g, '');

function createFilter(preferences) {
  const blocked = preferences.blocked_brands.map(brand => ({
    brand, key: compact(brand), titlePattern: new RegExp('(?:^| )' + words(brand).split(' ').join(' *') + '(?: |$)')
  }));
  return listing => {
    if (listing.currency !== 'USD' || !Number.isFinite(listing.asking_price) || listing.asking_price < 0) return { keep: false, reason: 'unverified_price' };
    if (listing.asking_price > preferences.max_asking_price_usd) return { keep: false, reason: 'over_budget' };
    if (listing.availability && listing.availability !== 'available') return { keep: false, reason: 'unavailable' };
    const brandKey = compact(listing.brand);
    const brandMatch = blocked.find(item => item.key === brandKey);
    if (brandMatch) return { keep: false, reason: 'blocked_brand', brand: brandMatch.brand };
    if (!brandKey && preferences.title_fallback) {
      const title = words(listing.title);
      const titleMatch = blocked.find(item => item.titlePattern.test(title));
      if (titleMatch) return { keep: false, reason: 'blocked_title', brand: titleMatch.brand };
    }
    return { keep: true, reason: null };
  };
}
module.exports = { createFilter };
