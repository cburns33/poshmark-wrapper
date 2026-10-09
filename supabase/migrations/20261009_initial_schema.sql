create table public.collection_batches (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'poshmark_suggested',
  status text not null check (status in ('collecting', 'complete', 'partial', 'needs_attention')),
  detail text not null default '',
  listing_count integer not null default 0 check (listing_count >= 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index collection_batches_owner_started_idx
  on public.collection_batches (owner_id, started_at desc);

create table public.listings (
  owner_id uuid not null references auth.users(id) on delete cascade,
  poshmark_id text not null,
  title text not null,
  brand text,
  asking_price_cents integer check (asking_price_cents >= 0),
  currency text,
  size text,
  listing_url text not null,
  cover_image_url text,
  cover_image_path text,
  availability text,
  source text not null default 'poshmark_suggested',
  source_position integer check (source_position >= 0),
  last_batch_id bigint references public.collection_batches(id) on delete set null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  primary key (owner_id, poshmark_id)
);

create index listings_owner_feed_idx
  on public.listings (owner_id, last_seen_at desc, source_position);

create index listings_last_batch_idx
  on public.listings (last_batch_id);

create table public.user_listing_state (
  owner_id uuid not null,
  poshmark_id text not null,
  saved_at timestamptz,
  hidden_at timestamptz,
  viewed_at timestamptz,
  opened_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (owner_id, poshmark_id),
  foreign key (owner_id, poshmark_id)
    references public.listings(owner_id, poshmark_id) on delete cascade
);

create table public.filter_rules (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  max_price_cents integer not null default 15000 check (max_price_cents >= 0),
  blocked_brands text[] not null default '{}',
  title_fallback boolean not null default true,
  rule_version integer not null default 1 check (rule_version > 0),
  updated_at timestamptz not null default now()
);

alter table public.collection_batches enable row level security;
alter table public.listings enable row level security;
alter table public.user_listing_state enable row level security;
alter table public.filter_rules enable row level security;

revoke all on table public.collection_batches from anon, authenticated;
revoke all on table public.listings from anon, authenticated;
revoke all on table public.user_listing_state from anon, authenticated;
revoke all on table public.filter_rules from anon, authenticated;

grant select on table public.collection_batches to authenticated;
grant select on table public.listings to authenticated;
grant select, insert, update, delete on table public.user_listing_state to authenticated;
grant select, insert, update, delete on table public.filter_rules to authenticated;

grant select, insert, update, delete on table public.collection_batches to service_role;
grant select, insert, update, delete on table public.listings to service_role;
grant select, insert, update, delete on table public.user_listing_state to service_role;
grant select, insert, update, delete on table public.filter_rules to service_role;
grant usage, select on sequence public.collection_batches_id_seq to service_role;

create policy "owners read collection batches"
  on public.collection_batches for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "owners read listings"
  on public.listings for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "owners read listing state"
  on public.user_listing_state for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "owners insert listing state"
  on public.user_listing_state for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "owners update listing state"
  on public.user_listing_state for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "owners delete listing state"
  on public.user_listing_state for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "owners read filter rules"
  on public.filter_rules for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "owners insert filter rules"
  on public.filter_rules for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "owners update filter rules"
  on public.filter_rules for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "owners delete filter rules"
  on public.filter_rules for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'listing-images',
  'listing-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

create policy "owners read listing images"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
