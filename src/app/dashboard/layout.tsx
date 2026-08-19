import { redirect } from "next/navigation";

import { DashboardNav } from "@/components/dashboard-nav";
import { OfflineBanner } from "@/components/offline-banner";
import { OfflineProvider } from "@/components/offline-provider";
import { ServiceWorkerRegistrar } from "@/components/service-worker";
import { getSessionEmail } from "@/server/auth";

/**
 * Authenticated dashboard shell. The middleware already redirects
 * unauthenticated visitors, but we re-check here so the layout never renders for
 * a signed-out user (and to fetch the email for the header).
 *
 * The email doubles as the offline cache's namespace — see
 * `src/lib/offline/cache.ts` for why cached rows must be scoped per account.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const email = await getSessionEmail();
  if (!email) redirect("/login");

  return (
    <OfflineProvider identity={email}>
      <ServiceWorkerRegistrar />
      <div className="min-h-screen">
        <DashboardNav email={email} />
        <OfflineBanner />
        <div className="mx-auto max-w-5xl px-6 py-8">{children}</div>
      </div>
    </OfflineProvider>
  );
}
