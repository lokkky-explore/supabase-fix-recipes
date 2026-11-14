# Policy Exists RLS Disabled

**Risk:** The access rules you wrote on the table are not being applied, so anyone with your public key can read the whole table.

## What it means

This is an INFO in Supabase’s own Security Advisor (lint 0007_policy_exists_rls_disabled), but in practice it is the same hole as RLS being off, with a false sense of safety on top.

A table can hold rules (policies) while Row Level Security is switched off. Postgres keeps the rules and ignores them. Anyone reading the table definition sees the rules and assumes the table is protected.

It often happens after a migration or a reset that recreated the rules but not the switch.

## Check it yourself

Run this in the Supabase SQL editor. Each row is a table that has rules but RLS is off.

```sql
select c.relname as table_name, count(p.oid) as rules
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity
group by c.relname
order by 1;
```

## The fix

1. Read the existing rules first, so you know what will start to apply.

   ```sql
   select policyname, cmd, roles, qual, with_check
   from pg_policies
   where schemaname = 'public' and tablename = 'notes';
   ```

2. If the rules are the ones you intended, turn RLS on. From this moment they are enforced.

   ```sql
   alter table public.notes enable row level security;
   ```

3. Log in as two different test users and confirm each sees only what the rules allow. Then run your scanner again.

## What can break

The table has been open to everyone until now, so the app may have grown to depend on that. The moment RLS goes on, any screen the rules do not cover comes back empty or fails to save. Rules written long ago may be wrong or missing an action such as insert, so read them before you switch it on, and test on a branch or a copy first.

> Table, column and bucket names are examples. This is general guidance for one finding; it does not make an app safe on its own. Back up before changing a live database.

Explained with the same content at https://lokandco.com/fix/supabase-policy-exists-rls-disabled
