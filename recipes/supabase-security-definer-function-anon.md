# Public Can Execute SECURITY DEFINER Function

**Risk:** Anyone with your public key can run that function over the web, and it runs with its owner’s permissions, skipping your Row Level Security rules.

## What it means

This is a WARN in Supabase’s own Security Advisor (lint 0028_anon_security_definer_function_executable). A sibling lint, 0029, flags the same thing for any signed-in user; fix both together.

A function marked SECURITY DEFINER runs with the permissions of whoever created it, usually an account that skips Row Level Security. Functions in the public schema are served by the API at /rest/v1/rpc/<function name>, so a visitor can call them directly.

Postgres gives everyone permission to run a new function unless that is taken away. Taking it away only from anon is not enough, because anon also gets it through the built-in public group.

## Check it yourself

Run this in the Supabase SQL editor. Each row is a SECURITY DEFINER function in the public schema that the anon role can run.

```sql
select p.proname as function, pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and has_function_privilege('anon', p.oid, 'execute')
order by 1;
```

## The fix

1. Take away permission to run it from both anon and public. Write the function’s argument types in the brackets exactly as the check shows them.

   ```sql
   revoke execute on function public.my_priv_op(int, text) from anon, public;
   ```

2. If logged-in users should still be able to call it, give that back to them only. Think about whether they should: the sibling lint 0029 will flag it.

   ```sql
   grant execute on function public.my_priv_op(int, text) to authenticated;
   ```

3. If the function does not need owner permissions at all, switch it to run as the caller. Row Level Security then applies to it again.

   ```sql
   alter function public.my_priv_op(int, text) security invoker;
   ```

4. Open the function’s /rest/v1/rpc/ address with only the public key. It should now be refused. Then refresh the Security Advisor and run your scanner again.

## What can break

A visitor-facing feature that calls the function (a sign-up count, a public form) stops working until you decide how it should work. Rules on your tables that call the function in their condition also fail for roles that lost permission. Switching to security invoker can make the function return less or fail where a table has no read rule for the caller.

> Table, column and bucket names are examples. This is general guidance for one finding; it does not make an app safe on its own. Back up before changing a live database.

Explained with the same content at https://lokandco.com/fix/supabase-security-definer-function-anon
