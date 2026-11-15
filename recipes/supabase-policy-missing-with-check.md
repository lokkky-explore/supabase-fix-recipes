# Writes missing their WITH CHECK

**Risk:** An update rule with no WITH CHECK lets a signed-in user rewrite every column the rule does not name, including columns your other rules trust.

## What it means

Row Level Security checks two different things on a write. The USING half decides which existing rows you are allowed to touch. The WITH CHECK half decides what the row is allowed to look like afterwards. An insert rule with no check cannot even be written: Postgres rejects it with "only WITH CHECK expression allowed for INSERT". On update and for all rules the check is optional, and that optional half is where the trouble lives.

When the check is missing, the new row is not left wide open. Postgres falls back to measuring the new row against the same USING expression. That is what stops the obvious move: with `using ((select auth.uid()) = user_id)`, a user cannot hand their own row to somebody else, because the new row fails the fallback too.

What the fallback measures is only what USING happens to name. Every column USING does not mention is free. Take a memberships table whose update rule says `using ((select auth.uid()) = user_id)`. The owner of a row can keep their own user_id and rewrite org_id and role: point your membership row at another org and set role to admin. Any read rule that serves org data by trusting the memberships table now serves you that org's private rows. You never read anything directly, so the read side of the app keeps behaving correctly for everyone.

Nothing reports this. Supabase's Security Advisor warns about always-true rules (lint 0024), RLS switched off, and RLS switched on with no rule at all. A write rule with no check is not in that list. A scan from outside with the public key cannot show it either, because writes need a signed-in user and reads stay correct.

The common shapes are all ordinary-looking: a rule an AI builder wrote for "users can update their own row"; a `for all` rule whose USING doubles as the insert check, so inserts look tested while updates carry no check at all; and a separate update rule added later with `using` only.

## Check it yourself

Run this in the Supabase SQL editor. Each row is a write rule that measures the new row against its USING, and nothing else. For each one, read the table's columns and ask which of them the USING does not name: those are the columns a row owner can rewrite to any value.

```sql
select tablename, policyname, cmd, roles, qual as old_row_rule
from pg_policies
where schemaname = 'public'
  and cmd in ('UPDATE', 'ALL')
  and with_check is null
order by 1, 2;
```

## The fix

1. Add the missing check, mirroring the USING. This is the floor, not the fix: it closes the escape for the columns USING names and nothing more.

   ```sql
   alter policy "update own memberships" on public.org_members
     to authenticated
     using ((select auth.uid()) = user_id)
     with check ((select auth.uid()) = user_id);
   ```

2. Name every column the scope depends on. The mirror alone does not stop the memberships forgery, because the attacker kept their own user_id. Pin the columns that carry meaning, so a normal edit cannot change them.

   ```sql
   alter policy "update own memberships" on public.org_members
     to authenticated
     using ((select auth.uid()) = user_id)
     with check ((select auth.uid()) = user_id and role = 'member');
   ```

   A policy cannot see the old row, so "org_id must not change" cannot be written in the check itself. For a column whose value must never move, use the next step instead.

3. Or take the column away. With column privileges, writing the column fails no matter what shape the policies take, and the removal shows up in `information_schema.column_privileges` for review.

   ```sql
   revoke update on public.org_members from authenticated;
   grant update (user_id) on public.org_members to authenticated;
   ```

4. For changes that are supposed to happen (invites, promotions, moving a row between orgs), take them out of client writes: a SECURITY DEFINER function with its own checks, and leave the client no update right on those columns at all.

   ```sql
   revoke update on public.org_members from authenticated;

   create function public.set_member_role(target_org uuid, target_user uuid, new_role text)
     returns void
     language plpgsql
     security definer
     set search_path = ''
   as $$
   begin
     if not exists (
       select 1 from public.org_members me
       where me.user_id = auth.uid() and me.role = 'admin' and me.org_id = target_org
     ) then
       raise exception 'caller is not an admin of this org';
     end if;
     update public.org_members set role = new_role
       where org_id = target_org and user_id = target_user;
   end;
   $$;

   revoke all on function public.set_member_role(uuid, uuid, text) from public;
   grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
   ```

5. Re-run the check. Every write rule left on a customer table should either have a check that names its scope columns, or sit on a table nobody but the service role writes to. Test the real writes with two accounts: one that owns the row trying to forge the scope, and one that should not see the result.

## What can break

Pinning a column blocks app flows that legitimately change it: a member setting a nickname on their own row, a user changing their own profile fields, an owner promoting someone through a normal form. List every write path that touches the table before you pin anything.

Column privileges are blunt. Every path that writes that column as `authenticated`, including paths that used to work, gets permission denied. Test the real app writes, not just the SQL editor, and remember a denied write looks like a silent failure in a form.

A SECURITY DEFINER function becomes the new trust boundary. It runs with the table owner's rights, so pin the search_path, check the caller inside it, and remember it is reachable by everyone you grant execute to.

## Undo it

Save before you start: `select * from pg_policies where tablename = 'org_members';`.

To remove just the check, leaving the mirror floor in place, drop the extra columns from it: `alter policy "update own memberships" on public.org_members to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);`. Going below the floor, back to no check at all, restores the forgery: `alter policy "update own memberships" on public.org_members to authenticated using ((select auth.uid()) = user_id);`.

To give a column back: `grant update on public.org_members to authenticated;` for every column, or `grant update (role) on public.org_members to authenticated;` for one column.

To drop the function: `drop function public.set_member_role(uuid, uuid, text);`.

> Table, column and bucket names are examples. This is general guidance for one finding; it does not make an app safe on its own. Back up before changing a live database.

Explained with the same content at https://lokandco.com/fix/supabase-policy-missing-with-check