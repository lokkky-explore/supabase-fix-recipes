# RLS references user metadata

**Risk:** A signed-in user can edit their own metadata, so a rule that trusts it can be talked into giving that user access they should not have.

## What it means

This is an ERROR in Supabase’s own Security Advisor (lint 0015_rls_references_user_metadata).

Each user has two bags of extra data. The user_metadata bag can be changed by the user from the browser. The app_metadata bag can only be changed from a server. A rule that says “let this person in if their user_metadata says role is admin” can be passed by anyone who edits their own profile.

AI app builders pick user_metadata because it is the one the sign-up form fills in.

## Check it yourself

Run this in the Supabase SQL editor. Each row is a rule that mentions user metadata.

```sql
select schemaname, tablename, policyname, cmd
from pg_policies
where qual ilike '%user_metadata%'
   or with_check ilike '%user_metadata%'
   or qual ilike '%raw_user_meta_data%'
   or with_check ilike '%raw_user_meta_data%'
order by 1, 2, 3;
```

## The fix

1. Move the fact the rule depends on to app_metadata, and set it from a server only. This example uses the Supabase admin API in an Edge Function or server route.

   ```text
   // Server only: never in browser code
   await admin.auth.admin.updateUserById(userId, {
     app_metadata: { role: "admin" },
   });
   ```

2. Add the new rule first. Rules add together, so while both exist the old one still lets people in. The example covers reading only: if the old rule also allowed insert, update or delete (check the cmd column above), add a matching new rule for each action before you drop it.

   ```sql
   create policy "admins read all reports" on public.reports
     for select to authenticated
     using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
   ```

3. Then drop the old rule.

   ```sql
   drop policy "old admin rule" on public.reports;
   ```

4. If you would rather not put the role in the login token, keep roles in a table that users cannot write to, and have the rule look the user up there.

5. Log in as an admin and as an ordinary user and confirm each sees what they should. Then refresh the Security Advisor and run your scanner again.

## What can break

Existing logins carry the old token until it refreshes, so a new admin may not see the change until they sign in again. Anyone who was admin only because they edited their own metadata loses access, which is the point, but check the list of real admins first. Review the data too: if the old rule was open for a while, look for changes you did not make.

## Undo it

Before you drop the old rule, save its text from the check (add the qual and with_check columns to the select). To restore it, create it again with that text, and accept that the hole is back. Remove the new rule with `drop policy "admins read all reports" on public.reports;`. To confirm the fix, run the check again: it should return no rows.

> Table, column and bucket names are examples. This is general guidance for one finding; it does not make an app safe on its own. Back up before changing a live database.

Explained with the same content at https://lokandco.com/fix/supabase-rls-references-user-metadata
