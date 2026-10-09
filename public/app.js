const grid = document.querySelector('#grid');
const reload = document.querySelector('#reload');
const summary = document.querySelector('#summary');
const empty = document.querySelector('#empty');
const error = document.querySelector('#error');
const collectionStatus = document.querySelector('#collection-status');
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
let timer;
let loading = false;

function card(listing) {
  const article = document.createElement('article');
  article.className = 'card';
  const link = document.createElement('a');
  link.className = 'photo-link';
  link.href = listing.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `${listing.title}, ${dollars.format(listing.price)}, open on Poshmark`);
  const placeholder = () => {
    const label = document.createElement('span');
    label.className = 'placeholder';
    label.textContent = 'Photo unavailable. View on Poshmark ↗';
    link.replaceChildren(label);
  };
  if (listing.image) {
    const image = document.createElement('img');
    image.src = listing.image;
    image.alt = listing.title;
    image.decoding = 'async';
    image.addEventListener('error', placeholder, { once: true });
    link.append(image);
  } else placeholder();
  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const brand = document.createElement('span');
  brand.className = 'brand';
  brand.textContent = listing.brand || 'Unlisted brand';
  const price = document.createElement('span');
  price.className = 'price';
  price.textContent = dollars.format(listing.price);
  const title = document.createElement('p');
  title.className = 'title';
  title.textContent = listing.title;
  meta.append(brand, price);
  article.append(link, meta, title);
  return article;
}

async function load() {
  if (loading) return;
  loading = true;
  reload.disabled = true;
  clearTimeout(timer);
  try {
    const response = await fetch('/api/feed', { cache: 'no-store' });
    if (!response.ok) throw new Error('The saved feed could not be loaded. Keep the local server running and try again.');
    const data = await response.json();
    document.querySelector('#rules').textContent = `Up to ${dollars.format(data.filters.max_price)} · ${data.filters.blocked_brands} brands excluded · Poshmark’s suggested order`;
    const stamp = data.run?.finished_at || data.run?.id;
    const date = stamp ? new Date(stamp).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
    summary.textContent = `${data.summary.eligible} picks from ${data.summary.collected} collected${date ? ' · Updated ' + date : ''}`;
    grid.replaceChildren(...data.listings.map(card));
    empty.hidden = data.listings.length !== 0;
    if (!empty.hidden && data.summary.collected > 0) {
      empty.querySelector('h2').textContent = 'No listings match your rules yet.';
      empty.querySelector('p').textContent = 'Your cache is saved. A future collection or an edit to your preferences can bring in more picks.';
    }
    error.hidden = true;
    const working = ['waiting_for_login', 'collecting', 'caching_images'].includes(data.run?.status);
    collectionStatus.hidden = !working && data.run?.status !== 'needs_attention' && data.run?.status !== 'partial';
    collectionStatus.textContent = data.run?.detail || '';
    if (working) timer = setTimeout(load, 5000);
  } catch (failure) {
    error.textContent = failure.message;
    error.hidden = false;
    if (!grid.children.length) summary.textContent = 'The local cache is unavailable.';
  } finally {
    loading = false;
    reload.disabled = false;
  }
}
reload.addEventListener('click', load);
load();
