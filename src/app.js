import { createClient } from '@supabase/supabase-js';
import { createFilter } from './filters.mjs';
import './style.css';

const config = {
  url: import.meta.env.VITE_SUPABASE_URL,
  key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
};
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const elements = Object.fromEntries([
  'auth', 'feed', 'sign-in-form', 'auth-error', 'reload', 'sign-out', 'rules', 'summary', 'grid', 'empty', 'error',
  'loading', 'feed-error', 'feed-error-message', 'retry-feed', 'empty-action', 'action-status', 'undo-notice', 'undo-message', 'undo-hide', 'feed-title',
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
const hiddenHistory = [];
let collectionSummary = '';

function setPending(button, pending) {
  button.setAttribute('aria-disabled', String(pending));
  button.setAttribute('aria-busy', String(pending));
}

function updateUndo() {
  elements['undo-notice'].hidden = !hiddenHistory.length;
  document.body.classList.toggle('has-undo', Boolean(hiddenHistory.length));
  elements['undo-message'].textContent = hiddenHistory.length === 1 ? 'Item hidden.' : `${hiddenHistory.length} items hidden.`;
}

new ResizeObserver(([entry]) => {
  document.documentElement.style.setProperty('--undo-height', `${entry.target.getBoundingClientRect().height + 28}px`);
}).observe(elements['undo-notice']);

function updateCounts() {
  const visible = listings.filter(item => !stateFor(item.poshmark_id).hidden_at);
  const savedCount = visible.filter(item => stateFor(item.poshmark_id).saved_at).length;
  viewButtons.find(button => button.dataset.view === 'saved').textContent = `Saved${savedCount ? ` (${savedCount})` : ''}`;
  elements.summary.textContent = `${currentView === 'saved' ? `${savedCount} saved picks` : `${visible.length} picks`}${collectionSummary}`;
}

function focusAfterRemoval(article, action) {
  const next = article.nextElementSibling || article.previousElementSibling;
  article.remove();
  renderListings();
  const replacement = next && [...elements.grid.children].find(item => item.dataset.id === next.dataset.id);
  (replacement?.querySelector(`[data-action="${action}"]`) || viewButtons.find(button => button.dataset.view === currentView)).focus({ preventScroll: true });
}

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
  if (error) showError(elements.error, 'Viewed history could not be updated. Check your connection and select Refresh to try again.');
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
  link.setAttribute('aria-label', `${listing.title}, ${dollars.format(listing.asking_price_cents / 100)}, open on Poshmark in a new tab`);
  link.addEventListener('click', () => saveState(listing.poshmark_id, {
    opened_at: new Date().toISOString(),
    viewed_at: state.viewed_at || new Date().toISOString(),
  }).catch(() => showError(elements.error, 'Opened history could not be saved. Check your connection, then reopen the photo to try again.')));

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
  const actionError = document.createElement('p');
  actionError.className = 'error card-error';
  actionError.id = `listing-error-${listing.poshmark_id}`;
  actionError.setAttribute('role', 'alert');
  actionError.hidden = true;
  const save = document.createElement('button');
  save.type = 'button';
  save.className = `card-action${state.saved_at ? ' selected' : ''}`;
  save.dataset.action = 'save';
  save.setAttribute('aria-describedby', actionError.id);
  save.textContent = state.saved_at ? 'Saved' : 'Save';
  save.setAttribute('aria-pressed', String(Boolean(state.saved_at)));
  save.addEventListener('click', async () => {
    if (save.getAttribute('aria-disabled') === 'true' || hide.getAttribute('aria-disabled') === 'true') return;
    setPending(save, true);
    showError(actionError, '');
    try {
      await saveState(listing.poshmark_id, { saved_at: stateFor(listing.poshmark_id).saved_at ? null : new Date().toISOString() });
      const saved = Boolean(stateFor(listing.poshmark_id).saved_at);
      save.textContent = saved ? 'Saved' : 'Save';
      save.classList.toggle('selected', saved);
      save.setAttribute('aria-pressed', String(saved));
      elements['action-status'].textContent = saved ? 'Item saved.' : 'Item removed from Saved.';
      if (currentView === 'saved' && !saved) focusAfterRemoval(article, 'save');
      else updateCounts();
    } catch {
      showError(actionError, 'The item could not be saved. Check your connection and try Save again.');
    } finally {
      setPending(save, false);
    }
  });
  const hide = document.createElement('button');
  hide.type = 'button';
  hide.className = 'card-action';
  hide.dataset.action = 'hide';
  hide.setAttribute('aria-describedby', actionError.id);
  hide.textContent = 'Hide';
  hide.addEventListener('click', async () => {
    if (hide.getAttribute('aria-disabled') === 'true' || save.getAttribute('aria-disabled') === 'true') return;
    setPending(hide, true);
    showError(actionError, '');
    try {
      const previous = stateFor(listing.poshmark_id).hidden_at || null;
      await saveState(listing.poshmark_id, { hidden_at: new Date().toISOString() });
      hiddenHistory.push({ id: listing.poshmark_id, previous });
      updateUndo();
      focusAfterRemoval(article, 'hide');
    } catch {
      showError(actionError, 'The item could not be hidden. Check your connection and try Hide again.');
    } finally {
      setPending(hide, false);
    }
  });
  actions.append(save, hide);
  article.append(link, meta, title, actions, actionError);
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
  elements['empty-action'].hidden = currentView !== 'saved';
  updateCounts();
}

async function signedImages(rows) {
  const paths = rows.map(row => row.cover_image_path).filter(Boolean);
  if (!paths.length) return new Map();
  const { data, error } = await supabase.storage.from('listing-images').createSignedUrls(paths, 3600);
  if (error) throw error;
  return new Map(data.filter(item => item.signedUrl).map(item => [item.path, item.signedUrl]));
}

async function loadFeed() {
  if (elements.reload.getAttribute('aria-disabled') === 'true') return;
  const retryHadFocus = document.activeElement === elements['retry-feed'];
  setPending(elements.reload, true);
  setPending(elements['retry-feed'], true);
  showError(elements.error, '');
  elements['feed-error'].hidden = true;
  elements.empty.hidden = true;
  elements.loading.hidden = false;
  elements.grid.setAttribute('aria-busy', 'true');
  elements.summary.textContent = 'Refreshing your collected listings…';
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
    collectionSummary = ` from ${batchResult.data?.listing_count ?? listingResult.data.length} collected${updated ? ` · Updated ${updated}` : ''}`;
    renderListings();
  } catch {
    elements.summary.textContent = listings.length ? 'Refresh failed. Showing the previously loaded picks.' : 'Your feed could not be loaded.';
    elements['feed-error-message'].textContent = 'Check your connection, then select Try again to reload your collected listings.';
    elements['feed-error'].hidden = false;
  } finally {
    elements.loading.hidden = true;
    elements.grid.setAttribute('aria-busy', 'false');
    setPending(elements.reload, false);
    setPending(elements['retry-feed'], false);
    if (retryHadFocus && elements['feed-error'].hidden) elements.reload.focus();
  }
}

async function showSession(nextSession) {
  const changedAccount = session !== undefined && session?.user.id !== nextSession?.user.id;
  session = nextSession;
  elements.auth.hidden = Boolean(session);
  elements.feed.hidden = !session;
  document.title = session ? `${currentView === 'saved' ? 'Saved' : 'All picks'} · Poshmark picks` : 'Sign in · Poshmark picks';
  if (session) {
    if (changedAccount) elements['feed-title'].focus();
    await loadFeed();
  }
  else {
    elements.grid.replaceChildren();
    listings = [];
    listingState.clear();
    hiddenHistory.length = 0;
    updateUndo();
    viewObserver.disconnect();
    pendingViewed.clear();
    clearTimeout(viewedTimer);
    if (changedAccount) document.getElementById('email').focus();
  }
}

elements['sign-in-form'].addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  if (submit.getAttribute('aria-disabled') === 'true') return;
  setPending(submit, true);
  submit.textContent = 'Signing in…';
  showError(elements['auth-error'], '');
  const form = new FormData(event.currentTarget);
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: form.get('email').trim(), password: form.get('password') });
    if (error) {
      const invalidCredentials = error.code === 'invalid_credentials';
      showError(elements['auth-error'], invalidCredentials ? 'Check your email and password, then try Sign in again.' : 'Sign-in failed. Check your connection and try again.');
      if (invalidCredentials) {
        for (const id of ['email', 'password']) document.getElementById(id).setAttribute('aria-invalid', 'true');
        document.getElementById('email').focus();
      }
    }
  } catch {
    showError(elements['auth-error'], 'Sign-in failed. Check your connection and try again.');
  } finally {
    setPending(submit, false);
    submit.textContent = 'Sign in';
  }
});

elements['sign-in-form'].addEventListener('input', event => event.target.removeAttribute('aria-invalid'));
elements['retry-feed'].addEventListener('click', loadFeed);
elements['empty-action'].addEventListener('click', () => {
  viewButtons.find(button => button.dataset.view === 'all').click();
  viewButtons.find(button => button.dataset.view === 'all').focus();
});
elements['undo-hide'].addEventListener('click', async () => {
  const button = elements['undo-hide'];
  if (button.getAttribute('aria-disabled') === 'true' || !hiddenHistory.length) return;
  const hidden = hiddenHistory.at(-1);
  setPending(button, true);
  showError(elements.error, '');
  try {
    await saveState(hidden.id, { hidden_at: hidden.previous });
    hiddenHistory.splice(hiddenHistory.indexOf(hidden), 1);
    renderListings();
    updateUndo();
    elements['action-status'].textContent = 'Hidden item restored.';
    if (!hiddenHistory.length) {
      const restored = [...elements.grid.children].find(item => item.dataset.id === hidden.id);
      (restored?.querySelector('[data-action="save"]') || viewButtons.find(item => item.dataset.view === currentView)).focus();
    }
  } catch {
    elements['undo-message'].textContent = 'Restore failed. Check your connection and try Undo Hide again.';
  } finally {
    setPending(button, false);
  }
});

elements.reload.addEventListener('click', loadFeed);
elements['sign-out'].addEventListener('click', async () => {
  const button = elements['sign-out'];
  if (button.getAttribute('aria-disabled') === 'true') return;
  setPending(button, true);
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch {
    showError(elements.error, 'Sign-out failed. Check your connection and try Sign out again.');
  } finally {
    setPending(button, false);
  }
});
viewButtons.forEach(button => button.addEventListener('click', () => {
  currentView = button.dataset.view;
  document.title = `${currentView === 'saved' ? 'Saved' : 'All picks'} · Poshmark picks`;
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
  showError(elements['auth-error'], 'Sign-in is unavailable. Contact the app owner to restore access.');
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
