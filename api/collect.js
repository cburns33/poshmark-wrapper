const { waitUntil } = require('@vercel/functions');
const { cloudClient, authorize, claimBatch, runBatch } = require('../lib/cloud-collection.cjs');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ detail: 'Use POST to start collection.' });
  try {
    const { config, db } = cloudClient();
    if (!await authorize(db, config.ownerId, req.headers.authorization)) return res.status(401).json({ detail: 'Sign in to the owner account, then try again.' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    let listing;
    if (body.listingId !== undefined) {
      if (typeof body.listingId !== 'string' || !/^[a-f0-9]{24}$/.test(body.listingId)) return res.status(400).json({ detail: 'Choose a listing from your feed.' });
      const result = await db.from('listings').select('owner_id,poshmark_id,listing_url,seller_username').eq('owner_id', config.ownerId).eq('poshmark_id', body.listingId).single();
      if (result.error || !result.data) return res.status(404).json({ detail: 'This listing is no longer in your cache.' });
      listing = result.data;
      if (listing.seller_username && !body.refresh) {
        const cached = await db.from('collection_batches').select('id').eq('owner_id', config.ownerId).eq('source', 'poshmark_seller').eq('seller_username', listing.seller_username)
          .in('status', ['complete', 'partial']).gte('completed_at', new Date(Date.now() - 24 * 3600000).toISOString()).order('started_at', { ascending: false }).limit(1).maybeSingle();
        if (cached.error) throw cached.error;
        if (cached.data) return res.status(200).json({ batchId: cached.data.id, detail: 'Opening cached seller picks.' });
      }
    }
    const batchId = await claimBatch(db, config.ownerId, listing ? { source: 'poshmark_seller', seed_listing_id: listing.poshmark_id, seller_username: listing.seller_username } : {});
    if (!batchId) return res.status(409).json({ detail: 'A collection is already running.' });
    waitUntil(runBatch(db, batchId, process.env, listing));
    return res.status(202).json({ batchId, detail: 'Collecting new picks. You can keep browsing.' });
  } catch {
    return res.status(503).json({ detail: 'Collection could not start. Check the cloud worker configuration, then try again.' });
  }
};
