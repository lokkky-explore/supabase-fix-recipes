# Signed-In Users Can See Object in GraphQL Schema

**Risk:** Anyone who signs up, even with a throwaway account, can list the names and columns of your tables and views through the GraphQL address.

## What it means

This is a WARN in Supabase’s own Security Advisor (lint 0027_pg_graphql_authenticated_table_exposed). It is the signed-in twin of lint 0026 and only appears when the pg_graphql extension is installed.

The GraphQL address at /graphql/v1 lists what the caller’s role can select. Every logged-in user gets the authenticated role, and if signup is open, that is anyone with an email address. A table the authenticated role can select is listed with its columns and relationships, even when Row Level Security hides every row.

Supabase says most findings are usually intentional, because most app tables must be readable by logged-in users. The lint is informational. The ones to act on are internal tables that no user should discover.

## Check it yourself

Run this in the Supabase SQL editor. Each row is a table, view, materialized view or foreign table that the authenticated role can select at least one column of, while pg_graphql is installed. Supabase’s own schemas are left out.

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
      and has_column_privilege('authenticated', c.oid, a.attnum, 'select')
  )
  and n.nspname not in (
    'auth', 'cron', 'extensions', 'graphql', 'graphql_public', 'information_schema',
    'net', 'pg_catalog', 'pgbouncer', 'pgmq', 'pgsodium', 'realtime', 'storage',
    'supabase_functions', 'supabase_migrations', 'vault'
  )
order by 1, 2;
```

## The fix

1. If your app does not use the GraphQL address, Supabase’s simplest fix is to remove the extension. Look in your code and in the browser’s network tab for requests to /graphql/v1 first. The same step clears lint 0026.

   ```sql
   drop extension pg_graphql;
   ```

2. Otherwise go through the list one table at a time. Where signed-in users should not discover a table, take it away from both roles and from the built-in public group.

   ```sql
   revoke all on public.internal_api_keys from authenticated, anon, public;
   ```

3. Where logged-in users do need a table, leave its grant in place and accept the finding for that table. Do not revoke from authenticated across the board without a list of what the app needs.

4. If you prefer an allowlist, hide everything from both roles, stop new tables being granted automatically, and give back only what the app needs. Keep your Row Level Security rules on those tables.

   ```sql
   revoke all on all tables in schema public from anon, authenticated;
   
   alter default privileges in schema public
     revoke select on tables from anon, authenticated;
   
   grant select on public.profiles to authenticated;
   grant select, insert on public.orders to authenticated;
   ```

5. Repeat the check above. Each row left should be a table you chose to keep visible. Then refresh the Security Advisor and run your scanner again.

## What can break

Unlike lint 0026, you cannot revoke from authenticated across the board, because the app almost certainly reads tables as a logged-in user. The all-tables revoke breaks every screen until each needed table is granted back, so list them first and test on a branch or a copy. Hiding a table also hides it from your own signed-in code, not only from outsiders.

> Table, column and bucket names are examples. This is general guidance for one finding; it does not make an app safe on its own. Back up before changing a live database.

Explained with the same content at https://lokandco.com/fix/supabase-graphql-authenticated-table-exposed
