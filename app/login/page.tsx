import Link from "next/link";
import { signIn } from "@/auth";

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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="font-mono text-lg font-bold text-brand">
        RD-AISEC
      </Link>
      <h1 className="mt-6 text-2xl font-bold">Sign in</h1>
      <p className="mt-2 text-sm text-gray-400">
        Access is restricted to authorized accounts.
      </p>

      {errorMessage && (
        <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {errorMessage}
        </p>
      )}

      <div className="card mt-8 space-y-3">
        {googleEnabled && (
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: callbackUrl });
            }}
          >
            <button type="submit" className="btn-primary w-full">
              Continue with Google
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
              Continue with GitHub
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
              className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <input
              name="password"
              type="password"
              placeholder="Password"
              required
              className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <button type="submit" className="btn-primary w-full">
              Sign in
            </button>
          </form>
        )}

        {!googleEnabled && !githubEnabled && !devEnabled && (
          <p className="text-sm text-amber-400">
            No sign-in method is configured yet. Set OAuth credentials (or
            ALLOW_DEV_LOGIN=true) in your environment — see{" "}
            <span className="font-mono">.env.example</span>.
          </p>
        )}
      </div>
    </main>
  );
}
