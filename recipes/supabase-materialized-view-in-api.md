# Materialized View in API

**Risk:** Anyone who can reach your API can read every row of that materialized view, because Row Level Security cannot be applied to it.

## What it means

This is a WARN in Supabase’s own Security Advisor (lint 0016_materialized_view_in_api), so you may see it in your dashboard before any scanner reports it.

A materialized view is a saved query whose results are stored like a table. Unlike a normal view, it cannot follow the Row Level Security rules of the tables it was built from, and it cannot be given rules of its own.

So if the public or logged-in roles can read it, every row is always visible to them. Supabase says this may not be what you intended. If the numbers in it are meant to be public, such as a total count, it can be fine. Check what is in it.

## Check it yourself

Run this in the Supabase SQL editor. Each row is a materialized view in the public schema that the anon role (anyone with your public key) or the authenticated role (any logged-in user) can read. If your project serves other schemas through the API, change the schema name.

```sql
select n.nspname as schema,
       c.relname as materialized_view,
       has_table_privilege('anon', c.oid, 'select') as anon_can_read,
       has_table_privilege('authenticated', c.oid, 'select') as signed_in_can_read
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'm'
  and n.nspname = 'public'
  and (has_table_privilege('anon', c.oid, 'select')
       or has_table_privilege('authenticated', c.oid, 'select'))
order by 1, 2;
```

## The fix

1. Take away read permission from the API roles. Supabase’s fix also names public, the built-in group that gives everyone default permissions, so include it.

   ```sql
   revoke select on public.sales_totals from public, anon, authenticated;
   ```

2. Check that it worked. This should return false.

   ```sql
   select has_table_privilege('anon', 'public.sales_totals'::regclass::oid, 'select');
   ```

3. If the app needs to show that data to users, do not hand the materialized view out directly. Keep it out of reach and let a server function or a database function that checks who is calling return only what that person may see. See the page on a foreign table in the API for the pattern Supabase describes.

4. Open the view’s address with only the public key. It should now be refused. Then refresh the Security Advisor and run your scanner again.

## What can break

Any screen that reads the materialized view with the public key or a user login stops working the moment the permission goes, and shows an error or an empty list. Revoking is blunt: it removes access for every user, so plan the replacement before you do it. The view itself and its data are not deleted.

> Table, column and bucket names are examples. This is general guidance for one finding; it does not make an app safe on its own. Back up before changing a live database.

Explained with the same content at https://lokandco.com/fix/supabase-materialized-view-in-api
