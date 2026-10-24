// Windows 11-style file-type icons.

export function FolderIcon({ size = 20, locked = false, open = false }: { size?: number; locked?: boolean; open?: boolean }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
        <path d="M2 6.5A2.5 2.5 0 0 1 4.5 4h4.3c.6 0 1.2.25 1.6.7L12 6.4h7.5A2.5 2.5 0 0 1 22 8.9v.6H2z" fill="#E8A92E" />
        {open ? (
          <path d="M3.4 10h18.9a1 1 0 0 1 .97 1.25l-1.9 7.5A2.5 2.5 0 0 1 18.95 20.6H4.5A2.5 2.5 0 0 1 2 18.1v-6.6A1.5 1.5 0 0 1 3.4 10z" fill="#FFCA4F" />
        ) : (
          <path d="M2 9h20v9.5a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 18.5z" fill="#FFCA4F" />
        )}
        <path d="M2 9h20v1H2z" fill="#F3B83E" opacity=".6" />
      </svg>
      {locked && <LockBadge size={size} />}
    </span>
  );
}

export function ExcelIcon({ size = 20, locked = false }: { size?: number; locked?: boolean }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
        <path d="M7 2h9.5L21 6.5V20a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#fff" stroke="#c8c8c8" strokeWidth=".8" />
        <path d="M16.5 2v3a1.5 1.5 0 0 0 1.5 1.5h3" fill="#e6e6e6" />
        <rect x="11" y="9" width="8" height="2" rx=".3" fill="#21A366" />
        <rect x="11" y="12.5" width="8" height="2" rx=".3" fill="#107C41" opacity=".8" />
        <rect x="11" y="16" width="8" height="2" rx=".3" fill="#185C37" opacity=".7" />
        <rect x="2" y="7.5" width="10" height="10" rx="1.6" fill="#107C41" />
        <path d="M4.6 9.8h1.6l1.1 1.9 1.1-1.9H10l-1.9 2.7 1.9 2.8H8.4l-1.1-1.9-1.1 1.9H4.6l1.9-2.8z" fill="#fff" />
      </svg>
      {locked && <LockBadge size={size} />}
    </span>
  );
}

export function PcIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <rect x="2" y="4" width="20" height="13" rx="1.5" fill="#3b82c4" />
      <rect x="3.3" y="5.3" width="17.4" height="10.4" rx=".6" fill="#9fd3ff" />
      <path d="M9 19h6l.6 2H8.4z" fill="#6b7280" />
    </svg>
  );
}

function LockBadge({ size }: { size: number }) {
  const s = Math.max(10, Math.round(size * 0.55));
  return (
    <svg viewBox="0 0 16 16" width={s} height={s} className="absolute -bottom-0.5 -right-1" aria-label="Locked">
      <rect x="2.5" y="7" width="11" height="8" rx="1.5" fill="#4b5563" stroke="#fff" strokeWidth="1" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="#4b5563" strokeWidth="1.8" />
    </svg>
  );
}

export function BrandMark({ size = 44 }: { size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-xl font-bold"
      style={{ width: size, height: size, background: "#fff", color: "#2d6a4f", fontSize: size * 0.36 }}
    >
      SV
    </div>
  );
}
