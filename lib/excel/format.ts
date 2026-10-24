// Minimal Excel number-format rendering for display.
import type { CellValue } from "./model";
import { isDateFormat } from "./input";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function serialToDate(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000));
}

function formatDate(serial: number, nf: string | undefined): string {
  const d = serialToDate(serial);
  const day = d.getUTCDate(), mon = d.getUTCMonth(), yr = d.getUTCFullYear();
  if (!nf || !isDateFormat(nf)) return `${String(day).padStart(2, "0")}-${MONTHS[mon]}-${yr}`;
  const fmt = nf.replace(/\[[^\]]*\]/g, "").replace(/;@$/, "").replace(/\\/g, "").replace(/"/g, "");
  return fmt.replace(/yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|AM\/PM/gi, (t) => {
    switch (t.toLowerCase()) {
      case "yyyy": return String(yr);
      case "yy": return String(yr).slice(2);
      case "mmmm": return MONTHS_LONG[mon];
      case "mmm": return MONTHS[mon];
      case "mm": return String(mon + 1).padStart(2, "0");
      case "m": return String(mon + 1);
      case "dddd": return d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
      case "ddd": return d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
      case "dd": return String(day).padStart(2, "0");
      case "d": return String(day);
      case "hh": return String(d.getUTCHours()).padStart(2, "0");
      case "h": return String(d.getUTCHours());
      case "ss": return String(d.getUTCSeconds()).padStart(2, "0");
      default: return t;
    }
  });
}

function general(n: number): string {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e11 || abs < 1e-9) return n.toExponential(5).replace(/\.?0+e/, "E").replace("E+", "E+");
  return String(Number(n.toPrecision(11)));
}

export function formatValue(v: CellValue | undefined, nf: string | undefined, isDate?: boolean): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") return v;
  if (isDate || isDateFormat(nf)) return formatDate(v, nf);
  if (!nf || nf === "General" || nf === "@") return general(v);

  let section = nf.split(";")[0];
  if (v < 0 && nf.split(";")[1]) section = nf.split(";")[1];
  section = section.replace(/\[[^\]]*\]/g, "").replace(/"([^"]*)"/g, "$1").replace(/\\(.)/g, "$1").replace(/_./g, " ").replace(/\*./g, "");

  const sci = /(0[.0#]*)E\+0+/i.exec(section);
  if (sci) {
    const dec = (sci[1].split(".")[1] ?? "").length;
    return v.toExponential(dec).toUpperCase().replace(/E\+?(-?)(\d)$/, "E+$10$2").replace("E+-", "E-");
  }
  const pct = section.includes("%");
  const m =/([#0,]+)(\.([0#]+))?/.exec(section);
  if (!m) return general(v);
  const decimals = (m[3] ?? "").length;
  const minDecimals = (m[3] ?? "").replace(/#/g, "").length;
  const thousands = m[1].includes(",");
  let x = pct ? v * 100 : v;
  if (v < 0 && nf.split(";")[1]) x = Math.abs(x);
  let s = x.toFixed(decimals);
  if (decimals > minDecimals) s = s.replace(new RegExp(`0{1,${decimals - minDecimals}}$`), "").replace(/\.$/, "");
  if (thousands) {
    const [i, f] = s.split(".");
    s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f !== undefined ? "." + f : "");
  }
  const prefix = section.slice(0, section.indexOf(m[0])).replace(/[#0,.%]/g, "");
  const suffix = section.slice(section.indexOf(m[0]) + m[0].length).replace(/[#0,.]/g, "");
  return `${prefix}${s}${pct && !suffix.includes("%") ? "%" : ""}${suffix}`;
}
