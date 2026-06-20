# Make the portal real — Supabase setup (~15 min)

[← back to control room](index.md)

The portal runs in **two modes**, decided automatically by `web/config.js`:

- **Local** (default) — accounts/tasks/docs live in your browser. Great for trying it out.
- **Cloud** — real multi-user: people you create can log in from any device. Powered by [Supabase](https://supabase.com) (free tier).

The login screen shows a **● LOCAL** / **● CLOUD** badge so you always know which mode you're in.

---

## What you get in Cloud mode
- Real sign-in for every account you create in **Admin · Users**
- A shared Postgres database (tasks, documents, research, activity) with **Row-Level Security** enforcing roles
- File storage for document uploads
- Admin-created accounts with generated username + password — created **securely** via an Edge Function (the powerful `service_role` key never touches the browser)

---

## Steps

### 1. Create a Supabase project
1. Sign up at **https://supabase.com** → **New project** (free tier).
2. Pick a name + database password (save it). Wait ~2 min for it to spin up.

### 2. Create the database
1. In the project: **SQL Editor → New query**.
2. Paste the contents of [`supabase/schema.sql`](https://github.com/rudraxdevelopment98-cell/shiva/blob/claude/dazzling-galileo-j9yt04/supabase/schema.sql) → **Run**.
   This creates the tables, security policies, and the documents storage bucket.

### 3. Deploy the admin function (account creation)
This is what lets the **Admin · Users → Add user** button create real logins safely.

Install the CLI once, then from the repo root:
```bash
npm i -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF      # ref is in your project URL
supabase functions deploy admin-create-user
```
> `YOUR_PROJECT_REF` is the `abcd1234` part of `https://abcd1234.supabase.co`.

### 4. Create your first Owner account
Run this in **SQL Editor** (replace the password), then it's your login:
```sql
-- create the auth user
select auth.uid();  -- ignore; just ensures schema is ready
```
Easiest path: in **Authentication → Users → Add user**, create
`kuldeep@shiva.local` with a password. Then in **SQL Editor**:
```sql
insert into profiles (id, name, username, role, access, status)
select id, 'Kuldeep', 'kuldeep', 'Owner',
       array['dashboard','project','tasks','documents','research','activity','admin','profile'],
       'Active'
from auth.users where email = 'kuldeep@shiva.local';
```
Now you can log in with username **kuldeep** and that password. From then on, create everyone else from **Admin · Users** in the app.

### 5. Point the portal at your project
Edit [`web/config.js`](https://github.com/rudraxdevelopment98-cell/shiva/blob/claude/dazzling-galileo-j9yt04/web/config.js):
```js
window.SHIVA_CONFIG = {
  SUPABASE_URL: "https://abcd1234.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGci...your public anon key...",
};
```
Both values are in **Project Settings → API**. The **anon** key is safe to put in the browser (the `service_role` key is **not** — never paste that here).

Commit + push. The site redeploys and the login badge flips to **● CLOUD**. Done.

---

## Security notes
- Only the **anon** key is in the browser. The `service_role` key lives only inside the Edge Function on Supabase's servers.
- Row-Level Security means even with the anon key, users can only do what their role allows (e.g. only Owner/Admin can manage users; only managers+ create tasks).
- `*.local` emails are just an internal trick to allow **username** logins — no email is ever sent.

## Reverting to Local
Blank out the two values in `config.js` and push. You're back to the in-browser prototype.

[← back to control room](index.md)
