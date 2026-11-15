# RLS Policy Always True

**Risk:** A rule that is always true lets every visitor in, so Row Level Security protects nothing on that table for the roles it names.

## What it means

This is a WARN in Supabase’s own Security Advisor (lint 0024_permissive_rls_policy). It flags rules that let someone insert, change or delete rows under a condition that is simply true, such as using (true) or with check (true). It leaves out always-true rules that only allow reading, because those are often deliberate.

RLS being switched on is not the same as RLS doing anything. A rule that says true for everyone behaves like no protection at all, only harder to spot.

The quiet version is an always-true rule for logged-in users only. A scan from outside with the public key comes back clean, because a visitor who is not logged in sees nothing. Yet anyone who signs up can read every other customer’s rows. The Security Advisor does not warn about it either, since it skips read-only rules. Only reading the rules, or testing with two accounts, finds it. The check below lists read rules too for that reason.

Some tables are meant to be public, such as a product list people can read. For those, a read-only always-true rule can be intentional, and the Supabase documentation says such cases can be accepted. The ones to fix are rules that also allow writes, or that cover tables holding user data.

## Check it yourself

Run this in the Supabase SQL editor. Each row is a rule whose condition is plainly true, including read-only rules that the Security Advisor leaves out.

```sql
select schemaname, tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and (qual = 'true' or with_check = 'true')
order by 1, 2, 3;
```

## The fix

1. For each row, ask whether anyone on the internet should be able to do that action on that table. If yes (a read-only public list), leave it and note why. If no, continue.

2. Replace the always-true rule with a real condition for each action it covered. A rule written “for all” covered select, insert, update and delete, so each one needs its own rule or it stops working. This version lets a user work with their own rows only. It assumes a user_id column that holds the owner’s id. Run it as one block so the table is never left without rules.

   ```sql
   drop policy "anyone can do anything" on public.notes;

   create policy "read own rows" on public.notes
     for select to authenticated
     using ((select auth.uid()) = user_id);

   create policy "write own rows" on public.notes
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

3. Log in as two different test users and confirm each sees only their own rows. Then refresh the Security Advisor and run your scanner again.

## What can break

Dropping an always-true rule shuts the door for everyone who relied on it, including visitors who are not logged in. A page that showed data to the public goes blank until you add a read rule for the right role. Tables with no user_id column or with shared team data need a different condition.

## Undo it

Before you drop the old rule, save its text (`select * from pg_policies where policyname = 'anyone can do anything';`). To restore it, run `create policy "anyone can do anything" on public.notes for all using (true) with check (true);` and accept that the table is open again. Remove the new rules with `drop policy "read own rows" on public.notes;` and the same for the other three. To confirm the fix, run the check again: the rule should no longer be listed.

> Table, column and bucket names are examples. This is general guidance for one finding; it does not make an app safe on its own. Back up before changing a live database.

Explained with the same content at https://lokandco.com/fix/supabase-permissive-rls-policy
