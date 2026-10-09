import { createClient } from '@supabase/supabase-js';
import { createFilter } from './filters.mjs';
import './style.css';

const config = {
  url: import.meta.env.VITE_SUPABASE_URL,
  key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
};
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const elements = Object.fromEntries([
  'auth', 'feed', 'sign-in-form', 'auth-error', 'reload', 'sign-out', 'rules', 'summary', 'grid', 'empty', 'error',
].map(id => [id, document.getElementById(id)]));
const viewButtons = [...document.querySelectorAll('.view-button')];
let supabase;
let session;
let listings = [];
let listingState = new Map();
let currentView = 'all';
let viewObserver;
let viewedTimer;
const pendingViewed = new Set();

function showError(target, message) {
  target.textContent = message;
  target.hidden = !message;
}

function stateFor(id) {
  return listingState.get(id) || {};
}

async function saveState(id, changes) {
  const now = new Date().toISOString();
  const previous = stateFor(id);
  const next = { ...stateFor(id), ...changes, owner_id: session.user.id, poshmark_id: id, updated_at: now };
  listingState.set(id, next);
  const { error } = await supabase.from('user_listing_state').upsert(next, { onConflict: 'owner_id,poshmark_id' });
  if (error) {
    listingState.set(id, previous);
    throw error;
  }
}

async function flushViewed() {
  const ids = [...pendingViewed];
  pendingViewed.clear();
  if (!ids.length || !session) return;
  const now = new Date().toISOString();
  const rows = ids.map(id => {
    const next = { ...stateFor(id), owner_id: session.user.id, poshmark_id: id, viewed_at: now, updated_at: now };
    listingState.set(id, next);
    return next;
  });
  const { error } = await supabase.from('user_listing_state').upsert(rows, { onConflict: 'owner_id,poshmark_id' });
  if (error) showError(elements.error, 'Your viewed history could not be updated.');
}

function observeCard(article, listing) {
  if (stateFor(listing.poshmark_id).viewed_at) return;
  viewObserver.observe(article);
}

function card(listing) {
  const state = stateFor(listing.poshmark_id);
  const article = document.createElement('article');
  article.className = 'card';
  article.dataset.id = listing.poshmark_id;

  const link = document.createElement('a');
  link.className = 'photo-link';
  link.href = listing.listing_url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `${listing.title}, ${dollars.format(listing.asking_price_cents / 100)}, open on Poshmark`);
  link.addEventListener('click', () => saveState(listing.poshmark_id, {
    opened_at: new Date().toISOString(),
    viewed_at: state.viewed_at || new Date().toISOString(),
  }).catch(() => showError(elements.error, 'The listing opened, but its history was not saved.')));

  if (listing.signed_image_url) {
    const image = document.createElement('img');
    image.src = listing.signed_image_url;
    image.alt = listing.title;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => {
      const label = document.createElement('span');
      label.className = 'placeholder';
      label.textContent = 'Photo unavailable. View on Poshmark ↗';
      link.replaceChildren(label);
    }, { once: true });
    link.append(image);
  } else {
    const label = document.createElement('span');
    label.className = 'placeholder';
    label.textContent = 'Photo unavailable. View on Poshmark ↗';
    link.append(label);
  }

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const brand = document.createElement('span');
  brand.className = 'brand';
  brand.textContent = listing.brand || 'Unlisted brand';
  const price = document.createElement('span');
  price.className = 'price';
  price.textContent = dollars.format(listing.asking_price_cents / 100);
  meta.append(brand, price);

  const title = document.createElement('p');
  title.className = 'title';
  title.textContent = listing.title;

  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = `card-action${state.saved_at ? ' selected' : ''}`;
  save.textContent = state.saved_at ? 'Saved' : 'Save';
  save.setAttribute('aria-pressed', String(Boolean(state.saved_at)));
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await saveState(listing.poshmark_id, { saved_at: stateFor(listing.poshmark_id).saved_at ? null : new Date().toISOString() });
      renderListings();
    } catch {
      showError(elements.error, 'That item could not be saved.');
      save.disabled = false;
    }
  });
  const hide = document.createElement('button');
  hide.type = 'button';
  hide.className = 'card-action';
  hide.textContent = 'Hide';
  hide.addEventListener('click', async () => {
    hide.disabled = true;
    try {
      await saveState(listing.poshmark_id, { hidden_at: new Date().toISOString() });
      renderListings();
    } catch {
      showError(elements.error, 'That item could not be hidden.');
      hide.disabled = false;
    }
  });
  actions.append(save, hide);
  article.append(link, meta, title, actions);
  observeCard(article, listing);
  return article;
}

function renderListings() {
  viewObserver.disconnect();
  const visible = listings.filter(listing => {
    const state = stateFor(listing.poshmark_id);
    return !state.hidden_at && (currentView === 'all' || state.saved_at);
  });
  elements.grid.replaceChildren(...visible.map(card));
  elements.empty.hidden = visible.length > 0;
  if (!visible.length && currentView === 'saved') {
    elements.empty.querySelector('h2').textContent = 'No saved picks yet.';
    elements.empty.querySelector('p').textContent = 'Tap Save on any listing to keep it here.';
  } else {
    elements.empty.querySelector('h2').textContent = 'Your next finds will appear here.';
    elements.empty.querySelector('p').textContent = 'Run the collector on your computer to replenish this feed.';
  }
  const savedCount = listings.filter(item => stateFor(item.poshmark_id).saved_at && !stateFor(item.poshmark_id).hidden_at).length;
  viewButtons.find(button => button.dataset.view === 'saved').textContent = `Saved${savedCount ? ` (${savedCount})` : ''}`;
}

async function signedImages(rows) {
  const paths = rows.map(row => row.cover_image_path).filter(Boolean);
  if (!paths.length) return new Map();
  const { data, error } = await supabase.storage.from('listing-images').createSignedUrls(paths, 3600);
  if (error) throw error;
  return new Map(data.filter(item => item.signedUrl).map(item => [item.path, item.signedUrl]));
}

async function loadFeed() {
  elements.reload.disabled = true;
  showError(elements.error, '');
  elements.summary.textContent = 'Opening your feed...';
  try {
    const [listingResult, rulesResult, stateResult, batchResult] = await Promise.all([
      supabase.from('listings').select('poshmark_id,title,brand,asking_price_cents,currency,listing_url,cover_image_path,availability,source_position,last_seen_at').order('last_seen_at', { ascending: false }).order('source_position', { ascending: true }).limit(1000),
      supabase.from('filter_rules').select('max_price_cents,blocked_brands,title_fallback').single(),
      supabase.from('user_listing_state').select('*').limit(1000),
      supabase.from('collection_batches').select('listing_count,completed_at').order('started_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    for (const result of [listingResult, rulesResult, stateResult, batchResult]) if (result.error) throw result.error;
    listingState = new Map(stateResult.data.map(item => [item.poshmark_id, item]));
    const filter = createFilter(rulesResult.data);
    const eligible = listingResult.data.filter(filter);
    const imageUrls = await signedImages(eligible);
    listings = eligible.map(item => ({ ...item, signed_image_url: imageUrls.get(item.cover_image_path) }));
    const updated = batchResult.data?.completed_at ? new Date(batchResult.data.completed_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
    elements.rules.textContent = `Up to ${dollars.format(rulesResult.data.max_price_cents / 100)} · ${rulesResult.data.blocked_brands.length} brands excluded · Poshmark's suggested order`;
    elements.summary.textContent = `${eligible.length} picks from ${batchResult.data?.listing_count ?? listingResult.data.length} collected${updated ? ` · Updated ${updated}` : ''}`;
    renderListings();
  } catch (failure) {
    elements.summary.textContent = 'The saved feed could not be loaded.';
    showError(elements.error, failure.message || 'Please refresh and try again.');
  } finally {
    elements.reload.disabled = false;
  }
}

async function showSession(nextSession) {
  session = nextSession;
  elements.auth.hidden = Boolean(session);
  elements.feed.hidden = !session;
  if (session) await loadFeed();
  else {
    elements.grid.replaceChildren();
    listings = [];
    listingState.clear();
  }
}

elements['sign-in-form'].addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  submit.disabled = true;
  showError(elements['auth-error'], '');
  const form = new FormData(event.currentTarget);
  const { error } = await supabase.auth.signInWithPassword({ email: form.get('email'), password: form.get('password') });
  if (error) showError(elements['auth-error'], error.message);
  submit.disabled = false;
});

elements.reload.addEventListener('click', loadFeed);
elements['sign-out'].addEventListener('click', () => supabase.auth.signOut());
viewButtons.forEach(button => button.addEventListener('click', () => {
  currentView = button.dataset.view;
  viewButtons.forEach(item => {
    const active = item === button;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
  });
  renderListings();
}));

viewObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    pendingViewed.add(entry.target.dataset.id);
    viewObserver.unobserve(entry.target);
  }
  clearTimeout(viewedTimer);
  viewedTimer = setTimeout(flushViewed, 500);
}, { threshold: 0.6 });

if (!config.url || !config.key) {
  showError(elements['auth-error'], 'Supabase browser configuration is missing.');
  elements['sign-in-form'].querySelector('button').disabled = true;
} else {
  supabase = createClient(config.url, config.key);
  const { data } = await supabase.auth.getSession();
  await showSession(data.session);
  supabase.auth.onAuthStateChange((_event, nextSession) => {
    if (nextSession?.access_token === session?.access_token) return;
    setTimeout(() => showSession(nextSession), 0);
  });
}

if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js');
