# Row Level Security is disabled on a public table

**Risk:** Anyone who opens your site can read, and often change or delete, every row in that table.

## What it means

Your site talks to Supabase with a public key that ships inside the page. That is by design: the key is meant to be seen.

What keeps one user out of another user’s rows is Row Level Security (RLS), a set of rules on each table. With RLS off, the public key is enough to read the whole table from any browser, no login needed.

AI app builders often create tables without turning RLS on, or turn it on for some tables and miss others.

## Check it yourself

Run this in the Supabase SQL editor. Any row with false in the last column is open.

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
```

## The fix

1. Turn RLS on for the table. From this moment the public key and logged-in users can read nothing in it until a rule allows it.

   ```sql
   alter table public.notes enable row level security;
   ```

2. Add one rule per action. This set lets a logged-in user work with their own rows only. It assumes the table has a user_id column that holds the owner’s id.

   ```sql
   create policy "read own rows" on public.notes
     for select to authenticated
     using ((select auth.uid()) = user_id);

   create policy "insert own rows" on public.notes
     for insert to authenticated
     with check ((select auth.uid()) = user_id);

   create policy "update own rows" on public.notes
     for update to authenticated
     using ((select auth.uid()) = user_id)
     with check ((select auth.uid()) = user_id);

   create policy "delete own rows" on public.notes
     for delete to authenticated
     using ((select auth.uid()) = user_id);
   ```

3. Repeat for every table from the check above. Tables that hold public content, such as a product list, get a read rule for everyone and no write rule.

   ```sql
   create policy "anyone can read" on public.products
     for select to anon, authenticated
     using (true);
   ```

4. Log in as two different test users and confirm each sees only their own rows. Then run your scanner again.

## What can break

Turning RLS on without rules blocks your own app too: lists come back empty and saves fail without a clear error. Tables with no user_id column, shared team data and admin screens each need a different rule, so do this on a branch or a copy first.

## Undo it

If your app breaks and you need it working again while you fix the rules, run `alter table public.notes disable row level security;`. That reopens the table to everyone, so treat it as a short stop-gap. Rules you added can be removed one by one with `drop policy "read own rows" on public.notes;`. To confirm the fix, run the check again: `rowsecurity` should be true for every table you meant to protect.

> Table, column and bucket names are examples. This is general guidance for one finding; it does not make an app safe on its own. Back up before changing a live database.

Explained with the same content at https://lokandco.com/fix/supabase-rls-disabled
