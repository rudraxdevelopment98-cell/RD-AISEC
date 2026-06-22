# Enabling Google Sign-In

The code already supports Google login — it switches on automatically once the
two Google env vars are set. You just need to create a Google OAuth client and
add the values to Vercel.

## 1. Create a Google OAuth client

1. Go to **https://console.cloud.google.com/**.
2. Create (or pick) a project — top bar → project dropdown → **New Project**.
3. Configure the consent screen: **APIs & Services → OAuth consent screen**
   - User type: **External** → Create
   - App name: `RD-AISEC`, your support email, developer email → Save & continue
   - Scopes: leave defaults (email, profile) → Save & continue
   - **Test users:** add your 3 emails (while the app is in "Testing" mode only
     these can sign in — which matches our allowlist):
     - `kjotaniya2002@gmail.com`
     - `rudraxdevelopment98@gmail.com`
     - `kuldeepjotaniya83@gmail.com`
4. Create the credentials: **APIs & Services → Credentials → Create Credentials →
   OAuth client ID**
   - Application type: **Web application**
   - Name: `RD-AISEC Web`
   - **Authorized redirect URIs** → Add:
     - `https://<your-vercel-domain>/api/auth/callback/google`
     - (optional, for local dev) `http://localhost:3000/api/auth/callback/google`
   - Click **Create**.
5. Copy the **Client ID** and **Client secret**.

## 2. Add the env vars in Vercel

Project → **Settings → Environment Variables**:

| Name | Value |
|---|---|
| `AUTH_GOOGLE_ID` | *(the Client ID)* |
| `AUTH_GOOGLE_SECRET` | *(the Client secret)* |

Keep `AUTH_SECRET` and `AUTHORIZED_EMAILS` as they are. The allowlist still
applies — even with Google login, only your 3 emails can get in.

## 3. Redeploy

Vercel → **Deployments → Redeploy** (env-var changes need a fresh build).

## 4. Use it

On the login page you'll now see **Continue with Google**. Sign in with one of
the authorized accounts.

> Once Google works you can turn off the dev login by removing `ALLOW_DEV_LOGIN`
> (and `DEV_LOGIN_PASSWORD`) from Vercel and redeploying.

### Notes
- The redirect URI must match your deployed domain **exactly** (https, no
  trailing slash). If you add a custom domain later, add its callback URI too.
- "Error 400: redirect_uri_mismatch" → the URI in Google Console doesn't match;
  fix it to `https://<domain>/api/auth/callback/google`.
