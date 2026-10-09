const { waitUntil } = require('@vercel/functions');
const { cloudClient, authorize, claimBatch, runBatch } = require('../lib/cloud-collection.cjs');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ detail: 'Use POST to start collection.' });
  try {
    const { config, db } = cloudClient();
    if (!await authorize(db, config.ownerId, req.headers.authorization)) return res.status(401).json({ detail: 'Sign in to the owner account, then try again.' });
    const batchId = await claimBatch(db, config.ownerId);
    if (!batchId) return res.status(409).json({ detail: 'A collection is already running.' });
    waitUntil(runBatch(db, batchId));
    return res.status(202).json({ batchId, detail: 'Collecting new picks. You can keep browsing.' });
  } catch {
    return res.status(503).json({ detail: 'Collection could not start. Check the cloud worker configuration, then try again.' });
  }
};
