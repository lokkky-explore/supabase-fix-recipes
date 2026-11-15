// Additional cases for recipes whose gap is a pairing, not a single policy:
// a read scoped to the caller beside a write policy that is broader.
// Verified on PGlite: INSERT with `with check (true)` lands a row owned by
// another user; UPDATE with scoped `using` but `with check (true)` moves
// the caller's own row to another user id. A missing WITH CHECK on UPDATE
// is not the bug — PostgreSQL then uses USING for both, so the move is denied.
export default (A: string, B: string, NOTES: string, ok: any) => {
  return {
    "supabase-rls-read-scoped-write-open": {
      pre:
        NOTES +
        `alter table public.notes enable row level security;
    create policy "read own rows" on public.notes for select to authenticated using ((select auth.uid()) = user_id);
    create policy "insert anything" on public.notes for insert to authenticated with check (true);
    create policy "update own rows or hand them over" on public.notes for update to authenticated using ((select auth.uid()) = user_id) with check (true);`,
      expectCheckBefore: 2,
      expectCheckAfter: 0,
      after: async (c: any) => [
        `A notes=${await c.count("authenticated", { sub: A }, "select * from public.notes")} (want 2)`,
        `B notes=${await c.count("authenticated", { sub: B }, "select * from public.notes")} (want 1)`,
        `A inserts a row owned by B: ${await ok(c.as("authenticated", { sub: A }, `insert into public.notes(user_id,body) values ('${B}','planted')`), "blocked")}`,
        `A moves own row to B: ${await ok(c.as("authenticated", { sub: A }, `update public.notes set user_id='${B}' where user_id='${A}' returning 1`), "blocked")}`,
      ],
    },
  };
};