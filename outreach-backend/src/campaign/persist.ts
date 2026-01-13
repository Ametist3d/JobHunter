import fs from "node:fs";
import path from "node:path";
import type { Campaign } from "./store.js";

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), "data", "campaigns");

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function saveCampaign(c: Campaign) {
  ensureDir();
  const fp = path.join(DATA_DIR, `${c.id}.json`);
  fs.writeFileSync(fp, JSON.stringify(c, null, 2), "utf8");
}

export function loadAllCampaigns(): Campaign[] {
  ensureDir();
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
  const out: Campaign[] = [];
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(DATA_DIR, f), "utf8");
      out.push(JSON.parse(raw));
    } catch {
      // ignore corrupted files for now
    }
  }
  return out;
}
