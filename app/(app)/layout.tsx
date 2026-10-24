import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { canSeeAllReports, canSeeAuditTrail, currentUser, isAdmin } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await currentUser();
  if (!u) redirect("/login");
  if (u.must_change_password) redirect("/change-password");
  return (
    <AppShell
      user={{ id: u.id, full_name: u.full_name, employee_id: u.employee_id, designation: u.designation, roles: u.roles, department: u.department }}
      caps={{ admin: isAdmin(u), reports: canSeeAllReports(u), audit: canSeeAuditTrail(u) }}
    >
      {children}
    </AppShell>
  );
}
