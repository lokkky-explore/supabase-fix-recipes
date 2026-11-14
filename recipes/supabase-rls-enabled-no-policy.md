# RLS Enabled No Policy

**Risk:** No outsider can read the table, but your own app cannot either, so a feature is probably broken or about to break.

## What it means

This is an INFO in Supabase’s own Security Advisor (lint 0008_rls_enabled_no_policy). It is the safe way round: Row Level Security is on, and with no rules written, the public API returns nothing from the table and accepts no writes.

It usually means an AI builder turned RLS on and never added the rules, or the rules were dropped later. Lists come back empty and saves fail.

Sometimes it is on purpose: a table that only your server touches, using the secret key, needs no rules. In that case say so in writing, as the second step shows.

## Check it yourself

Run this in the Supabase SQL editor. Each row is a table with RLS on and no rules at all.

```sql
select c.relname as table_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity
  and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
order by 1;
```

## The fix

1. Decide for each table: should logged-in users reach it from the browser? If yes, add rules. This set lets a user work with their own rows only. It assumes the table has a user_id column that holds the owner’s id.

   ```sql
   create policy "read own rows" on public.notes
     for select to authenticated
     using ((select auth.uid()) = user_id);
   
   create policy "insert own rows" on public.notes
     for insert to authenticated
     with check ((select auth.uid()) = user_id);
   ```

2. If only your server should touch the table, add a rule that says no. It changes nothing in behaviour, and it tells the next person (and the advisor) that the lock is deliberate.

   ```sql
   create policy "no direct access" on public.internal_jobs
     for select using (false);
   ```

3. Log in as a test user, open the screen that uses each table, and confirm it loads and saves. Then run your scanner again.

## What can break

Adding a rule that is too wide can undo the lock. Do not paste in a rule that allows everything just to make the warning go away: that trades this finding for a worse one. Tables with no user_id column, shared team data and admin screens each need a different rule.

> Table, column and bucket names are examples. This is general guidance for one finding; it does not make an app safe on its own. Back up before changing a live database.

Explained with the same content at https://lokandco.com/fix/supabase-rls-enabled-no-policy
