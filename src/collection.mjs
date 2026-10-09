export function collectionControls({ button, status, client, onComplete }) {
  let timer;
  let activeId;
  let generation = 0;

  function pending(value) {
    button.setAttribute('aria-disabled', String(value));
    button.setAttribute('aria-busy', String(value));
    button.textContent = value ? 'Collecting…' : 'Get new picks';
  }

  async function refresh() {
    clearTimeout(timer);
    const current = generation;
    const { data: { session } } = await client().auth.getSession();
    if (!session || current !== generation) return;
    const { data, error } = await client().from('collection_batches').select('id,status,detail,listing_count,started_at,completed_at').order('started_at', { ascending: false }).limit(1).maybeSingle();
    if (current !== generation) return;
    if (error) {
      pending(false);
      status.textContent = 'Could not check collection. Select Refresh to try again.';
      return;
    }
    const running = data?.status === 'collecting' && Date.now() - new Date(data.started_at).getTime() < 7 * 60000;
    pending(running);
    if (running) {
      activeId = data.id;
      status.textContent = 'Collecting new picks. You can keep browsing or close the app.';
      timer = setTimeout(() => refresh().catch(() => pending(false)), 5000);
    } else if (data?.status === 'needs_attention' || data?.status === 'collecting') {
      activeId = null;
      status.textContent = data.status === 'collecting' ? 'Collection timed out. Select Get new picks to try again.' : data.detail;
    } else if (activeId && data?.id === activeId) {
      activeId = null;
      status.textContent = `${data.listing_count} listings collected. Your feed is updating.`;
      await onComplete();
      if (current === generation) status.textContent = `${data.listing_count} listings collected. New picks are ready.`;
    }
  }

  button.addEventListener('click', async () => {
    if (button.getAttribute('aria-disabled') === 'true') return;
    pending(true);
    status.textContent = 'Starting collection…';
    try {
      const { data: { session } } = await client().auth.getSession();
      if (!session) throw new Error('Sign in, then try Get new picks again.');
      const response = await fetch('/api/collect', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } });
      const data = await response.json();
      if (!response.ok && response.status !== 409) throw new Error(data.detail || 'Collection could not start. Try again.');
      activeId = data.batchId;
      await refresh();
    } catch (error) {
      pending(false);
      status.textContent = error instanceof SyntaxError ? 'Collection is unavailable. Try again later.' : error.message;
    }
  });

  return { refresh, stop() { generation++; clearTimeout(timer); activeId = null; pending(false); status.textContent = ''; } };
}
