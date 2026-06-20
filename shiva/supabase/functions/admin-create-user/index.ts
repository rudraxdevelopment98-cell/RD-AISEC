// ============================================================
// Shiva Portal — Edge Function: admin-create-user
// Securely creates (or deletes) accounts using the service_role key,
// which must NEVER be exposed to the browser. Only callers who are
// signed in as an Owner/Admin are allowed.
//
// Deploy:  supabase functions deploy admin-create-user
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided
//          automatically by the platform.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(URL, SERVICE);

    // verify the caller is a signed-in Owner/Admin
    const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
    const { data: caller } = await admin.auth.getUser(token);
    if (!caller?.user) return json({ error: "Not authenticated" }, 401);
    const { data: prof } = await admin.from("profiles").select("role,status").eq("id", caller.user.id).single();
    if (!prof || !["Owner", "Admin"].includes(prof.role) || prof.status !== "Active")
      return json({ error: "Not authorised" }, 403);

    const body = await req.json();

    // delete path
    if (body.deleteId) {
      await admin.from("profiles").delete().eq("id", body.deleteId);
      await admin.auth.admin.deleteUser(body.deleteId);
      return json({ ok: true });
    }

    // create path
    const { name, username, password, role, access } = body;
    if (!name || !username || !password) return json({ error: "Missing fields" }, 400);

    const email = `${username}@shiva.local`;
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (cErr) return json({ error: cErr.message }, 400);

    const { error: pErr } = await admin.from("profiles").insert({
      id: created.user.id, name, username, role: role || "Member",
      access: access || [], status: "Active",
    });
    if (pErr) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: pErr.message }, 400);
    }
    return json({ ok: true, username });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}
