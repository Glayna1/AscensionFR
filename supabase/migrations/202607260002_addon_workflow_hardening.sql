-- Prevent addon owners from self-promoting status through direct UPDATE.

drop policy if exists addons_update_owner_draft on public.addons;

create policy addons_update_owner_draft on public.addons
for update to authenticated
using (
    owner_id = auth.uid()
    and status in ('draft', 'rejected')
    and public.current_role() in ('developer', 'admin')
)
with check (
    owner_id = auth.uid()
    and status in ('draft', 'rejected')
);

revoke update on public.addons from authenticated;
grant update(name, description, repository_url, release_url, addon_folder, version, license, category, updated_at)
    on public.addons to authenticated;

create or replace function public.submit_addon(p_addon_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
    if public.current_role() not in ('developer', 'admin') then
        raise exception 'not authorized';
    end if;

    update public.addons
       set status = 'pending', updated_at = now(), review_note = null
     where id = p_addon_id
       and owner_id = auth.uid()
       and status in ('draft', 'rejected');

    if not found then
        raise exception 'addon not found or not submittable';
    end if;
end;
$$;

revoke all on function public.submit_addon(uuid) from public, anon;
grant execute on function public.submit_addon(uuid) to authenticated;

create or replace function public.review_addon(
    p_addon_id uuid,
    p_approve boolean,
    p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
    if public.current_role() not in ('reviewer', 'admin') then
        raise exception 'not authorized';
    end if;

    update public.addons
       set status = case when p_approve then 'approved'::public.addon_status else 'rejected'::public.addon_status end,
           reviewer_id = auth.uid(),
           review_note = p_note,
           published_at = case when p_approve then coalesce(published_at, now()) else published_at end,
           updated_at = now()
     where id = p_addon_id and status = 'pending';

    if not found then
        raise exception 'pending addon not found';
    end if;
end;
$$;

revoke all on function public.review_addon(uuid, boolean, text) from public, anon;
grant execute on function public.review_addon(uuid, boolean, text) to authenticated;
