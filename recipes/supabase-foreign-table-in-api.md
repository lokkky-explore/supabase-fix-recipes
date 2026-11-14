# Foreign Table in API

**Risk:** Anyone who can reach your API can read every row of that foreign table, because Row Level Security cannot be applied to it.

## What it means

This is a WARN in Supabase’s own Security Advisor (lint 0017_foreign_table_in_api), so you may see it in your dashboard before any scanner reports it.

A foreign table is a window onto data that lives somewhere else, such as another database or a service, set up with a Foreign Data Wrapper. Unlike a normal table, it cannot follow Row Level Security rules.

If the public or logged-in roles can read it, every row is visible to them. Most apps do not use foreign tables. If yours has one, it is usually because an integration or an AI builder created it.

## Check it yourself

Run this in the Supabase SQL editor. Each row is a foreign table in the public schema that the anon role (anyone with your public key) or the authenticated role (any logged-in user) can read. If your project serves other schemas through the API, change the schema name.

```sql
select n.nspname as schema,
       c.relname as foreign_table,
       has_table_privilege('anon', c.oid, 'select') as anon_can_read,
       has_table_privilege('authenticated', c.oid, 'select') as signed_in_can_read
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'f'
  and n.nspname = 'public'
  and (has_table_privilege('anon', c.oid, 'select')
       or has_table_privilege('authenticated', c.oid, 'select'))
order by 1, 2;
```

## The fix

1. If the browser does not need this table, take away read permission from the API roles. Supabase’s fix also names public, the built-in group that gives everyone default permissions, so include it.

   ```sql
   revoke select on public.some_foreign_table from public, anon, authenticated;
   ```

2. Check that it worked. This should return false.

   ```sql
   select has_table_privilege('anon', 'public.some_foreign_table'::regclass::oid, 'select');
   ```

3. If the app does need the data, Supabase’s approach is to move the foreign table to a schema the API does not serve, then give the app a function that applies your own rule. This adapts Supabase’s example: the function returns only rows whose author_id matches the logged-in user. Do not add the private schema to the exposed schemas in your API settings.

   ```sql
   create schema if not exists private;
   
   alter foreign table public.some_foreign_table set schema private;
   
   grant usage on schema private to anon, authenticated;
   grant select on private.some_foreign_table to anon, authenticated;
   
   create or replace function public.my_foreign_rows()
   returns table (id integer, data text, author_id uuid)
   language sql
   set search_path = ''
   as $$
     select id, data, author_id
     from private.some_foreign_table
     where author_id = (select auth.uid());
   $$;
   ```

4. Open the table’s address with only the public key. It should now be refused. Then refresh the Security Advisor and run your scanner again.

## What can break

Screens that read the foreign table directly stop working once permission is taken away or the table is moved, and the app must call the function instead. The function’s own rule is the only protection, so a wrong rule leaks rows just as before. Test it as two different users. Moving the table also breaks any other object that refers to it by its old name.

> Table, column and bucket names are examples. This is general guidance for one finding; it does not make an app safe on its own. Back up before changing a live database.

Explained with the same content at https://lokandco.com/fix/supabase-foreign-table-in-api
