"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";

interface EditorConfigResponse {
  documentServerUrl: string;
  editing: boolean;
  config: Record<string, unknown>;
}

interface DocEditor {
  destroyEditor: () => void;
}
declare global {
  interface Window {
    DocsAPI?: { DocEditor: new (id: string, config: Record<string, unknown>) => DocEditor };
  }
}

const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  if (!scripts.has(src)) {
    scripts.set(
      src,
      new Promise((resolve, reject) => {
        const el = document.createElement("script");
        el.src = src;
        el.async = true;
        el.onload = () => resolve();
        el.onerror = () => {
          scripts.delete(src);
          reject(new Error("The Excel editor server could not be reached."));
        };
        document.head.appendChild(el);
      }),
    );
  }
  return scripts.get(src)!;
}

/** Embeds ONLYOFFICE Docs. `reloadKey` forces a fresh config (e.g. after check-out / check-in). */
export function OnlyOfficeEditor({ fileId, version, reloadKey }: { fileId: number; version?: number; reloadKey: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const placeholderId = `oo-editor-${fileId}`;

  useEffect(() => {
    let editor: DocEditor | null = null;
    let cancelled = false;
    api<EditorConfigResponse>(`/api/files/${fileId}/editor-config${version ? `?v=${version}` : ""}`)
      .then(async (r) => {
        await loadScript(`${r.documentServerUrl}/web-apps/apps/api/documents/api.js`);
        if (cancelled || !window.DocsAPI || !holder.current) return;
        holder.current.innerHTML = `<div id="${placeholderId}"></div>`;
        editor = new window.DocsAPI.DocEditor(placeholderId, {
          ...r.config,
          events: {
            onAppReady: () => setLoading(false),
            onError: (e: { data?: { errorDescription?: string } }) => setError(e?.data?.errorDescription ?? "The editor reported an error."),
          },
        });
      })
      .catch((e) => !cancelled && (setError((e as Error).message), setLoading(false)));
    return () => {
      cancelled = true;
      try {
        editor?.destroyEditor();
      } catch {}
    };
  }, [fileId, version, reloadKey, placeholderId]);

  return (
    <div className="relative h-full w-full bg-white">
      <div ref={holder} className="h-full w-full" />
      {loading && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white text-sm text-gray-500">
          <span className="h-8 w-8 animate-spin rounded-full border-4 border-brand-100 border-t-brand-700" />
          Starting Excel editor…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-white p-6">
          <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <b>Excel editor unavailable.</b> {error}
            <div className="mt-2 text-xs text-red-700">Switch to the Grid view to continue, and ask the administrator to check the ONLYOFFICE service.</div>
          </div>
        </div>
      )}
    </div>
  );
}
