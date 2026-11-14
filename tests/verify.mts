// Runs every SQL block in recipes/*.md against a real Postgres (PGlite, in memory),
// set up with Supabase-style roles (anon, authenticated) and two test users, A and B.
// For each recipe: build the insecure state, run the check, apply the fix, then try to
// read or write as the wrong user. Usage: npm install && npm test
import { PGlite } from "@electric-sql/pglite";
import { ltree } from "@electric-sql/pglite/contrib/ltree";
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../recipes/", import.meta.url);
const blocks = (s: string) => [...s.matchAll(/```\w*\n([\s\S]*?)```/g)].map((m) => m[1].replace(/^   /gm, "").trim());
const fixes = readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => {
  const text = readFileSync(new URL(f, dir), "utf8");
  const [check, rest] = text.split("## Check it yourself")[1].split("## The fix");
  const steps = rest.split("## What can break")[0].split(/^\d+\. /m).slice(1).map((st) => ({ code: blocks(st)[0] }));
  return { slug: f.replace(".md", ""), check: { code: blocks(check)[0] }, steps };
});
const only = process.argv[2];

const BOOT = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema storage; create schema extensions;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub','')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
create table storage.buckets (id text primary key, public boolean default false);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant execute on all functions in schema storage to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;
const A = "11111111-1111-1111-1111-111111111111", B = "22222222-2222-2222-2222-222222222222";
const NOTES = `create table public.notes (id serial primary key, user_id uuid, body text);
insert into public.notes (user_id, body) values ('${A}','a1'),('${A}','a2'),('${B}','b1');`;

type Ctx = { db: PGlite; as: (role: string, claims: object | null, sql: string) => Promise<any[]>; count: (role: string, claims: object | null, sql: string) => Promise<number> };
type Case = { pre: string; expectCheckBefore?: number; expectCheckAfter?: number; skipSteps?: number[]; after?: (c: Ctx) => Promise<string[]> };
const ok = (p: Promise<any>, good: "allowed" | "blocked") =>
  p.then(() => (good === "allowed" ? "allowed" : "ALLOWED (bad)"), () => (good === "blocked" ? "blocked" : "BLOCKED (bad)"));

export const cases: Record<string, Case> = {
  "supabase-rls-disabled": {
    pre: NOTES + `create table public.products (id serial primary key, name text); insert into public.products(name) values ('p'); alter table public.products enable row level security;`,
    after: async (c) => [
      `anon notes=${await c.count("anon", null, "select * from public.notes")} (want 0)`,
      `A notes=${await c.count("authenticated", { sub: A }, "select * from public.notes")} (want 2)`,
      `B notes=${await c.count("authenticated", { sub: B }, "select * from public.notes")} (want 1)`,
      `anon products=${await c.count("anon", null, "select * from public.products")} (want 1)`,
      `A update B rows=${await c.count("authenticated", { sub: A }, `update public.notes set body='x' where user_id='${B}' returning 1`)} (want 0)`,
      `A insert as B: ${await ok(c.as("authenticated", { sub: A }, `insert into public.notes(user_id,body) values ('${B}','evil')`), "blocked")}`,
    ],
  },
  "supabase-storage-bucket-public": {
    pre: `insert into storage.buckets values ('uploads', true); insert into storage.objects(bucket_id,name) values ('uploads','${A}/a.png'),('uploads','${B}/b.png');`,
    after: async (c) => [
      `A files=${await c.count("authenticated", { sub: A }, "select * from storage.objects")} (want 1)`,
      `anon files=${await c.count("anon", null, "select * from storage.objects")} (want 0)`,
      `A upload to B folder: ${await ok(c.as("authenticated", { sub: A }, `insert into storage.objects(bucket_id,name) values ('uploads','${B}/x.png')`), "blocked")}`,
    ],
  },
  "supabase-security-definer-view": {
    pre: `create table public.orders (id serial primary key, user_id uuid, total int); insert into public.orders(user_id,total) values ('${A}',1),('${B}',2);
          create view public.order_summary as select user_id, sum(total) total from public.orders group by 1;`,
    skipSteps: [3],
    after: async (c) => [
      `A view rows=${await c.count("authenticated", { sub: A }, "select * from public.order_summary")} (want 1)`,
      `anon view rows=${await c.count("anon", null, "select * from public.order_summary")} (want 0)`,
    ],
  },
  "supabase-function-search-path-mutable": {
    pre: NOTES + `create function public.note_count(owner_id uuid) returns bigint language sql stable as $$ select count(*) from notes where user_id = owner_id $$;`,
    expectCheckBefore: 1, expectCheckAfter: 0,
    after: async (c) => [`note_count(A)=${(await c.as("authenticated", { sub: A }, `select public.note_count('${A}') n`))[0].n} (want 2)`],
  },
  "supabase-rls-enabled-no-policy": {
    pre: NOTES + `alter table public.notes enable row level security; create table public.internal_jobs (id serial primary key); alter table public.internal_jobs enable row level security; insert into public.internal_jobs default values;`,
    expectCheckBefore: 2, expectCheckAfter: 0,
    after: async (c) => [
      `A notes=${await c.count("authenticated", { sub: A }, "select * from public.notes")} (want 2)`,
      `A jobs=${await c.count("authenticated", { sub: A }, "select * from public.internal_jobs")} (want 0)`,
    ],
  },
  "supabase-policy-exists-rls-disabled": {
    pre: NOTES + `create policy "read own rows" on public.notes for select to authenticated using ((select auth.uid()) = user_id);`,
    expectCheckBefore: 1, expectCheckAfter: 0,
    after: async (c) => [`B notes=${await c.count("authenticated", { sub: B }, "select * from public.notes")} (want 1)`],
  },
  "supabase-auth-users-exposed": {
    pre: `insert into auth.users(id,email) values ('${A}','a@x.test'); create view public.user_list as select * from auth.users;`,
    expectCheckBefore: 1, expectCheckAfter: 0,
    after: async (c) => {
      await c.db.exec(`insert into auth.users(id,email,raw_user_meta_data) values ('${B}','b@x.test','{"display_name":"Bee"}')`);
      return [
        `profiles total=${(await c.db.query<any>("select count(*)::int n from public.profiles")).rows[0].n} (want 2)`,
        `A sees profiles=${await c.count("authenticated", { sub: A }, "select * from public.profiles")} (want 1)`,
        `anon may execute trigger fn=${(await c.db.query<any>("select has_function_privilege('anon','public.handle_new_user()','execute')::int x")).rows[0].x} (want 0)`,
      ];
    },
  },
  "supabase-rls-references-user-metadata": {
    pre: `create table public.reports (id serial primary key, body text); insert into public.reports(body) values ('r'); alter table public.reports enable row level security;
          create policy "old admin rule" on public.reports for select to authenticated using (((select auth.jwt()) -> 'user_metadata' ->> 'role') = 'admin');`,
    expectCheckBefore: 1, expectCheckAfter: 0,
    after: async (c) => [
      `self-made admin rows=${await c.count("authenticated", { sub: A, user_metadata: { role: "admin" } }, "select * from public.reports")} (want 0)`,
      `real admin rows=${await c.count("authenticated", { sub: A, app_metadata: { role: "admin" } }, "select * from public.reports")} (want 1)`,
    ],
  },
  "supabase-permissive-rls-policy": {
    pre: NOTES + `alter table public.notes enable row level security; create policy "anyone can do anything" on public.notes for all using (true) with check (true);`,
    expectCheckBefore: 1, expectCheckAfter: 0,
    after: async (c) => [
      `A notes=${await c.count("authenticated", { sub: A }, "select * from public.notes")} (want 2)`,
      `anon notes=${await c.count("anon", null, "select * from public.notes")} (want 0)`,
    ],
  },
  "supabase-public-bucket-allows-listing": {
    pre: `insert into storage.buckets values ('avatars', true); insert into storage.objects(bucket_id,name) values ('avatars','${A}/a.png'),('avatars','${B}/b.png');
          create policy "Public bucket listing" on storage.objects for select using (bucket_id = 'avatars');`,
    after: async (c) => [
      `anon list=${await c.count("anon", null, "select * from storage.objects")} (want 0)`,
      `A list=${await c.count("authenticated", { sub: A }, "select * from storage.objects")} (want 1)`,
    ],
  },
  "supabase-security-definer-function-anon": {
    pre: `create function public.my_priv_op(a int, b text) returns int language sql security definer set search_path = '' as $$ select 1 $$;`,
    expectCheckBefore: 1, expectCheckAfter: 0, skipSteps: [3],
    after: async (c) => [
      `anon call: ${await ok(c.as("anon", null, "select public.my_priv_op(1,'x')"), "blocked")}`,
      `authenticated call: ${await ok(c.as("authenticated", { sub: A }, "select public.my_priv_op(1,'x')"), "allowed")}`,
    ],
  },
  "supabase-service-role-key-exposed": { pre: "", after: async () => ["no SQL in this recipe: nothing to run"] },
  "supabase-sensitive-columns-exposed": {
    pre: `create table public.customers (id uuid primary key default gen_random_uuid(), user_id uuid, tax_id text, api_key text); insert into public.customers(user_id,tax_id) values ('${A}','t1'),('${B}','t2');`,
    expectCheckBefore: 1, expectCheckAfter: 0,
    after: async (c) => [
      `A customers=${await c.count("authenticated", { sub: A }, "select * from public.customers")} (want 1)`,
      `secrets copied=${(await c.db.query<any>("select count(*)::int n from private.customer_secrets")).rows[0].n} (want 2)`,
      `anon reads private: ${await ok(c.as("anon", null, "select * from private.customer_secrets"), "blocked")}`,
    ],
  },
  "supabase-anonymous-sign-ins-enabled": {
    pre: NOTES + `alter table public.notes enable row level security; create policy "insert own rows" on public.notes for insert to authenticated with check ((select auth.uid()) = user_id);`,
    after: async (c) => [
      `guest insert: ${await ok(c.as("authenticated", { sub: A, is_anonymous: true }, `insert into public.notes(user_id,body) values ('${A}','g')`), "blocked")}`,
      `real insert: ${await ok(c.as("authenticated", { sub: A, is_anonymous: false }, `insert into public.notes(user_id,body) values ('${A}','r')`), "allowed")}`,
    ],
  },
};
try { Object.assign(cases, (await import("./cases-more.mts")).default(A, B, NOTES, ok)); } catch (e: any) { if (!/Cannot find module/.test(e.message)) throw e; }

const isSql = (code: string) => !/^\s*(\/\/|const |import |await |sb_)/.test(code);
let bad = 0;
for (const f of fixes) {
  if (only && f.slug !== only) continue;
  const c = cases[f.slug];
  const out: string[] = [];
  const db = new PGlite({ extensions: { ltree } });
  const as = async (role: string, claims: object | null, sql: string) => {
    await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${claims ? JSON.stringify(claims) : ""}', false);`);
    try { return (await db.query(sql)).rows; } finally { await db.exec(`reset role; select set_config('request.jwt.claims','',false);`); }
  };
  const ctx: Ctx = { db, as, count: async (r, cl, s) => (await as(r, cl, s)).length };
  const lastRows = async (sql: string) => { const r = await db.exec(sql); return r[r.length - 1].rows.length; };
  try {
    await db.exec(BOOT);
    if (c?.pre) await db.exec(c.pre);
    if (isSql(f.check.code)) {
      const n = await lastRows(f.check.code);
      out.push(`check before: ${n} rows` + (c?.expectCheckBefore !== undefined ? ` (want ${c.expectCheckBefore})` : ""));
    } else out.push("check: not SQL");
    for (const [i, s] of f.steps.entries()) {
      if (!s.code || !isSql(s.code)) continue;
      if (c?.skipSteps?.includes(i + 1)) { out.push(`step ${i + 1}: skipped (alternative)`); continue; }
      try { await db.exec(s.code); out.push(`step ${i + 1}: ok`); }
      catch (e: any) { out.push(`step ${i + 1}: ERROR ${e.message}`); }
    }
    if (isSql(f.check.code) && c?.expectCheckAfter !== undefined) out.push(`check after: ${await lastRows(f.check.code)} rows (want ${c.expectCheckAfter})`);
    if (c?.after) out.push(...(await c.after(ctx)));
    if (!c) out.push("NO CASE DEFINED");
  } catch (e: any) { out.push(`FATAL ${e.message}`); }
  const flag = out.some((l) => {
    const m = l.match(/[=:] ?(\d+)(?: rows)? \(want (\d+)\)/);
    return /ERROR|bad\)|FATAL|NO CASE/.test(l) || (m !== null && m[1] !== m[2]);
  });
  if (flag) bad++;
  console.log(`\n${flag ? "FAIL" : "PASS"} ${f.slug}\n  ` + out.join("\n  "));
  await db.close();
}
console.log(`\n${bad} page(s) with problems`);
