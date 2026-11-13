# Supabase fix recipes

Plain-English fixes for the findings security scanners report on apps built with Lovable, Bolt, Cursor, v0 or Claude Code on Supabase.

A scanner tells you *what* is open. Each recipe here tells you what it means, how to check it yourself in two minutes, the SQL or code that closes it, and **what breaks if you paste the fix without thinking**. That last part is where most AI-built apps go wrong: turning Row Level Security on with no policies takes your own app down too.

| Scanner says | What it means for you | Recipe |
|---|---|---|
| Row Level Security is disabled on a public table | Anyone who opens your site can read, and often change or delete, every row in that table | [supabase-rls-disabled](recipes/supabase-rls-disabled.md) |
| Supabase service role key found in the browser bundle | Anyone can copy that key from your site's code and read or delete your whole database | [supabase-service-role-key-exposed](recipes/supabase-service-role-key-exposed.md) |
| Supabase storage bucket is public | Anyone with a file's link can open it without logging in | [supabase-storage-bucket-public](recipes/supabase-storage-bucket-public.md) |
| Security Definer View (Supabase Security Advisor, lint 0010) | A view hands out rows that Row Level Security protects on the table itself | [supabase-security-definer-view](recipes/supabase-security-definer-view.md) |

## How to use a recipe

1. Run the **Check it yourself** query in the Supabase SQL editor (or the browser search it describes).
2. Read **What can break** before you change anything.
3. Apply the fix on a branch or a copy of the project first, test with two different users, then apply it to production.
4. Run your scanner again.

Table, column and bucket names in the recipes are examples: replace them with yours.

## Scope and limits

These recipes cover what can be seen from outside a running app. They do not test logic inside your app (one logged-in user reading another user's data through your own code, payments, admin screens). A clean scan does not prove an app is safe.

## Want it done for you?

[Lok & Co.](https://lokandco.com/fix) applies these fixes for a fixed price: changes on a branch you approve, then a before-and-after re-scan. Send the scan report first; you pay only once we confirm what we can fix.

## Contributing

Found a finding that should have a recipe, or a recipe that breaks something? Open an issue with the scanner's wording and what happened.

---

Written with AI tools and checked against Supabase's documentation. Not affiliated with Supabase, Lovable, Bolt, Cursor or Anthropic. Text under [CC BY 4.0](LICENSE). Lok & Co. is a brand of LOK SAAS SERVICES (Reg. No. 202603165383).
