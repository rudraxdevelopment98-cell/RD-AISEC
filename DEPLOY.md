# Deploying RD-AISEC to Vercel

RD-AISEC is a Next.js app with a Postgres database (via Prisma). Vercel hosts
the app; you bring a hosted Postgres. Total time: ~10 minutes.

## 1. Create a Postgres database

Pick one (all have free tiers):

- **Neon** — https://neon.tech (recommended, fast setup)
- **Supabase** — https://supabase.com (Project → Settings → Database → Connection string)
- **Vercel Postgres** — create it from the Vercel dashboard (Storage tab)

Copy the **connection string**. It looks like:

```
postgresql://user:password@host/dbname?sslmode=require
```

## 2. Push this repo to GitHub

The branch `claude/ai-cybersecurity-dashboard-vu46gc` already has everything.
(Optionally merge it into `main` first.)

## 3. Import into Vercel

1. Go to https://vercel.com/new and import the `RD-AISEC` repo.
2. Framework preset: **Next.js** (auto-detected). Leave build settings default —
   Vercel runs the `vercel-build` script, which generates the Prisma client,
   applies migrations, and builds.

## 4. Set environment variables (Vercel → Project → Settings → Environment Variables)

| Variable | Required | Value |
|---|---|---|
| `DATABASE_URL` | ✅ | Pooled Postgres connection string (Neon: the `-pooler` host) |
| `DIRECT_URL` | ✅ | Direct (non-pooled) connection — Neon: same as `DATABASE_URL` with `-pooler` removed. Used for migrations; avoids the `prisma migrate deploy` P1002 advisory-lock timeout. |
| `AUTH_SECRET` | ✅ | A random string — generate with `npx auth secret` or `openssl rand -base64 33` |
| `AUTHORIZED_EMAILS` | recommended | Comma-separated allowlist of emails permitted to sign in |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | for GitHub login | From a GitHub OAuth app |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | for Google login | From a Google OAuth client |
| `ALLOW_DEV_LOGIN` | optional | `true` only if you want the email+password dev login (avoid in production) |
| `DEV_LOGIN_PASSWORD` | optional | Password for the dev login if enabled |

> Auth.js auto-detects the deployment URL on Vercel, so no `AUTH_URL` is needed.

## 5. Configure OAuth callback URLs

After the first deploy you'll have a URL like `https://rd-aisec.vercel.app`.
In each OAuth app, add the callback URL:

- GitHub: `https://<your-domain>/api/auth/callback/github`
- Google: `https://<your-domain>/api/auth/callback/google`

## 6. Deploy

Click **Deploy**. The `vercel-build` script runs `prisma migrate deploy`, so the
database tables are created automatically on the first build.

## Done

Visit your Vercel URL → sign in → you're in the dashboard.

### Troubleshooting

- **Build fails on `prisma migrate deploy`** → `DATABASE_URL` is wrong or the DB
  isn't reachable. Double-check the string (and that `sslmode=require` is present
  for Neon/Supabase).
- **Can't sign in** → set `AUTH_SECRET`, and make sure your email is in
  `AUTHORIZED_EMAILS` (or that the allowlist is empty to allow any OAuth login).
- **Local dev** now also uses Postgres — set `DATABASE_URL` in `.env` to a local
  or hosted Postgres, then `npx prisma migrate deploy` and `npm run dev`.
