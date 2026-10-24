// Resolve ExcelJS colour objects ({argb} | {theme, tint} | {indexed}) to CSS hex.

// Default Office theme: lt1, dk1, lt2, dk2, accent1..6, hlink, folHlink (theme index order used by Excel)
const THEME = [
  "FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31",
  "A5A5A5", "FFC000", "5B9BD5", "70AD47", "0563C1", "954F72",
];

const INDEXED = [
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
  "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
  "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
  "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
  "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
  "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
];

function applyTint(hex: string, tint: number): string {
  const ch = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const out = ch.map((c) => {
    const v = tint < 0 ? c * (1 + tint) : c + (255 - c) * tint;
    return Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, "0");
  });
  return out.join("");
}

export function resolveColor(c: unknown): string | undefined {
  if (!c || typeof c !== "object") return undefined;
  const o = c as { argb?: string; theme?: number; tint?: number; indexed?: number };
  let hex: string | undefined;
  if (typeof o.argb === "string") {
    hex = o.argb.length === 8 ? o.argb.slice(2) : o.argb;
  } else if (typeof o.theme === "number") {
    hex = THEME[o.theme];
  } else if (typeof o.indexed === "number") {
    if (o.indexed === 64 || o.indexed === 65) return undefined; // system fg/bg
    hex = INDEXED[o.indexed];
  }
  if (!hex) return undefined;
  if (typeof o.tint === "number" && o.tint !== 0) hex = applyTint(hex, o.tint);
  return "#" + hex.toLowerCase();
}
