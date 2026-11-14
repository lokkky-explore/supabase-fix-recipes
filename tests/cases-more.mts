export default (A: string, B: string, NOTES: string, ok: any) => {
  const priv = async (c: any, role: string, obj: string, kind = "table") =>
    (await c.db.query(`select has_${kind}_privilege('${role}','${obj}','${kind === "table" ? "select" : "execute"}')::int x`)).rows[0].x;
  const GQL = NOTES + `alter table public.notes enable row level security;
    create table public.internal_api_keys (id serial primary key, k text);
    create table public.profiles (id uuid primary key, name text);
    create table public.orders (id serial primary key, user_id uuid);`;
  return {
    "supabase-extension-in-public": {
      pre: `create extension ltree; create table public.t (p ltree); insert into public.t values ('a.b');`,
      expectCheckBefore: 1, expectCheckAfter: 0,
      after: async (c: any) => [
        `ltree still usable with schema prefix: ${await ok(c.db.query("select p::text from public.t where p operator(extensions.<@) 'a'::extensions.ltree"), "allowed")}`,
        `unqualified type now fails: ${await ok(c.db.query("select 'a.b'::ltree"), "blocked")}`,
      ],
    },
    "supabase-materialized-view-in-api": {
      pre: `create materialized view public.sales_totals as select 1 as total;`,
      expectCheckBefore: 1, expectCheckAfter: 0,
      after: async (c: any) => [`anon read: ${await ok(c.as("anon", null, "select * from public.sales_totals"), "blocked")}`],
    },
    "supabase-foreign-table-in-api": {
      pre: `create foreign data wrapper dummy; create server s foreign data wrapper dummy;
            create foreign table public.some_foreign_table (id integer, data text, author_id uuid) server s;`,
      expectCheckBefore: 1, expectCheckAfter: 0,
      after: async (c: any) => [
        `anon may select moved table=${await priv(c, "anon", "private.some_foreign_table")} (want 1)`,
        `function exists=${(await c.db.query("select count(*)::int n from pg_proc where proname='my_foreign_rows'")).rows[0].n} (want 1)`,
      ],
    },
    "supabase-insecure-queue-exposed": {
      pre: `create schema pgmq; create table pgmq.q_foo (msg_id serial primary key, message jsonb); insert into pgmq.q_foo(message) values ('{}');
            grant usage on schema pgmq to anon, authenticated; grant all on pgmq.q_foo to anon, authenticated;`,
      after: async (c: any) => [
        `anon messages=${await c.count("anon", null, "select * from pgmq.q_foo")} (want 0)`,
        `open queues left=${(await c.db.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='pgmq' and c.relkind='r' and left(c.relname,2)='q_' and not c.relrowsecurity")).rows[0].n} (want 0)`,
      ],
    },
    "supabase-graphql-anon-table-exposed": {
      pre: GQL, skipSteps: [1],
      after: async (c: any) => [
        `anon select internal=${await priv(c, "anon", "public.internal_api_keys")} (want 0)`,
        `anon select notes=${await priv(c, "anon", "public.notes")} (want 0)`,
        `authenticated select profiles=${await priv(c, "authenticated", "public.profiles")} (want 1)`,
        `new table after default-privilege change: ${await c.db.exec("create table public.later (id int)").then(async () => `anon=${await priv(c, "anon", "public.later")} (want 0)`)}`,
      ],
    },
    "supabase-graphql-authenticated-table-exposed": {
      pre: GQL, skipSteps: [1],
      after: async (c: any) => [
        `authenticated select internal=${await priv(c, "authenticated", "public.internal_api_keys")} (want 0)`,
        `authenticated select notes=${await priv(c, "authenticated", "public.notes")} (want 0)`,
        `authenticated select profiles=${await priv(c, "authenticated", "public.profiles")} (want 1)`,
        `new table: ${await c.db.exec("create table public.later (id int)").then(async () => `authenticated=${await priv(c, "authenticated", "public.later")} (want 0)`)}`,
      ],
    },
    "supabase-security-definer-function-authenticated": {
      pre: `create function public.my_priv_op(a int, b text) returns int language sql security definer set search_path = '' as $$ select 1 $$;`,
      expectCheckBefore: 1, expectCheckAfter: 0,
      after: async (c: any) => {
        await c.db.exec(`create function public.later_fn() returns int language sql security definer set search_path = '' as $$ select 1 $$;`);
        return [
          `authenticated call: ${await ok(c.as("authenticated", { sub: A }, "select public.my_priv_op(1,'x')"), "blocked")}`,
          `new function: authenticated may execute=${await priv(c, "authenticated", "public.later_fn()", "function")} (want 0)`,
          `new function: anon may execute=${await priv(c, "anon", "public.later_fn()", "function")} (want 0)`,
        ];
      },
    },
  };
};
