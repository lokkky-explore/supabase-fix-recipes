# Function Search Path Mutable

**Risk:** A database function can quietly pick up a look-alike table or function planted by someone else, and then run it with the function’s own permissions.

## What it means

This is a WARN in Supabase’s own Security Advisor (lint 0011_function_search_path_mutable), so you may see it in your dashboard or email before any scanner reports it.

When a function mentions a table or another function by its bare name, Postgres looks the name up through a list of schemas called the search_path. If the function does not fix that list, the result can change depending on who calls it and what they have set up.

That matters most for functions that run with their owner’s permissions or that fire from triggers. AI app builders write many of these and rarely fix the search_path.

## Check it yourself

Run this in the Supabase SQL editor. It lists functions in the public schema that have no fixed search_path. Functions that belong to an installed extension can show up too; leave those alone.

```sql
select p.proname as function, pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f'
  and not exists (
    select 1 from unnest(coalesce(p.proconfig, '{}')) as setting
    where setting like 'search_path=%'
  )
order by 1;
```

## The fix

1. Fix the search_path on each function listed. An empty value means the function can only see built-in names, unless you write the schema in front.

   ```sql
   alter function public.note_count(uuid) set search_path = '';
   ```

2. Then open the function body and put the schema in front of every table and function it uses, so nothing depends on the search_path. Here is the same idea written out in full.

   ```sql
   create or replace function public.note_count(owner_id uuid)
   returns bigint
   language sql
   stable
   set search_path = ''
   as $$
     select count(*) from public.notes where user_id = owner_id;
   $$;
   ```

3. Functions that use something from an extension need that extension’s schema in front too, for example extensions.some_function(). Look for it in the function body.

4. Trigger the feature that uses each function once, then refresh the Security Advisor and run your scanner again.

## What can break

If the search_path is emptied but the function body still uses bare names, the function fails with errors such as “relation does not exist”, and anything that fires it (a trigger on insert, a sign-up flow) can start failing. Change one function at a time and test the feature that calls it.

> Table, column and bucket names are examples. This is general guidance for one finding; it does not make an app safe on its own. Back up before changing a live database.

Explained with the same content at https://lokandco.com/fix/supabase-function-search-path-mutable
