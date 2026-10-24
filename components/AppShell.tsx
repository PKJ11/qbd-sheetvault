"use client";

import { BarChart3, ChevronDown, ClipboardCheck, FolderTree, History, KeyRound, LogOut, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { BrandMark } from "./icons";
import { ToastProvider } from "./ui";
import { api, cx } from "@/lib/client";
import { APP_FULL_NAME, IDLE_TIMEOUT_MIN, ROLES, type Role } from "@/lib/constants";

export interface ShellUser {
  id: number;
  full_name: string;
  employee_id: string;
  designation: string | null;
  roles: string[];
  department: string | null;
}
export interface Caps {
  admin: boolean;
  reports: boolean;
  audit: boolean;
}

const MeCtx = createContext<{ user: ShellUser; caps: Caps; refreshBadges: () => void }>(null as never);
export const useMe = () => useContext(MeCtx);

export function AppShell({ user, caps, children }: { user: ShellUser; caps: Caps; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [badge, setBadge] = useState({ tasks: 0, requests: 0 });

  const refreshBadges = () => {
    api<{ toReview: unknown[]; changesRequested: unknown[]; pendingAccessRequests: number }>("/api/tasks")
      .then((t) => setBadge({ tasks: t.toReview.length + t.changesRequested.length, requests: t.pendingAccessRequests }))
      .catch(() => {});
  };
  useEffect(() => {
    refreshBadges();
    const t = setInterval(refreshBadges, 60_000);
    return () => clearInterval(t);
  }, [pathname]);

  // Automatic sign-out after inactivity (21 CFR Part 11 session control).
  const lastActive = useRef(0);
  useEffect(() => {
    lastActive.current = Date.now();
    const bump = () => (lastActive.current = Date.now());
    const events = ["mousemove", "keydown", "mousedown", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(async () => {
      if (Date.now() - lastActive.current > IDLE_TIMEOUT_MIN * 60_000) {
        clearInterval(t);
        await fetch("/api/auth/logout?reason=idle", { method: "POST" }).catch(() => {});
        window.location.href = "/login?expired=1";
      }
    }, 30_000);
    return () => {
      clearInterval(t);
      events.forEach((e) => window.removeEventListener(e, bump));
    };
  }, []);

  const signOut = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  };

  const nav = [
    { href: "/explorer", label: "File Explorer", icon: FolderTree, show: true },
    { href: "/tasks", label: "My Tasks", icon: ClipboardCheck, show: true, badge: badge.tasks },
    { href: "/reports", label: "Reports", icon: BarChart3, show: true },
    { href: "/audit", label: "Audit Trail", icon: History, show: caps.audit },
    { href: "/admin", label: "Administration", icon: Users, show: caps.admin, badge: badge.requests },
  ];

  return (
    <MeCtx.Provider value={{ user, caps, refreshBadges }}>
      <ToastProvider>
        <div className="flex min-h-screen flex-col">
          <header className="no-print sticky top-0 z-40 text-white shadow" style={{ background: "linear-gradient(90deg, #1a3a2a 0%, #2d6a4f 70%, #40916c 100%)" }}>
            <div className="flex h-14 items-center gap-4 px-4">
              <Link href="/explorer" className="flex items-center gap-2.5">
                <BrandMark size={32} />
                <div className="hidden leading-tight sm:block">
                  <div className="text-sm font-semibold">{APP_FULL_NAME}</div>
                  <div className="text-[10px] text-brand-200">Controlled Spreadsheet Management</div>
                </div>
              </Link>
              <nav className="ml-4 flex flex-1 items-center gap-1 overflow-x-auto">
                {nav
                  .filter((n) => n.show)
                  .map((n) => {
                    const active = pathname.startsWith(n.href) || (n.href === "/explorer" && pathname.startsWith("/files"));
                    return (
                      <Link
                        key={n.href}
                        href={n.href}
                        className={cx(
                          "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
                          active ? "bg-white/15 font-semibold text-white" : "text-brand-100 hover:bg-white/10",
                        )}
                      >
                        <n.icon size={16} />
                        <span className="hidden md:inline">{n.label}</span>
                        {!!n.badge && <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-brand-950">{n.badge}</span>}
                      </Link>
                    );
                  })}
              </nav>
              <div className="relative">
                <button className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/10" onClick={() => setMenu((m) => !m)}>
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">
                    {user.full_name
                      .split(" ")
                      .map((p) => p[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </span>
                  <span className="hidden text-left leading-tight lg:block">
                    <span className="block text-sm font-medium">{user.full_name}</span>
                    <span className="block text-[10px] text-brand-200">{user.employee_id}</span>
                  </span>
                  <ChevronDown size={14} />
                </button>
                {menu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
                    <div className="absolute right-0 z-50 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-2 text-gray-800 shadow-xl">
                      <div className="border-b border-gray-100 px-3 pb-3 pt-1">
                        <div className="font-semibold">{user.full_name}</div>
                        <div className="text-xs text-gray-500">
                          {user.employee_id} · {user.designation ?? ""}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {user.roles.map((r) => (
                            <span key={r} className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-800">
                              {ROLES[r as Role] ?? r}
                            </span>
                          ))}
                        </div>
                      </div>
                      <Link href="/change-password" className="mt-1 flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-gray-50" onClick={() => setMenu(false)}>
                        <KeyRound size={15} /> Change password
                      </Link>
                      <button className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-red-600 hover:bg-red-50" onClick={signOut}>
                        <LogOut size={15} /> Sign out
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </header>
          <main className="flex flex-1 flex-col">{children}</main>
        </div>
      </ToastProvider>
    </MeCtx.Provider>
  );
}
