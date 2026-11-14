# RLS is on, but logged-in users can see each other’s data

**Risk:** Anyone who signs up can read other customers’ rows, while every scan from outside comes back clean.

## What it means

No scanner wording exists for this one, which is the problem. Row Level Security is on, rules exist, and a visitor who is not logged in sees nothing. So a scan that uses your public key reports the table as safe.

The gap is in a read rule for logged-in users whose condition never asks who is calling, such as using (true) or a check on a status column. Supabase’s own Security Advisor leaves always-true read rules out of its warning (lint 0024) because they are sometimes deliberate.

Rules of the normal kind add up: if any one of them lets a row through, the row is visible. One loose rule left over from an early prompt undoes a careful rule written later. AI app builders often add a loose rule to make an empty screen work and never remove it.

## Check it yourself

Run this in the Supabase SQL editor. Each row is a read rule whose condition never mentions the person asking. Some will be fine, such as a public product list or a rule that calls your own membership function. Look hardest at tables that hold one customer’s data.

```sql
select tablename, policyname, cmd, roles, qual as condition
from pg_policies
where schemaname = 'public'
  and cmd in ('SELECT', 'ALL')
  and permissive = 'PERMISSIVE'
  and coalesce(qual, 'true') !~* '(auth\.uid|auth\.jwt|current_setting)'
order by 1, 2;
```

## The fix

1. Confirm it the way an outsider would. Create two test accounts in your app, add a row as the first, then log in as the second and look for it. If the second account can see it, the rule is the cause.

2. For a table where each row belongs to one user, remove the loose rule and keep, or add, a rule that compares the row’s owner with the caller. It assumes a user_id column that holds the owner’s id.

   ```sql
   drop policy "users can read" on public.notes;
   
   create policy "read own rows" on public.notes
     for select to authenticated
     using ((select auth.uid()) = user_id);
   ```

3. For data shared inside a team, compare against a membership table instead. People must also be able to read their own membership rows, or the first rule finds nothing.

   ```sql
   create policy "read own memberships" on public.team_members
     for select to authenticated
     using ((select auth.uid()) = user_id);
   
   create policy "read team projects" on public.projects
     for select to authenticated
     using (
       team_id in (
         select team_id from public.team_members
         where user_id = (select auth.uid())
       )
     );
   ```

4. Repeat the two-account test for every table you changed, including one account that is in a team and one that is not. Then run the check again and note why each row that remains is allowed.

## What can break

Tightening a read rule also hides rows from your own screens that relied on seeing everything: admin pages, exports, totals, search and lists that join to other people’s rows. Live updates follow the same rules, so some users stop receiving them. List every screen that reads the table before you change it, give admins their own rule, and make the change on a branch or a copy first.

> Table, column and bucket names are examples. This is general guidance for one finding; it does not make an app safe on its own. Back up before changing a live database.

Explained with the same content at https://lokandco.com/fix/supabase-users-can-see-other-users-data
