# Security Definer View: view bypasses row-level security

**Risk:** Anyone with your public key can read every row the view shows, even when the tables underneath have Row Level Security turned on.

## What it means

This is an ERROR in Supabase’s own Security Advisor (lint 0010_security_definer_view), so you may see it in your dashboard before any scanner reports it.

A view is a saved query. By default Postgres runs it with the permissions of whoever created the view, and views made in the SQL editor or by an AI builder are created by a role that skips Row Level Security.

Views in the public schema are served by your project’s API. So a view over a protected table hands that table’s rows to anyone who asks the view instead of the table.

## Check it yourself

Run this in the Supabase SQL editor. Each row is a view whose options do not include security_invoker=true or security_invoker=on, so it runs with its creator’s permissions. After the fix it should no longer list that view.

```sql
select c.relname as view, c.reloptions as options
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
  and not coalesce(c.reloptions, '{}') && array['security_invoker=true', 'security_invoker=on']
order by 1;
```

## The fix

1. Switch the view to run with the permissions of the person asking. From then on the Row Level Security rules on the tables underneath apply to it.

   ```sql
   alter view public.order_summary set (security_invoker = true);
   ```

2. Make sure each table the view reads has Row Level Security on and a read rule for the users who need the view. Without one, the view comes back empty for them.

   ```sql
   alter table public.orders enable row level security;

   create policy "read own orders" on public.orders
     for select to authenticated
     using ((select auth.uid()) = user_id);
   ```

3. If nobody outside your own server should read the view at all, take it away from the public roles as well.

   ```sql
   revoke select on public.order_summary from anon, authenticated;
   ```

4. Log in as two different test users and open the screen that uses the view. Each should see only their own rows. Then refresh the Security Advisor and run your scanner again.

## What can break

Once the view checks the caller’s permissions, screens that used it can come back empty or show “permission denied”. That happens when a table underneath has no read rule for that user, or sits in a schema they cannot use. A view built to show totals across all users, such as a public leaderboard, needs a different design, for example a function that returns only the totals. security_invoker needs Postgres 15 or later, which projects created since 2023 have.

## Undo it

To put the view back as it was, run `alter view public.order_summary set (security_invoker = false);`, and `grant select on public.order_summary to anon, authenticated;` if you revoked it in step 3. That reopens the problem, so use it only as a stop-gap. To confirm the fix, run the check again: the view should no longer be listed.

> Table, column and bucket names are examples. This is general guidance for one finding; it does not make an app safe on its own. Back up before changing a live database.

Explained with the same content at https://lokandco.com/fix/supabase-security-definer-view
