alter table public.listings add column seller_username text;
alter table public.collection_batches add column seller_username text;
alter table public.collection_batches add column seed_listing_id text;

create table public.seller_inventory (
  owner_id uuid not null references auth.users(id) on delete cascade,
  batch_id bigint not null references public.collection_batches(id) on delete cascade,
  poshmark_id text not null,
  source_position integer not null,
  primary key (owner_id, batch_id, poshmark_id),
  foreign key (owner_id, poshmark_id) references public.listings(owner_id, poshmark_id) on delete cascade
);
alter table public.seller_inventory enable row level security;
create policy "owners read seller inventory" on public.seller_inventory for select
  to authenticated using ((select auth.uid()) = owner_id);
grant select on public.seller_inventory to authenticated;
grant all on public.seller_inventory to service_role;
create index collection_batches_seller_latest on public.collection_batches(owner_id, seller_username, started_at desc)
  where source = 'poshmark_seller';
