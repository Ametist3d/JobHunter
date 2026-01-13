// src/db/db_normalize.ts

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SENT_DB_PATH = path.resolve(__dirname, "../../data/sent_db.json");

async function normalizeDb() {
  console.log(`Reading ${SENT_DB_PATH}...`);
  
  const raw = await fs.readFile(SENT_DB_PATH, "utf8");
  const db = JSON.parse(raw);
  
  let fixed = 0;
  
  for (const region of Object.keys(db.sentByRegion || {})) {
    for (const domain of Object.keys(db.sentByRegion[region] || {})) {
      const entry = db.sentByRegion[region][domain];
      let changed = false;
      
      // Fix missing domain
      if (!entry.domain) {
        entry.domain = domain;
        changed = true;
      }
      
      // Fix missing website
      if (!entry.website) {
        entry.website = `https://${domain}`;
        changed = true;
      }
      
      // Fix count vs sentCount
      if (entry.count !== undefined) {
        entry.sentCount = entry.sentCount ?? entry.count;
        delete entry.count;
        changed = true;
      }
      
      // Ensure sentCount exists
      if (entry.sentCount === undefined) {
        entry.sentCount = 1;
        changed = true;
      }
      
      if (changed) {
        fixed++;
        console.log(`  Fixed: ${region} / ${domain}`);
      }
    }
  }
  
  // Backup original
  await fs.writeFile(SENT_DB_PATH + ".backup", raw, "utf8");
  console.log(`Backup saved to ${SENT_DB_PATH}.backup`);
  
  // Write fixed
  await fs.writeFile(SENT_DB_PATH, JSON.stringify(db, null, 2), "utf8");
  
  console.log(`\nDone! Fixed ${fixed} entries.`);
}

normalizeDb().catch(console.error);