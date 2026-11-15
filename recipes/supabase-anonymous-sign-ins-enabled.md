# Anonymous sign-ins enabled

**Risk:** Anyone can create a throwaway account with no email, and your rules for logged-in users will treat it like a real one.

## What it means

This is an INFO in Supabase’s own Security Advisor (lint 0012_auth_allow_anonymous_sign_ins). It tells you the feature is on; it does not say anything is wrong yet.

An anonymous user gets the same authenticated role as a person who signed up. So every rule written as “for authenticated users” now also covers a visitor who never gave you an email.

If your app does not use guest accounts, the simple fix is to turn the feature off. If it does, the fix is to review each rule and decide where guests are allowed.

## Check it yourself

Run this in the Supabase SQL editor. The first query counts guest accounts that already exist. The second lists rules that apply to logged-in users and make no mention of the anonymous flag.

```sql
select count(*) as anonymous_users from auth.users where is_anonymous;

select schemaname, tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and ('authenticated' = any(roles) or 'public' = any(roles))
  and coalesce(qual, '') not ilike '%is_anonymous%'
  and coalesce(with_check, '') not ilike '%is_anonymous%'
order by 1, 2, 3;
```

## The fix

1. If you do not use guest accounts, turn off “Allow anonymous sign-ins” in the Supabase dashboard under Authentication, in the sign-in settings. Users already created as guests stay in the table until you remove them.

2. If you do use them, add a restrictive rule on each table that real accounts should own. A restrictive rule must pass in addition to the other rules, so guests are shut out whatever else allows them.

   ```sql
   create policy "permanent users only" on public.notes
     as restrictive
     for insert to authenticated
     with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is false);
   ```

3. Repeat for update and delete if guests should not change or remove rows. Rules for reading can stay open where guests are meant to see the data.

4. Open the app as a guest and as a signed-up user, and confirm each can do only what you intend. Then refresh the Security Advisor and run your scanner again.

## What can break

Turning the feature off ends guest sign-in for everyone, so a try-before-you-sign-up flow stops working. A restrictive rule also blocks guests from actions they could do before, such as saving a draft, which may be what your app depends on. Test with a real guest session before you rely on the check, because a login token without the flag fails it.

## Undo it

Switch “Allow anonymous sign-ins” back on in the dashboard to restore guest sign-in. Remove the restrictive rule with `drop policy "permanent users only" on public.notes;`. To confirm the fix, run the first check again to see how many guest accounts remain, and test a guest session against each table.

> Table, column and bucket names are examples. This is general guidance for one finding; it does not make an app safe on its own. Back up before changing a live database.

Explained with the same content at https://lokandco.com/fix/supabase-anonymous-sign-ins-enabled
