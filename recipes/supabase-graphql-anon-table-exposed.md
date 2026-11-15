# Public Can See Object in GraphQL Schema

**Risk:** Anyone with your public key can list the names and columns of your tables and views through the GraphQL address, even where Row Level Security hides the rows.

## What it means

This is a WARN in Supabase’s own Security Advisor (lint 0026_pg_graphql_anon_table_exposed). It only appears when the pg_graphql extension is installed.

Supabase publishes a GraphQL address at /graphql/v1. What it shows depends on what the caller’s role is allowed to select. If the anon role (anyone with your public key) can select any column of a table, that table’s name, columns and relationships are listed. Row Level Security protects rows, not this listing.

Supabase calls the lint informational. For a public product list the listing may be fine. The ones to look at are tables whose names or columns you would rather not advertise.

## Check it yourself

Run this in the Supabase SQL editor. Each row is a table, view, materialized view or foreign table that the anon role can select at least one column of, while pg_graphql is installed. Supabase’s own schemas are left out.

```sql
select n.nspname as schema,
       c.relname as object,
       case c.relkind when 'r' then 'table' when 'v' then 'view'
                      when 'm' then 'materialized view' when 'f' then 'foreign table' end as kind
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'v', 'm', 'f')
  and exists (select 1 from pg_extension where extname = 'pg_graphql')
  and exists (
    select 1 from pg_attribute a
    where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('anon', c.oid, a.attnum, 'select')
  )
  and n.nspname not in (
    'auth', 'cron', 'extensions', 'graphql', 'graphql_public', 'information_schema',
    'net', 'pg_catalog', 'pgbouncer', 'pgmq', 'pgsodium', 'realtime', 'storage',
    'supabase_functions', 'supabase_migrations', 'vault'
  )
order by 1, 2;
```

## The fix

1. If your app does not use the GraphQL address, Supabase’s simplest fix is to remove the extension. Look in your code and in the browser’s network tab for requests to /graphql/v1 first. The same step clears the signed-in version of this finding, lint 0027.

   ```sql
   drop extension pg_graphql;
   ```

2. If you do use GraphQL, hide each table that should not be listed to the public.

   ```sql
   revoke all on public.internal_api_keys from anon;
   ```

3. To hide everything from the public in one go, and stop new tables being granted automatically, use these two commands. Then give logged-in users back only what the app needs. Rows are still protected by your Row Level Security rules, so keep those.

   ```sql
   revoke all on all tables in schema public from anon;

   alter default privileges in schema public
     revoke all on tables from anon;

   grant select on public.profiles to authenticated;
   grant select, insert on public.orders to authenticated;
   ```

4. Repeat the check above. Rows left are tables the public can still list; keep them only where that is intended. Signed-in users may still see the same tables until you also deal with lint 0027, so fix both together. Then refresh the Security Advisor and run your scanner again.

## What can break

Any page that shows data to visitors who are not logged in goes blank once the public loses select on its table, so keep the grants for genuinely public tables such as a product list. Dropping the extension ends the GraphQL address for everyone. Revoking from anon alone hides nothing from signed-up users, which is why lint 0027 exists.

## Undo it

To restore a grant, run `grant select on public.some_table to anon;` for each table that stopped working. To restore the old default for new tables, run `alter default privileges in schema public grant select on tables to anon;`. Dropping the extension can be undone with `create extension pg_graphql;`, but run the revokes in step 3 from a saved list of grants (take it before you change anything) so you can put back what you removed. To confirm the fix, run the check again.

> Table, column and bucket names are examples. This is general guidance for one finding; it does not make an app safe on its own. Back up before changing a live database.

Explained with the same content at https://lokandco.com/fix/supabase-graphql-anon-table-exposed
