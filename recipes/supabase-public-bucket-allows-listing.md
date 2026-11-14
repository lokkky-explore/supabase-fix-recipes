# Public Bucket Allows Listing

**Risk:** Anyone can ask your project for the full list of files in a public bucket and then open every one, including files nobody has linked to.

## What it means

This is a WARN in Supabase’s own Security Advisor (lint 0025_public_bucket_allows_listing).

A public bucket already lets anyone open a file if they know its address. A broad read rule on the storage.objects table goes further: it lets visitors list what is in the bucket, so they no longer need to know any address.

For logos and product photos the link is all you need. The listing rule is rarely required, and AI app builders often add it to make an upload screen work.

## Check it yourself

Run this in the Supabase SQL editor. It shows which buckets are public, then the read rules on storage.objects. A rule with no bucket_id check in it, or one that names a public bucket, allows listing.

```sql
select id, public from storage.buckets where public;

select policyname, cmd, roles, qual
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and cmd in ('SELECT', 'ALL');
```

## The fix

1. Drop the listing rule. Use the exact name from the check above; the name below is the one Supabase’s own example uses.

   ```sql
   drop policy if exists "Public bucket listing" on storage.objects;
   ```

2. If the app really needs to list files, let each user list only their own folder. This assumes files are saved under a folder named after the user’s id.

   ```sql
   create policy "list own files" on storage.objects
     for select to authenticated
     using (
       bucket_id = 'avatars'
       and (storage.foldername(name))[1] = (select auth.uid())::text
     );
   ```

3. If the files are private in nature (invoices, ID photos), make the bucket private instead and use signed links. See the page on a public storage bucket.

   ```sql
   update storage.buckets set public = false where id = 'avatars';
   ```

4. Try to list the bucket from a private window with only the public key. It should return nothing. Open a known file link: for a public bucket it should still load. Then run your scanner again.

## What can break

Any screen that lists a bucket’s contents with the public key, such as a gallery built from the storage list call, goes empty once the rule is gone. Keep a table of file names in your own database and read from that instead. Making the bucket private breaks every public link already saved, so do not use that step for files people embed.

> Table, column and bucket names are examples. This is general guidance for one finding; it does not make an app safe on its own. Back up before changing a live database.

Explained with the same content at https://lokandco.com/fix/supabase-public-bucket-allows-listing
