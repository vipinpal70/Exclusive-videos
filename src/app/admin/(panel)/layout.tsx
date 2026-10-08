import { redirect } from "next/navigation";
import { AdminProvider } from "@/components/admin-context";
import { ConfirmProvider } from "@/components/confirm";
import { TabGuard } from "@/components/tab-guard";
import { getAdmin, getAdminUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { Sidebar } from "./sidebar";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");
  const siteName = await getSetting("site_name");
  // Tokens issued before "Remember me" existed have no flag; they were persistent, so treat them as remembered.
  const remembered = (await getAdmin())?.rm !== false;

  return (
    <TabGuard remembered={remembered}>
      <AdminProvider admin={admin}>
        <ConfirmProvider>
          <div className="admin min-h-screen lg:pl-[220px]">
            <Sidebar username={admin.username} siteName={siteName} isSuper={admin.isSuper} />
            <main className="mx-auto max-w-[1180px] px-4 pb-12 pt-16 sm:px-6 lg:pt-6">{children}</main>
          </div>
        </ConfirmProvider>
      </AdminProvider>
    </TabGuard>
  );
}
