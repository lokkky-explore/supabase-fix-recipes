# Insecure Queue Exposed in API

**Risk:** Anyone with your project’s address and public key can read, change and delete the messages in that queue.

## What it means

This is an ERROR in Supabase’s own Security Advisor (lint 0019_insecure_queue_exposed_in_api), so you may see it in your dashboard before any scanner reports it.

Supabase Queues (the pgmq extension) keep each queue’s messages in a table named pgmq.q_ followed by the queue’s name. If the pgmq_public schema is switched on for the API and Row Level Security is off on that table, the messages are open to everyone.

Queue messages often carry job details, email addresses or internal ids. If you do not use Supabase Queues, you will not see this finding.

## Check it yourself

Run this in the Supabase SQL editor. The first query lists queue tables with Row Level Security off that the anon or authenticated role can read. The second shows which schemas the API serves; Supabase’s check only fires when pgmq_public is in that list. It may return nothing if your project has not set it.

```sql
select c.relname as queue_table
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'pgmq'
  and c.relkind in ('r', 'p')
  and left(c.relname, 2) = 'q_'
  and not c.relrowsecurity
  and (has_table_privilege('anon', c.oid, 'select')
       or has_table_privilege('authenticated', c.oid, 'select'))
order by 1;

select current_setting('pgrst.db_schemas', true) as exposed_schemas;
```

## The fix

1. If nothing in the browser needs to touch the queue, the simplest fix is to take pgmq_public out of the exposed schemas in the Supabase dashboard, under Project Settings, API settings. That makes every queue unreachable over the API. Your server code that uses the secret key is a different path; check it still works.

2. Otherwise turn Row Level Security on for each queue table listed. Use the queue’s own name in place of foo.

   ```sql
   alter table pgmq.q_foo enable row level security;
   ```

3. From that moment the API reads nothing from the queue until you write rules that say who may do what. Add them only for the users who truly need the queue from the browser, and make each rule check who is calling. Do not add a rule that is always true.

4. Open the queue through the API with only the public key. It should return nothing. Then refresh the Security Advisor and run your scanner again.

## What can break

Switching Row Level Security on without rules cuts off anything that sends or reads messages through the API, so a job that used to run from the browser stops quietly. Removing pgmq_public from the API list does the same for every queue at once. Messages that were open until now may have been read or changed by others, so look through the queue for entries you did not expect.

> Table, column and bucket names are examples. This is general guidance for one finding; it does not make an app safe on its own. Back up before changing a live database.

Explained with the same content at https://lokandco.com/fix/supabase-insecure-queue-exposed
