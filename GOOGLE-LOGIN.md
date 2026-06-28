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

## Preview deployments (fixing redirect_uri_mismatch on Vercel previews)

Every Vercel **preview** deployment (e.g. a branch like `from-mobileicu`) runs on
a *different* URL than production, such as
`https://<project>-git-<branch>-<scope>.vercel.app`. Google requires the redirect
URI to be registered **exactly** and does **not** support wildcards, so a preview
whose callback isn't registered fails with **Error 400: redirect_uri_mismatch**.

Pick one:

**Recommended — redirect proxy (one URL for all previews).**
Route every preview's OAuth callback through your single, already-registered
production callback. In Vercel → **Settings → Environment Variables**, set on the
**Preview** environment:

| Name | Value |
|---|---|
| `AUTH_REDIRECT_PROXY_URL` | `https://<your-production-domain>/api/auth` |

The app reads this automatically (`auth.config.ts`). Now only production's
callback needs to be in Google, and every preview works.

- **Requirement:** `AUTH_SECRET` must be **identical** across production and
  preview, so the proxy can validate the sign-in state it issued.
- Production must stay deployed (it's the proxy) with the Google env vars set.

**Alternative — register the preview URL.** Add the preview's callback to Google
Console's Authorized redirect URIs:
`https://<project>-git-<branch>-<scope>.vercel.app/api/auth/callback/google`.
Use the **stable branch alias** (the `-git-<branch>-` URL), not the per-commit
hash URL, which changes on every push. Simple for one long-lived branch; gets
unwieldy across many previews.

> Security: both options use real Google OAuth and the email allowlist still
> gates sign-in. The **dev login** (`ALLOW_DEV_LOGIN`) is a static shared
> password — fine as a quick local unblock, but remove it from preview/prod once
> Google works.
