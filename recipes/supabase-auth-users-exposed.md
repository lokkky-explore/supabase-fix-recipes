# Exposed Auth Users

**Risk:** Anyone with your public key can read the sign-up details of every user through a view that points at the private user table.

## What it means

This is an ERROR in Supabase’s own Security Advisor (lint 0002_auth_users_exposed), so you may see it in your dashboard before any scanner reports it.

Supabase keeps your users, with their emails, in a private table called auth.users. A view in the public schema that reads from it is served by your project’s API, so it can hand those records to anyone who asks the view.

AI app builders create views like these to show a user list or a profile page, often by reading auth.users directly.

## Check it yourself

Run this in the Supabase SQL editor. Each row is a view in the public schema whose definition mentions auth.users.

```sql
select schemaname, viewname
from pg_views
where schemaname = 'public'
  and definition ilike '%auth.users%'
order by 1, 2;
```

## The fix

1. Make a profiles table in the public schema that holds only what the app needs to show, and lock it with Row Level Security.

   ```sql
   create table public.profiles (
     id uuid primary key references auth.users (id) on delete cascade,
     display_name text
   );

   alter table public.profiles enable row level security;

   create policy "read own profile" on public.profiles
     for select to authenticated
     using ((select auth.uid()) = id);
   ```

2. Fill it automatically for every new user, and copy in the users you already have.

   ```sql
   create function public.handle_new_user()
   returns trigger
   language plpgsql
   security definer
   set search_path = ''
   as $$
   begin
     insert into public.profiles (id, display_name)
     values (new.id, new.raw_user_meta_data ->> 'display_name');
     return new;
   end;
   $$;

   revoke execute on function public.handle_new_user() from anon, authenticated, public;

   create trigger on_auth_user_created
     after insert on auth.users
     for each row execute function public.handle_new_user();

   insert into public.profiles (id, display_name)
   select id, raw_user_meta_data ->> 'display_name' from auth.users
   on conflict do nothing;
   ```

3. Point the app at public.profiles, then remove the old view.

   ```sql
   drop view public.user_list;
   ```

4. Open the old view’s address with only the public key. It should now fail. Then refresh the Security Advisor and run your scanner again.

## What can break

Screens that read the old view stop working the moment it is dropped, so switch the app first. Use the display name only for showing, never for deciding who is an admin: users can edit that field themselves. Do not copy emails or other personal details into the profiles table unless the app truly shows them.

## Undo it

Save the old view’s definition before you drop it (`select pg_get_viewdef('public.user_list'::regclass);`), so you can recreate it if you must. Recreating it brings the exposure back, so prefer fixing the app. To remove the new pieces, run `drop trigger on_auth_user_created on auth.users;`, `drop function public.handle_new_user();` and `drop table public.profiles;`. Drop the trigger first: a trigger that fails stops new sign-ups. To confirm the fix, run the check again: it should return no rows.

> Table, column and bucket names are examples. This is general guidance for one finding; it does not make an app safe on its own. Back up before changing a live database.

Explained with the same content at https://lokandco.com/fix/supabase-auth-users-exposed
