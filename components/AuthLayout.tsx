import { Check } from "lucide-react";
import { BrandMark } from "./icons";
import { APP_FULL_NAME, APP_TAGLINE, ORG_NAME } from "@/lib/constants";

const POINTS = [
  "Windows-style folders with read / edit / upload / create / delete / review rights",
  "Reviewer annotations, author responses and re-submission cycles",
  "Full who / when / what / why audit trail with e-signatures",
];

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <div
        className="relative hidden flex-col justify-between overflow-hidden p-10 lg:flex lg:w-1/2"
        style={{ background: "linear-gradient(135deg, #1a3a2a 0%, #2d6a4f 60%, #40916c 100%)" }}
      >
        <div className="absolute right-[-80px] top-[-80px] h-[340px] w-[340px] rounded-full opacity-10" style={{ background: "#74c69d" }} />
        <div className="absolute bottom-[-60px] left-[-60px] h-[260px] w-[260px] rounded-full opacity-10" style={{ background: "#95d5b2" }} />
        <div className="relative z-10 flex items-center gap-3">
          <BrandMark />
          <div>
            <div className="text-sm font-semibold leading-tight text-white">{APP_FULL_NAME}</div>
            <div className="text-xs" style={{ color: "#b7e4c7" }}>
              {APP_TAGLINE}
            </div>
          </div>
        </div>
        <div className="relative z-10">
          <div className="mb-2 text-xs font-semibold uppercase tracking-widest" style={{ color: "#95d5b2" }}>
            Quality by Design
          </div>
          <h1 className="mb-4 text-4xl font-bold leading-tight text-white">
            Validated spreadsheets,
            <br />
            controlled end-to-end.
          </h1>
          <p className="mb-8 text-base" style={{ color: "#d8f3dc" }}>
            Store, fill, review and approve QbD calculation sheets in one secure, permission-controlled workspace.
          </p>
          <div className="flex flex-col gap-3">
            {POINTS.map((p) => (
              <div key={p} className="flex items-center gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ background: "#40916c" }}>
                  <Check size={12} color="#fff" />
                </span>
                <span className="text-sm" style={{ color: "#d8f3dc" }}>
                  {p}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="relative z-10 text-xs" style={{ color: "#95d5b2" }}>
          {APP_FULL_NAME} v1.0 • © {new Date().getFullYear()} {ORG_NAME}
        </div>
      </div>
      <div className="flex w-full items-center justify-center px-6 py-12 lg:w-1/2" style={{ background: "#f4f6f8" }}>
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
