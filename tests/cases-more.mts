export default (A: string, B: string, NOTES: string, ok: any) => {
  const priv = async (c: any, role: string, obj: string, kind = "table") =>
    (await c.db.query(`select has_${kind}_privilege('${role}','${obj}','${kind === "table" ? "select" : "execute"}')::int x`)).rows[0].x;
  const GQL = NOTES + `alter table public.notes enable row level security;
    create table public.internal_api_keys (id serial primary key, k text);
    create table public.profiles (id uuid primary key, name text);
    create table public.orders (id serial primary key, user_id uuid);`;
  return {
    "supabase-extension-in-public": {
      pre: `create extension ltree; create table public.t (p ltree); insert into public.t values ('a.b');
            create function public.depth(p text) returns int language sql set search_path = public as $$ select nlevel(p::ltree) $$;`,
      expectCheckBefore: 1, expectCheckAfter: 0,
      after: async (c: any) => {
        // Real Supabase puts extensions on the default search_path, so unqualified use keeps working there.
        const onPath = /extensions/.test((await c.db.query("select current_setting('search_path') p")).rows[0].p);
        return [
          `ltree still usable with schema prefix: ${await ok(c.db.query("select p::text from public.t where p operator(extensions.<@) 'a'::extensions.ltree"), "allowed")}`,
          `unqualified type (extensions on search_path: ${onPath}): ${await ok(c.db.query("select 'a.b'::ltree"), onPath ? "allowed" : "blocked")}`,
          `function pinned to search_path=public now fails: ${await ok(c.db.query("select public.depth('a.b')"), "blocked")}`,
        ];
      },
    },
    "supabase-materialized-view-in-api": {
      pre: `create materialized view public.sales_totals as select 1 as total;`,
      expectCheckBefore: 1, expectCheckAfter: 0,
      after: async (c: any) => [`anon read: ${await ok(c.as("anon", null, "select * from public.sales_totals"), "blocked")}`],
    },
    "supabase-foreign-table-in-api": {
      // Real Supabase refuses a wrapper without a handler, so fall back to postgres_fdw there.
      pre: `do $d$ begin create foreign data wrapper dummy; create server s foreign data wrapper dummy;
            exception when others then create extension if not exists postgres_fdw with schema extensions; create server s foreign data wrapper postgres_fdw;
            end $d$;
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
    "supabase-users-can-see-other-users-data": {
      pre: NOTES + `alter table public.notes enable row level security;
        create policy "read own rows old" on public.notes for select to authenticated using ((select auth.uid()) = user_id);
        create policy "users can read" on public.notes for select to authenticated using (true);
        create table public.team_members (team_id int, user_id uuid); alter table public.team_members enable row level security;
        create table public.projects (id serial primary key, team_id int, name text); alter table public.projects enable row level security;
        create policy "projects open" on public.projects for select to authenticated using (name is not null);
        insert into public.team_members values (1,'${A}'),(2,'${B}'); insert into public.projects(team_id,name) values (1,'p1'),(2,'p2'),(2,'p3');`,
      expectCheckBefore: 2,
      after: async (c: any) => {
        const before = `check after: still lists the untouched loose rule on projects`;
        await c.db.exec(`drop policy "projects open" on public.projects`);
        return [
          before,
          `anon notes=${await c.count("anon", null, "select * from public.notes")} (want 0)`,
          `A notes=${await c.count("authenticated", { sub: A }, "select * from public.notes")} (want 2)`,
          `B notes=${await c.count("authenticated", { sub: B }, "select * from public.notes")} (want 1)`,
          `A projects=${await c.count("authenticated", { sub: A }, "select * from public.projects")} (want 1)`,
          `B projects=${await c.count("authenticated", { sub: B }, "select * from public.projects")} (want 2)`,
          `A memberships=${await c.count("authenticated", { sub: A }, "select * from public.team_members")} (want 1)`,
        ];
      },
    },
    "supabase-policy-missing-with-check": {
      pre: `create table public.org_members (org_id uuid, user_id uuid, role text, nickname text);
        insert into public.org_members values ('88888888-8888-8888-8888-888888888888','${A}','member','ann');
        insert into public.org_members values ('99999999-9999-9999-9999-999999999999','${B}','admin','bob');
        create table public.org_secrets (org_id uuid, secret text);
        insert into public.org_secrets values ('99999999-9999-9999-9999-999999999999','victim-org-private-record');
        alter table public.org_members enable row level security;
        create policy "read own memberships" on public.org_members for select to authenticated using ((select auth.uid()) = user_id);
        create policy "update own memberships" on public.org_members for update to authenticated using ((select auth.uid()) = user_id);
        alter table public.org_secrets enable row level security;
        create policy "members read org secrets" on public.org_secrets for select to authenticated using (exists (select 1 from public.org_members m where m.org_id = org_secrets.org_id and m.user_id = (select auth.uid()) and m.role = 'admin'));`,
      expectCheckBefore: 1, expectCheckAfter: 0, skipSteps: [4],
      after: async (c: any) => [
        `A forges admin row in victim org: ${await ok(c.as("authenticated", { sub: A }, `update public.org_members set org_id='99999999-9999-9999-9999-999999999999', role='admin' where user_id='${A}' returning 1`), "blocked")}`,
        `A reads victim org secrets=${await c.count("authenticated", { sub: A }, "select secret from public.org_secrets")} (want 0)`,
        `B (real admin) reads org secrets=${await c.count("authenticated", { sub: B }, "select secret from public.org_secrets")} (want 1)`,
        `A renames own row: ${await ok(c.as("authenticated", { sub: A }, `update public.org_members set nickname='x' where user_id='${A}' returning 1`), "blocked")}`,
        `A update user_id col=${(await c.db.query(`select has_column_privilege('authenticated','public.org_members','user_id','update')::int x`)).rows[0].x} (want 1)`,
        `A update role col=${(await c.db.query(`select has_column_privilege('authenticated','public.org_members','role','update')::int x`)).rows[0].x} (want 0)`,
        `A update org_id col=${(await c.db.query(`select has_column_privilege('authenticated','public.org_members','org_id','update')::int x`)).rows[0].x} (want 0)`,
        `A update nickname col=${(await c.db.query(`select has_column_privilege('authenticated','public.org_members','nickname','update')::int x`)).rows[0].x} (want 0)`,
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
