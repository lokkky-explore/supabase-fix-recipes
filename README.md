# Supabase fix recipes

Plain-English fixes for the findings security scanners report on apps built with Lovable, Bolt, Cursor, v0 or Claude Code on Supabase.

A scanner tells you *what* is open. Each recipe here tells you what it means, how to check it yourself in two minutes, the SQL or code that closes it, and **what breaks if you paste the fix without thinking**. That last part is where most AI-built apps go wrong: turning Row Level Security on with no policies takes your own app down too.

| Scanner says | What it means for you | Recipe |
|---|---|---|
| Row Level Security is disabled on a public table | Anyone who opens your site can read, and often change or delete, every row in that table | [supabase-rls-disabled](recipes/supabase-rls-disabled.md) |
| Supabase service role key found in the browser bundle | Anyone can copy that key from your site's code and read or delete your whole database | [supabase-service-role-key-exposed](recipes/supabase-service-role-key-exposed.md) |
| Supabase storage bucket is public | Anyone with a file's link can open it without logging in | [supabase-storage-bucket-public](recipes/supabase-storage-bucket-public.md) |
| Security Definer View (Supabase Security Advisor, lint 0010) | A view hands out rows that Row Level Security protects on the table itself | [supabase-security-definer-view](recipes/supabase-security-definer-view.md) |
| Function Search Path Mutable (Supabase Security Advisor, lint 0011) | A database function can quietly pick up a look-alike table or function planted by someone else, and then run it with the function’s own permissions. | [supabase-function-search-path-mutable](recipes/supabase-function-search-path-mutable.md) |
| RLS Enabled No Policy (Supabase Security Advisor, lint 0008) | No outsider can read the table, but your own app cannot either, so a feature is probably broken or about to break. | [supabase-rls-enabled-no-policy](recipes/supabase-rls-enabled-no-policy.md) |
| Policy Exists RLS Disabled (Supabase Security Advisor, lint 0007) | The access rules you wrote on the table are not being applied, so anyone with your public key can read the whole table. | [supabase-policy-exists-rls-disabled](recipes/supabase-policy-exists-rls-disabled.md) |
| Exposed Auth Users (Supabase Security Advisor, lint 0002) | Anyone with your public key can read the sign-up details of every user through a view that points at the private user table. | [supabase-auth-users-exposed](recipes/supabase-auth-users-exposed.md) |
| RLS references user metadata (Supabase Security Advisor, lint 0015) | A signed-in user can edit their own metadata, so a rule that trusts it can be talked into giving that user access they should not have. | [supabase-rls-references-user-metadata](recipes/supabase-rls-references-user-metadata.md) |
| RLS Policy Always True (Supabase Security Advisor, lint 0024) | A rule that is always true lets every visitor in, so Row Level Security protects nothing on that table for the roles it names. | [supabase-permissive-rls-policy](recipes/supabase-permissive-rls-policy.md) |
| Public Bucket Allows Listing (Supabase Security Advisor, lint 0025) | Anyone can ask your project for the full list of files in a public bucket and then open every one, including files nobody has linked to. | [supabase-public-bucket-allows-listing](recipes/supabase-public-bucket-allows-listing.md) |
| Public Can Execute SECURITY DEFINER Function (Supabase Security Advisor, lint 0028) | Anyone with your public key can run that function over the web, and it runs with its owner’s permissions, skipping your Row Level Security rules. | [supabase-security-definer-function-anon](recipes/supabase-security-definer-function-anon.md) |
| Sensitive Columns Exposed (Supabase Security Advisor, lint 0023) | Anyone with your public key can read columns that look like passwords, card details or personal ID numbers, because the table has no Row Level Security. | [supabase-sensitive-columns-exposed](recipes/supabase-sensitive-columns-exposed.md) |
| Anonymous sign-ins enabled (Supabase Security Advisor, lint 0012) | Anyone can create a throwaway account with no email, and your rules for logged-in users will treat it like a real one. | [supabase-anonymous-sign-ins-enabled](recipes/supabase-anonymous-sign-ins-enabled.md) |
| Extension in Public (Supabase Security Advisor, lint 0014) | An extension’s own tables and functions show up in your project’s public API, where they were never meant to be. | [supabase-extension-in-public](recipes/supabase-extension-in-public.md) |
| Materialized View in API (Supabase Security Advisor, lint 0016) | Anyone who can reach your API can read every row of that materialized view, because Row Level Security cannot be applied to it. | [supabase-materialized-view-in-api](recipes/supabase-materialized-view-in-api.md) |
| Foreign Table in API (Supabase Security Advisor, lint 0017) | Anyone who can reach your API can read every row of that foreign table, because Row Level Security cannot be applied to it. | [supabase-foreign-table-in-api](recipes/supabase-foreign-table-in-api.md) |
| Insecure Queue Exposed in API (Supabase Security Advisor, lint 0019) | Anyone with your project’s address and public key can read, change and delete the messages in that queue. | [supabase-insecure-queue-exposed](recipes/supabase-insecure-queue-exposed.md) |
| Public Can See Object in GraphQL Schema (Supabase Security Advisor, lint 0026) | Anyone with your public key can list the names and columns of your tables and views through the GraphQL address, even where Row Level Security hides the rows. | [supabase-graphql-anon-table-exposed](recipes/supabase-graphql-anon-table-exposed.md) |
| Signed-In Users Can See Object in GraphQL Schema (Supabase Security Advisor, lint 0027) | Anyone who signs up, even with a throwaway account, can list the names and columns of your tables and views through the GraphQL address. | [supabase-graphql-authenticated-table-exposed](recipes/supabase-graphql-authenticated-table-exposed.md) |
| Signed-In Users Can Execute SECURITY DEFINER Function (Supabase Security Advisor, lint 0029) | Any signed-in user, including a throwaway account if signup is open, can run that function over the web, and it runs with its owner’s permissions, skipping your Row Level Security rules. | [supabase-security-definer-function-authenticated](recipes/supabase-security-definer-function-authenticated.md) |
| (No scanner reports it) RLS is on, but logged-in users can see each other’s data | Anyone who signs up can read other customers’ rows, while every scan from outside comes back clean. | [supabase-users-can-see-other-users-data](recipes/supabase-users-can-see-other-users-data.md) |

## How to use a recipe

1. Run the **Check it yourself** query in the Supabase SQL editor (or the browser search it describes).
2. Read **What can break** before you change anything.
3. Apply the fix on a branch or a copy of the project first, test with two different users, then apply it to production.
4. Run your scanner again.

Table, column and bucket names in the recipes are examples: replace them with yours.

## The SQL is tested

Every SQL block in these recipes is run against a real Postgres database (PGlite, in memory) set up with Supabase-style `anon` and `authenticated` roles and two test users. For each recipe the test builds the insecure state, runs the check, applies the fix, then tries to read or write as the wrong user.

```
npm install
npm test
```

The test database is not a Supabase project: the `auth` and `storage` schemas are small stand-ins, and extensions such as `pg_graphql` and `pgmq` are not installed, so those recipes are tested for the grants and rules only. Dashboard steps and app code are not tested.

## Scope and limits

These recipes cover what can be seen from outside a running app. They do not test logic inside your app (one logged-in user reading another user's data through your own code, payments, admin screens). A clean scan does not prove an app is safe.

## Want it done for you?

[Lok & Co.](https://lokandco.com/fix) applies these fixes for a fixed price: changes on a branch you approve, then a before-and-after re-scan. Send the scan report first; you pay only once we confirm what we can fix.

## Contributing

Found a finding that should have a recipe, or a recipe that breaks something? Open an issue with the scanner's wording and what happened.

---

Written with AI tools, checked against Supabase's documentation, and tested as described above. Not affiliated with Supabase, Lovable, Bolt, Cursor or Anthropic. Text under [CC BY 4.0](LICENSE). Lok & Co. is a brand of LOK SAAS SERVICES (Reg. No. 202603165383).
