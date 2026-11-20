-- 여행 사진 앨범 + 자동 분류 (Gemini). Additive only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trip-photos',
  'trip-photos',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- path: {tripId}/{userId}/{uuid}.ext
drop policy if exists "trip_photos_storage_select" on storage.objects;
create policy "trip_photos_storage_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'trip-photos'
    and public.is_trip_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "trip_photos_storage_insert" on storage.objects;
create policy "trip_photos_storage_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'trip-photos'
    and (select auth.uid())::text = (storage.foldername(name))[2]
    and public.is_trip_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "trip_photos_storage_delete" on storage.objects;
create policy "trip_photos_storage_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'trip-photos'
    and (
      (select auth.uid())::text = (storage.foldername(name))[2]
      or public.is_trip_owner(((storage.foldername(name))[1])::uuid)
    )
  );

create table if not exists public.trip_photos (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'failed')),
  scene text
    check (scene is null or scene in ('person', 'landscape', 'food', 'other')),
  person_keys text[] not null default '{}'::text[],
  error text,
  created_at timestamptz not null default now(),
  unique (trip_id, storage_path)
);

create index if not exists trip_photos_trip_created_idx
  on public.trip_photos (trip_id, created_at desc);

create index if not exists trip_photos_trip_status_idx
  on public.trip_photos (trip_id, status);

alter table public.trip_photos enable row level security;

drop policy if exists "trip_photos_select_member" on public.trip_photos;
create policy "trip_photos_select_member"
  on public.trip_photos for select
  to authenticated
  using (public.is_trip_member(trip_id));

drop policy if exists "trip_photos_insert_member" on public.trip_photos;
create policy "trip_photos_insert_member"
  on public.trip_photos for insert
  to authenticated
  with check (
    public.is_trip_member(trip_id)
    and uploaded_by = (select auth.uid())
  );

drop policy if exists "trip_photos_update_member" on public.trip_photos;
create policy "trip_photos_update_member"
  on public.trip_photos for update
  to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

drop policy if exists "trip_photos_delete_own" on public.trip_photos;
create policy "trip_photos_delete_own"
  on public.trip_photos for delete
  to authenticated
  using (
    uploaded_by = (select auth.uid())
    or public.is_trip_owner(trip_id)
  );
