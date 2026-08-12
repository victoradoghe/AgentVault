import { redirect } from "next/navigation";

import { DashboardNav } from "@/components/dashboard-nav";
import { getSessionEmail } from "@/server/auth";

/**
 * Authenticated dashboard shell. The middleware already redirects
 * unauthenticated visitors, but we re-check here so the layout never renders for
 * a signed-out user (and to fetch the email for the header).
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const email = await getSessionEmail();
  if (!email) redirect("/login");

  return (
    <div className="min-h-screen">
      <DashboardNav email={email} />
      <div className="mx-auto max-w-5xl px-6 py-8">{children}</div>
    </div>
  );
}
