# Extension in Public

**Risk:** An extension’s own tables and functions show up in your project’s public API, where they were never meant to be.

## What it means

This is a WARN in Supabase’s own Security Advisor (lint 0014_extension_in_public), so you may see it in your dashboard or email before any scanner reports it.

Postgres extensions add extra tables, functions and types to the database. When an extension is installed in the public schema, those extras sit next to your own tables, and Supabase serves the public schema through its API.

Supabase’s own wording is that this clutters your API and can expose functionality you did not intend to offer. It is a tidiness and exposure issue, not proof that anything has been taken. AI app builders hit it because a plain create extension command puts the extension in public.

## Check it yourself

Run this in the Supabase SQL editor. Each row is an extension installed in the public schema. The built-in plpgsql is left out, as Supabase’s own check does.

```sql
select e.extname as extension, e.extversion as version
from pg_extension e
where e.extnamespace::regnamespace::text = 'public'
  and e.extname <> 'plpgsql'
order by 1;
```

## The fix

1. Move each extension listed to the extensions schema, which Supabase projects normally have. Use the name from the check above. This example moves ltree.

   ```sql
   alter extension ltree set schema extensions;
   ```

2. Supabase puts the extensions schema on the default search path, so app code and queries that call the extension’s functions by their plain name keep working. Search for two things that do not: calls written with public. in front, and your own functions that set their own search_path (for example to '' or to public only). Give those the new schema in front, for example extensions.some_function().

3. Run the check again. It should return no rows. Then test the feature that uses the extension once, refresh the Security Advisor and run your scanner again.

## What can break

Most code keeps working, because the extensions schema is on Supabase’s default search path. What stops working is code that names public. in front of the extension’s functions, and your own functions with a fixed or empty search_path; those fail with errors such as “function does not exist”. Some extensions cannot be moved at all, and Postgres then refuses the command with an error and changes nothing. Do one extension at a time, on a branch or a copy first.

## Undo it

Move it back with `alter extension ltree set schema public;`. The step 3 check is the confirmation: it should return no rows after the fix.

> Table, column and bucket names are examples. This is general guidance for one finding; it does not make an app safe on its own. Back up before changing a live database.

Explained with the same content at https://lokandco.com/fix/supabase-extension-in-public
