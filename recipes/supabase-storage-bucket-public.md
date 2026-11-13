# Supabase storage bucket is public

**Risk:** Anyone with a file’s link can open it without logging in, and links are easy to guess or leak.

## What it means

A public bucket serves every file in it to anyone who has the address. That is right for logos and product photos. It is wrong for invoices, ID photos, contracts or anything a user uploaded for themselves.

Uploading, listing and deleting are a separate matter: those are controlled by rules on the storage.objects table. A bucket can be private and still let any logged-in user read every file if those rules are too wide.

## Check it yourself

Run this in the Supabase SQL editor. It lists each bucket and whether it is public, then the storage rules in force.

```sql
select id, public from storage.buckets;

select policyname, cmd, roles, qual
from pg_policies
where schemaname = 'storage' and tablename = 'objects';
```

## The fix

1. Make the bucket private.

   ```sql
   update storage.buckets set public = false where id = 'uploads';
   ```

2. Let each user reach only their own folder. This assumes files are saved under a folder named after the user’s id.

   ```sql
   create policy "read own files" on storage.objects
     for select to authenticated
     using (
       bucket_id = 'uploads'
       and (storage.foldername(name))[1] = (select auth.uid())::text
     );
   
   create policy "upload to own folder" on storage.objects
     for insert to authenticated
     with check (
       bucket_id = 'uploads'
       and (storage.foldername(name))[1] = (select auth.uid())::text
     );
   ```

3. Change the app to ask for a short-lived signed link when it shows a file, in place of the old public link.

   ```ts
   const { data } = await supabase.storage
     .from("uploads")
     .createSignedUrl(path, 60); // valid for 60 seconds
   ```

4. Open an old public link in a private window. It should now fail. Then run your scanner again.

## What can break

Every public link already saved in your database, emails or pages stops working the moment the bucket goes private. Files that were not saved under a per-user folder need moving, or a different rule, before the folder rule fits.

> Table, column and bucket names are examples. This is general guidance for one finding; it does not make an app safe on its own. Back up before changing a live database.

Explained with the same content at https://lokandco.com/fix/supabase-storage-bucket-public
