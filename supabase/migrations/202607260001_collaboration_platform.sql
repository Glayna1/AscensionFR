-- AscensionFR collaborative platform
-- Supabase/PostgreSQL schema, permissions and transactional workflows.

create extension if not exists pgcrypto;

create type public.app_role as enum ('user', 'contributor', 'reviewer', 'developer', 'admin');
create type public.translation_entry_status as enum ('untranslated', 'claimed', 'submitted', 'review', 'approved', 'integrated', 'ignored');
create type public.translation_submission_status as enum ('pending', 'approved', 'rejected', 'changes_requested');
create type public.addon_status as enum ('draft', 'pending', 'approved', 'rejected', 'suspended');

create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text,
    avatar_url text,
    role public.app_role not null default 'user',
    contributions_count integer not null default 0 check (contributions_count >= 0),
    approved_count integer not null default 0 check (approved_count >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.translation_entries (
    id uuid primary key default gen_random_uuid(),
    source_type text not null,
    source_id text,
    original_text text not null check (length(original_text) between 1 and 8192),
    context jsonb not null default '{}'::jsonb,
    fingerprint text not null unique,
    status public.translation_entry_status not null default 'untranslated',
    discovered_count bigint not null default 1 check (discovered_count > 0),
    approved_submission_id uuid,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.translation_submissions (
    id uuid primary key default gen_random_uuid(),
    entry_id uuid not null references public.translation_entries(id) on delete cascade,
    author_id uuid not null references public.profiles(id) on delete cascade,
    translation text not null check (length(translation) between 1 and 8192),
    status public.translation_submission_status not null default 'pending',
    reviewer_id uuid references public.profiles(id),
    review_note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    reviewed_at timestamptz
);

alter table public.translation_entries
    add constraint translation_entries_approved_submission_fk
    foreign key (approved_submission_id)
    references public.translation_submissions(id)
    on delete set null;

create table public.translation_claims (
    entry_id uuid primary key references public.translation_entries(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    claimed_at timestamptz not null default now(),
    expires_at timestamptz not null,
    check (expires_at > claimed_at)
);

create table public.addons (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references public.profiles(id) on delete cascade,
    slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    name text not null check (length(name) between 1 and 100),
    description text not null check (length(description) between 1 and 4000),
    repository_url text not null,
    release_url text,
    addon_folder text not null check (addon_folder !~ '[\\/]'),
    version text,
    license text,
    category text,
    status public.addon_status not null default 'draft',
    reviewer_id uuid references public.profiles(id),
    review_note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    published_at timestamptz
);

create table public.addon_media (
    id uuid primary key default gen_random_uuid(),
    addon_id uuid not null references public.addons(id) on delete cascade,
    storage_path text not null,
    media_type text not null check (media_type in ('icon', 'screenshot')),
    sort_order integer not null default 0
);

create index translation_entries_status_idx on public.translation_entries(status);
create index translation_entries_source_idx on public.translation_entries(source_type, source_id);
create index translation_submissions_entry_idx on public.translation_submissions(entry_id);
create index translation_submissions_status_idx on public.translation_submissions(status);
create index translation_submissions_author_idx on public.translation_submissions(author_id);
create index addons_status_idx on public.addons(status);
create index addons_owner_idx on public.addons(owner_id);

create or replace function public.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = public, auth
as $$
    select coalesce((select role from public.profiles where id = auth.uid()), 'user'::public.app_role);
$$;

revoke all on function public.current_role() from public;
grant execute on function public.current_role() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, display_name)
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1))
    );
    return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Role changes are intentionally NOT available through direct table UPDATE.
-- Only an admin can call this function. service_role may also call it server-side.
create or replace function public.set_user_role(p_user_id uuid, p_role public.app_role)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
    if auth.role() <> 'service_role' and public.current_role() <> 'admin' then
        raise exception 'not authorized';
    end if;

    update public.profiles
       set role = p_role, updated_at = now()
     where id = p_user_id;

    if not found then
        raise exception 'profile not found';
    end if;
end;
$$;

revoke all on function public.set_user_role(uuid, public.app_role) from public, anon, authenticated;
grant execute on function public.set_user_role(uuid, public.app_role) to authenticated, service_role;

-- Atomic claim: clears expired claim for this entry and obtains it if available.
create or replace function public.claim_translation(p_entry_id uuid, p_minutes integer default 20)
returns public.translation_claims
language plpgsql
security definer
set search_path = public, auth
as $$
declare
    v_claim public.translation_claims;
begin
    if public.current_role() not in ('contributor', 'reviewer', 'admin') then
        raise exception 'not authorized';
    end if;
    if p_minutes < 5 or p_minutes > 120 then
        raise exception 'invalid claim duration';
    end if;

    delete from public.translation_claims
     where entry_id = p_entry_id and expires_at <= now();

    insert into public.translation_claims(entry_id, user_id, expires_at)
    values (p_entry_id, auth.uid(), now() + make_interval(mins => p_minutes))
    on conflict (entry_id) do nothing
    returning * into v_claim;

    if v_claim.entry_id is null then
        raise exception 'entry already claimed';
    end if;

    update public.translation_entries
       set status = 'claimed', updated_at = now()
     where id = p_entry_id and status = 'untranslated';

    return v_claim;
end;
$$;

revoke all on function public.claim_translation(uuid, integer) from public, anon;
grant execute on function public.claim_translation(uuid, integer) to authenticated;

-- Transactional submission: verifies ownership of an active claim and updates entry state.
create or replace function public.submit_translation(p_entry_id uuid, p_translation text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
    v_id uuid;
begin
    if public.current_role() not in ('contributor', 'reviewer', 'admin') then
        raise exception 'not authorized';
    end if;
    p_translation := btrim(p_translation);
    if length(p_translation) < 1 or length(p_translation) > 8192 then
        raise exception 'invalid translation';
    end if;

    if not exists (
        select 1 from public.translation_claims
        where entry_id = p_entry_id and user_id = auth.uid() and expires_at > now()
    ) then
        raise exception 'active claim required';
    end if;

    insert into public.translation_submissions(entry_id, author_id, translation)
    values (p_entry_id, auth.uid(), p_translation)
    returning id into v_id;

    delete from public.translation_claims where entry_id = p_entry_id and user_id = auth.uid();
    update public.translation_entries set status = 'review', updated_at = now() where id = p_entry_id;
    update public.profiles set contributions_count = contributions_count + 1, updated_at = now() where id = auth.uid();

    return v_id;
end;
$$;

revoke all on function public.submit_translation(uuid, text) from public, anon;
grant execute on function public.submit_translation(uuid, text) to authenticated;

-- Transactional review: submission and entry can never disagree after approval.
create or replace function public.review_translation(
    p_submission_id uuid,
    p_decision public.translation_submission_status,
    p_note text default null,
    p_corrected_translation text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
    v_entry_id uuid;
    v_author_id uuid;
begin
    if public.current_role() not in ('reviewer', 'admin') then
        raise exception 'not authorized';
    end if;
    if p_decision not in ('approved', 'rejected', 'changes_requested') then
        raise exception 'invalid decision';
    end if;

    select entry_id, author_id into v_entry_id, v_author_id
      from public.translation_submissions
     where id = p_submission_id and status = 'pending'
     for update;

    if v_entry_id is null then
        raise exception 'pending submission not found';
    end if;

    update public.translation_submissions
       set status = p_decision,
           translation = coalesce(nullif(btrim(p_corrected_translation), ''), translation),
           reviewer_id = auth.uid(),
           review_note = p_note,
           reviewed_at = now(),
           updated_at = now()
     where id = p_submission_id;

    if p_decision = 'approved' then
        update public.translation_entries
           set status = 'approved', approved_submission_id = p_submission_id, updated_at = now()
         where id = v_entry_id;
        update public.profiles
           set approved_count = approved_count + 1, updated_at = now()
         where id = v_author_id;
    elsif p_decision = 'changes_requested' then
        update public.translation_entries set status = 'submitted', updated_at = now() where id = v_entry_id;
    else
        update public.translation_entries set status = 'untranslated', updated_at = now() where id = v_entry_id;
    end if;
end;
$$;

revoke all on function public.review_translation(uuid, public.translation_submission_status, text, text) from public, anon;
grant execute on function public.review_translation(uuid, public.translation_submission_status, text, text) to authenticated;

alter table public.profiles enable row level security;
alter table public.translation_entries enable row level security;
alter table public.translation_submissions enable row level security;
alter table public.translation_claims enable row level security;
alter table public.addons enable row level security;
alter table public.addon_media enable row level security;

create policy profiles_read_self_or_staff on public.profiles
for select to authenticated
using (id = auth.uid() or public.current_role() in ('reviewer', 'admin'));

create policy profiles_update_self_safe_fields on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Column grants prevent a user from changing role/counters even though profile self-update is allowed.
revoke update on public.profiles from authenticated;
grant update(display_name, avatar_url, updated_at) on public.profiles to authenticated;
grant select on public.profiles to authenticated;

create policy entries_read_contributors on public.translation_entries
for select to authenticated
using (public.current_role() in ('contributor', 'reviewer', 'admin'));

create policy submissions_read_own_or_reviewers on public.translation_submissions
for select to authenticated
using (author_id = auth.uid() or public.current_role() in ('reviewer', 'admin'));

create policy claims_read_own_or_reviewers on public.translation_claims
for select to authenticated
using (user_id = auth.uid() or public.current_role() in ('reviewer', 'admin'));

create policy addons_read_published_or_owner on public.addons
for select to authenticated
using (status = 'approved' or owner_id = auth.uid() or public.current_role() in ('reviewer', 'admin'));

create policy addons_insert_developers on public.addons
for insert to authenticated
with check (owner_id = auth.uid() and public.current_role() in ('developer', 'admin'));

create policy addons_update_owner_draft on public.addons
for update to authenticated
using (owner_id = auth.uid() and status in ('draft', 'rejected') and public.current_role() in ('developer', 'admin'))
with check (owner_id = auth.uid());

create policy addon_media_read_for_visible_addon on public.addon_media
for select to authenticated
using (exists (select 1 from public.addons a where a.id = addon_id));

-- Public/anonymous discovery ingestion is intentionally absent from table policies.
-- It must go through the Edge Function in supabase/functions/submit-discovery.
