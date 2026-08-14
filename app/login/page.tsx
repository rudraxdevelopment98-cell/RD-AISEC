import Link from "next/link";
import { signIn } from "@/auth";
import { Icon } from "@/components/icons";

const githubEnabled = !!(
  process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET
);
const googleEnabled = !!(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
);
const devEnabled = process.env.ALLOW_DEV_LOGIN === "true";

export default function LoginPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string; error?: string };
}) {
  const callbackUrl = searchParams.callbackUrl ?? "/dashboard";

  const ERROR_MESSAGES: Record<string, string> = {
    AccessDenied:
      "This account isn't on the authorized list. Ask an admin to add your email to AUTHORIZED_EMAILS.",
    CredentialsSignin: "Incorrect email or password.",
    Configuration:
      "Sign-in isn't configured correctly. Check the server environment variables.",
  };
  const errorMessage = searchParams.error
    ? ERROR_MESSAGES[searchParams.error] ?? "Could not sign you in. Please try again."
    : null;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      {/* Ambient backdrop — emerald grid + soft glow, matches the dashboard scene. */}
      <div aria-hidden className="scene">
        <div className="scene-grid" />
        <div className="liquid-bg"><span className="b1" /><span className="b2" /><span className="b3" /></div>
      </div>

      <div className="relative w-full max-w-sm fade-up">
        {/* Brand lockup */}
        <div className="flex flex-col items-center text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-glow via-brand to-brand-dark text-[#04140d] shadow-[0_10px_30px_-8px_rgba(52,211,153,0.6)]">
            <Icon name="shield" className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">
            <span className="text-brand-gradient">RD-AISEC</span>
          </h1>
          <p className="mt-1 text-sm text-gray-400">AI-powered security operations</p>
        </div>

        {errorMessage && (
          <p className="mt-6 rounded-xl border border-sev-crit/40 bg-sev-crit/10 px-4 py-3 text-sm text-sev-crit">
            {errorMessage}
          </p>
        )}

        <div className="card card-glow mt-6 space-y-3">
          <div className="mb-1">
            <h2 className="text-base font-semibold text-white">Sign in</h2>
            <p className="mt-0.5 text-xs text-gray-500">Access is restricted to authorized accounts.</p>
          </div>

          {googleEnabled && (
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: callbackUrl });
              }}
            >
              <button type="submit" className="btn-primary w-full">
                <Icon name="globe" className="h-4 w-4" /> Continue with Google
              </button>
            </form>
          )}

          {githubEnabled && (
            <form
              action={async () => {
                "use server";
                await signIn("github", { redirectTo: callbackUrl });
              }}
            >
              <button type="submit" className="btn-ghost w-full">
                <Icon name="globe" className="h-4 w-4" /> Continue with GitHub
              </button>
            </form>
          )}

          {devEnabled && (githubEnabled || googleEnabled) && (
            <div className="flex items-center gap-3 py-1 text-xs text-gray-600">
              <span className="h-px flex-1 bg-surface-border" /> or{" "}
              <span className="h-px flex-1 bg-surface-border" />
            </div>
          )}

          {devEnabled && (
            <form
              action={async (formData: FormData) => {
                "use server";
                await signIn("dev-login", {
                  email: formData.get("email"),
                  password: formData.get("password"),
                  redirectTo: callbackUrl,
                });
              }}
              className="space-y-3"
            >
              <p className="text-xs text-gray-500">Developer login (dev only)</p>
              <input
                name="email"
                type="email"
                placeholder="you@example.com"
                required
                className="glass-input w-full"
              />
              <input
                name="password"
                type="password"
                placeholder="Password"
                required
                className="glass-input w-full"
              />
              <button type="submit" className="btn-primary w-full">
                <Icon name="lock" className="h-4 w-4" /> Sign in
              </button>
            </form>
          )}

          {!googleEnabled && !githubEnabled && !devEnabled && (
            <p className="text-sm text-sev-med">
              No sign-in method is configured yet. Set OAuth credentials (or
              ALLOW_DEV_LOGIN=true) in your environment — see{" "}
              <span className="font-mono">.env.example</span>.
            </p>
          )}
        </div>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-gray-600">
          <Icon name="lock" className="mr-1 inline h-3 w-3" />
          For authorized security testing only. All activity is audited.
        </p>
        <p className="mt-2 text-center text-xs">
          <Link href="/" className="text-gray-500 transition hover:text-brand">← Back to home</Link>
        </p>
      </div>
    </main>
  );
}
