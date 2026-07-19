import { redirect } from "next/navigation";

// The full finding detail (severity, status, description, recommendation, plus the
// exploit/validation tooling) lives at the /exploit subroute. Some "Open finding"
// links point at the bare /dashboard/findings/[id] path, which had no page and
// 404'd — send those to the detail view instead.
export default function FindingPage({ params }: { params: { id: string } }) {
  redirect(`/dashboard/findings/${params.id}/exploit`);
}
