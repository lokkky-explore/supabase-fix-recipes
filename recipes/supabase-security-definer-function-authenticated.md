# Signed-In Users Can Execute SECURITY DEFINER Function

**Risk:** Any signed-in user, including a throwaway account if signup is open, can run that function over the web, and it runs with its owner’s permissions, skipping your Row Level Security rules.

## What it means

This is a WARN in Supabase’s own Security Advisor (lint 0029_authenticated_security_definer_function_executable). Its sibling, lint 0028, flags the same thing for the public; fix both together.

A function marked SECURITY DEFINER runs with the permissions of whoever created it, usually a privileged account that skips Row Level Security. Functions in the public schema are served by the API at /rest/v1/rpc/<function name>, so a logged-in user can call them directly.

Postgres gives everyone permission to run a new function unless that is taken away, and Supabase also grants it to the signed-in role by default. Some of these are on purpose, such as a “create my profile” function. Those are fine when the function checks its inputs and does only a narrow job.

## Check it yourself

Run this in the Supabase SQL editor. Each row is a SECURITY DEFINER function in the public schema that the authenticated role can run, with the account it runs as. If your project serves other schemas through the API, change the schema name.

```sql
select p.proname as function,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_userbyid(p.proowner) as runs_as
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and has_function_privilege('authenticated', p.oid, 'execute')
order by 1;
```

## The fix

1. For each function, decide whether a signed-in user should be able to call it at all. If not, take the permission away from authenticated, anon and public. Write the function’s argument types in the brackets exactly as the check shows them. This also clears the matching lint 0028 finding.

   ```sql
   revoke execute on function public.my_priv_op(int, text) from authenticated, anon, public;
   ```

2. If the function does not need owner permissions, switch it to run as the caller. Row Level Security then applies to it again.

   ```sql
   alter function public.my_priv_op(int, text) security invoker;
   ```

3. If the function is meant for signed-in users, leave it and accept the finding for that function. Make sure it checks its inputs and the caller’s id, and does only what it needs to: a function like this is a public endpoint for anyone who can sign up.

4. To stop new functions being callable by default, run both commands. The first removes the Postgres default that lets everyone run a new function; the second removes Supabase’s default for the two API roles. They only affect functions that the same database account creates later, and from then on you must grant permission by hand for each function users should call.

   ```sql
   alter default privileges
     revoke execute on functions from public;

   alter default privileges in schema public
     revoke execute on functions from anon, authenticated;
   ```

5. Call each revoked function as a logged-in test user. It should be refused. Run the check again, then refresh the Security Advisor and run your scanner again.

## What can break

A feature that calls the function from a logged-in screen stops working with a permission error until you decide how it should work. Rules on your tables that call the function in their condition also fail for roles that lost permission. Revoking from public also removes permission from Supabase’s own internal roles, so if the function is set up as an Auth Hook (for example a custom access token hook), revoking can lock every user out of signing in. Check Authentication, Hooks in the dashboard before you revoke, and keep `grant execute ... to supabase_auth_admin` for a hook function. Switching to security invoker can make the function return less, or fail, where a table has no read rule for the caller. Change one function at a time and test the feature that uses it.

## Undo it

To give permission back, run `grant execute on function public.my_priv_op(int, text) to authenticated;`. To undo step 2, run `alter function public.my_priv_op(int, text) security definer;`. To undo step 4, run `alter default privileges grant execute on functions to public;` and `alter default privileges in schema public grant execute on functions to anon, authenticated;`. To confirm the fix, run the check again: only the functions you chose to keep should be listed.

> Table, column and bucket names are examples. This is general guidance for one finding; it does not make an app safe on its own. Back up before changing a live database.

Explained with the same content at https://lokandco.com/fix/supabase-security-definer-function-authenticated
