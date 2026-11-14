# Sensitive Columns Exposed

**Risk:** Anyone with your public key can read columns that look like passwords, card details or personal ID numbers, because the table has no Row Level Security.

## What it means

This is an ERROR in Supabase’s own Security Advisor (lint 0023_sensitive_columns_exposed). It looks for tables served by your API that have no Row Level Security and column names that look sensitive, such as password, SSN or card number.

It is a name match, so it can be wrong in either direction. Check what the columns really hold before you decide.

AI app builders sometimes store these values in the table the app already uses, because it was the fastest place to put them.

## Check it yourself

Run this in the Supabase SQL editor. Each row is a column in the public schema whose name looks sensitive, on a table where RLS is off. Add your own words to the pattern if you use others.

```sql
select c.relname as table_name, a.attname as column_name
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity
  and a.attnum > 0
  and not a.attisdropped
  and a.attname ~* '(password|passwd|secret|token|ssn|card|api_key)'
order by 1, 2;
```

## The fix

1. Turn Row Level Security on and let each user reach only their own row. This assumes a user_id column that holds the owner’s id.

   ```sql
   alter table public.customers enable row level security;
   
   create policy "read own row" on public.customers
     for select to authenticated
     using ((select auth.uid()) = user_id);
   ```

2. Better, move the sensitive value out of the exposed schema. A schema you create yourself is not served by the API unless you add it in the project’s API settings. Copy first, check the copy, and only then remove the original.

   ```sql
   create schema if not exists private;
   
   create table private.customer_secrets (
     customer_id uuid primary key references public.customers (id) on delete cascade,
     tax_id text
   );
   
   insert into private.customer_secrets (customer_id, tax_id)
   select id, tax_id from public.customers;
   
   -- after checking the copy, and after taking a backup:
   alter table public.customers drop column tax_id;
   ```

3. Read that table from a server only, such as an Edge Function that checks who is calling. Do not store passwords or full card numbers yourself: use Supabase Auth for logins and your payment provider for cards.

4. Open the table with only the public key. It should return nothing sensitive. Then refresh the Security Advisor and run your scanner again.

## What can break

Turning RLS on without a rule blocks your own app too. Dropping a column cannot be undone, and any screen or function that reads it fails afterwards, so back up and update the app first. If the values were public for a while, treat them as exposed: tell the people affected where the law or your terms require it, and change any password or key that was stored.

> Table, column and bucket names are examples. This is general guidance for one finding; it does not make an app safe on its own. Back up before changing a live database.

Explained with the same content at https://lokandco.com/fix/supabase-sensitive-columns-exposed
