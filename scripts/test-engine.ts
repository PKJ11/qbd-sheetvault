import fs from "fs";
import { parseWorkbook } from "../lib/excel/parse";
import { recalculate } from "../lib/excel/engine";
import { applyEdits } from "../lib/excel/write";

(async () => {
  for (const f of fs.readdirSync("seed")) {
    const buf = fs.readFileSync("seed/" + f);
    const model = await parseWorkbook(buf);
    const cached = new Map<string, unknown>();
    for (const s of model.sheets) for (const [a, c] of Object.entries(s.cells)) if (c.f) cached.set(s.name + "!" + a, c.v);
    const n = recalculate(model);
    let bad = 0;
    for (const s of model.sheets) for (const [a, c] of Object.entries(s.cells)) if (c.f) {
      const old = cached.get(s.name + "!" + a);
      const ok = typeof old === "number" && typeof c.v === "number" ? Math.abs(old - c.v) <= 1e-9 * Math.max(1, Math.abs(old)) : (old ?? "") === (c.v ?? "") || (old === null && c.v === 0);
      if (!ok) { bad++; if (bad < 15) console.log("  MISMATCH", s.name, a, c.f, "cached=", old, "calc=", c.v, c.err ?? ""); }
    }
    console.log(f.slice(0, 20), "sheets", model.sheets.map(s => `${s.name} ${s.rows}x${s.cols} imgs=${s.images.length} unlocked=${Object.values(s.cells).filter(c => c.u).length}`), "formulas", n, "mismatches", bad, "json KB", Math.round(JSON.stringify(model).length / 1024));
    // edit test: first unlocked numeric cell
    const sh = model.sheets[0];
    const target = Object.entries(sh.cells).find(([, c]) => c.u && typeof c.v === "number");
    if (target) {
      const { buffer, changes, model: m2 } = await applyEdits(buf, [{ sheet: sh.name, cell: target[0], value: String((target[1].v as number) * 2) }]);
      fs.writeFileSync(`../_rt_${f.slice(8, 11)}.xlsx`, buffer);
      console.log("  edit", changes, "new size", buffer.length);
      const m3 = await parseWorkbook(buffer);
      const diff = Object.entries(m2.sheets[0].cells).filter(([a, c]) => c.f && c.v !== m3.sheets[0].cells[a]?.v).length;
      console.log("  reparsed formula result diffs:", diff, "images", m3.sheets[0].images.length, "protected", m3.sheets[0].protected);
    }
  }
})();
