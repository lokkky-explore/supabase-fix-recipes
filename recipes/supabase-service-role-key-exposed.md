# Supabase service role key found in the browser bundle

**Risk:** Anyone can copy that key from your site’s code and read or delete your whole database, whatever your security rules say.

## What it means

Supabase gives you two kinds of key. The public one (anon or publishable) is safe to ship in the page. The secret one (service_role, or a key starting sb_secret_) skips every Row Level Security rule.

The secret key belongs on a server only. When it ends up in front-end code, usually through an environment variable with a public prefix such as VITE_ or NEXT_PUBLIC_, it is published to every visitor.

Deleting it from the code is not enough. The old key is still in earlier builds, in caches and in your git history, and it keeps working until you replace it.

## Check it yourself

Open your live site, open the browser developer tools, and search the loaded JavaScript files for these two strings. A key that starts with eyJ can also be pasted into a JWT decoder: the secret one shows the role service_role.

```text
sb_secret_
service_role
```

## The fix

1. Replace the key first, in the Supabase dashboard under the project’s API key settings. If the exposed key starts with sb_secret_, create a new secret key and delete the exposed one. If it is an older service_role key starting with eyJ, it cannot be revoked on its own: move the app to the new publishable and secret keys, then disable the legacy keys (or rotate the JWT secret, which also changes your public anon key). Either way, the copied key then stops working.

2. Remove the key from all front-end code and from any environment variable whose name starts with VITE_, NEXT_PUBLIC_ or another public prefix.

3. Move the work that needed the secret key to the server: a Supabase Edge Function or a server route. The browser calls that function; the function holds the key.

   ```ts
   // Supabase Edge Function: the key never leaves the server
   import { createClient } from "npm:@supabase/supabase-js@2";
   
   const admin = createClient(
     Deno.env.get("SUPABASE_URL")!,
     Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
   );
   ```

4. Check who is calling before the function does anything: read the caller’s login token and confirm they are allowed. A server function with a secret key and no check is the same hole in a new place.

5. Deploy, then search the live bundle again and run your scanner again.

## What can break

Revoking the key stops every feature that used it until the server version is live, so plan the swap. If the key was public for a while, also look through your data and logs for changes you did not make.

> Table, column and bucket names are examples. This is general guidance for one finding; it does not make an app safe on its own. Back up before changing a live database.

Explained with the same content at https://lokandco.com/fix/supabase-service-role-key-exposed
