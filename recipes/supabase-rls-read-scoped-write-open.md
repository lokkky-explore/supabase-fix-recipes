# Reads scoped, writes open

**Risk:** Every read is correctly limited to the caller, and writes go wherever the caller says. Cross-user writes and row ownership moves pass every scan.

## What it means

Reads and writes are separate policies, written at different times, often by different prompts. The read policy compares the row's owner with `auth.uid()`; the write policy was added later to make a form save, and its condition is `with check (true)` — or checks only that someone is signed in. Each policy is defensible on its own. Together they mean the app shows you your own rows and lets you write anyone's.

The pairing is the part that is hard to see. A scan of `pg_policies` finds a scoped policy on the table, which reads as "protected". The always-true write policy is a different row in the same query result, on a line nobody looked at.

Two exact shapes to know, both verified on a real database:

- `for insert ... with check (true)` lets a signed-in user create a row owned by any user id, because for INSERT the `using` clause does not apply — there is no old row to test — so `with check` is the only gate.
- `for update ... using ((select auth.uid()) = user_id) with check (true)` lets a user move their own row to another user id. The `using` gates the old row (their own, passes), the `with check` gates the new row (`true`, passes), so the row changes hands.

A missing `with check` is not the bug on UPDATE: PostgreSQL then uses the `using` expression for both, so the row-ownership move is denied by default. The bug is a write policy whose check is broader than the read that goes with it.

## Check it yourself

Run this in the Supabase SQL editor. Each row is a write policy on a table that also has a scoped read policy — the pairing, not the policy, is what matters.

```sql
select tablename, policyname, cmd, roles, qual as read_condition, with_check
from pg_policies
where schemaname = 'public'
  and cmd in ('INSERT', 'UPDATE', 'ALL')
  and coalesce(with_check, 'true') = 'true'
order by 1, 2;
```

Then, for every table returned, look for a second policy on the same table reading `using ((select auth.uid()) = user_id)`. A scoped read beside an always-true write is the finding.

## The fix

1. Confirm it with the same two-account test. Create a row as user A, then as user B try to insert a row with A's user id, and try to update one of A's rows to a new user id. Both succeeding is the bug; both should raise a permission error, not silently affect zero rows.

2. Make every write policy's condition the same ownership test the read policy uses. Pair them so a read scope cannot exist on a table whose writes are broader.

   ```sql
   drop policy "insert anything" on public.notes;
   drop policy "update own rows or hand them over" on public.notes;

   create policy "insert own rows" on public.notes
     for insert to authenticated
     with check ((select auth.uid()) = user_id);

   create policy "update own rows" on public.notes
     for update to authenticated
     using ((select auth.uid()) = user_id)
     with check ((select auth.uid()) = user_id);
   ```

   Drop the loose write policy by name — adding a careful one beside it leaves the loose rule in place, and Postgres lets a row through when *any* policy on the table allows it. Verify with:

   ```sql
   select policyname, cmd, coalesce(with_check, 'true') as with_check
   from pg_policies
   where schemaname = 'public' and tablename = 'notes'
     and cmd in ('INSERT', 'UPDATE', 'ALL')
   order by 1, 2;
   ```

   Two rows, both scoped, nothing reading `true`.

3. On UPDATE, keep both clauses even though a missing `with check` falls back to `using`. The explicit form survives the day someone adds a broad `with check` to make a form save.

4. Repeat the two-account test for every table you changed, then run the check again and note why each write policy that remains is allowed — some tables genuinely take rows from anyone, and those should say so in a name, not by omission.

## What can break

Writes are where the write path of the app lives: a save form, a signup flow, an admin screen. Tightening a write policy surfaces as a failed save, which is louder than the quiet empty reads an over-tight read policy causes, but it fails at the same moment: when the first real user submits the form. The row that used to land owned by the wrong user will now raise 42501 — that row was the symptom, and its target table is where to look next.

Two accounts with different data is the test to keep; the ownership move is invisible in a single-account screen because a user never sees someone else's row to move.