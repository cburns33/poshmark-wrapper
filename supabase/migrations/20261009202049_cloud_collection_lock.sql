create unique index collection_batches_one_active_per_owner
  on public.collection_batches (owner_id)
  where status = 'collecting';
