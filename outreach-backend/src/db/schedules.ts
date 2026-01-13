import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type CampaignSchedule = {
  id: string;
  region: string;
  marketDomain: string;
  companySize: "small" | "medium" | "large";
  limit: number;
  intervalHours: number;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastRunStats?: { found: number; sent: number; failed: number };
  sender: {
    studioName: string;
    yourName: string;
    baseOffer: string;
  };
  
  consecutiveEmptyRuns: number;
  disabledReason?: "manual" | "empty_results" | "all_contacted";
};

const DATA_DIR = path.resolve(process.cwd(), "data");
const SCHEDULES_PATH = path.join(DATA_DIR, "schedules.json");

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function loadSchedules(): Promise<CampaignSchedule[]> {
  try {
    await ensureDir();
    const raw = await fs.readFile(SCHEDULES_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveSchedules(schedules: CampaignSchedule[]) {
  await ensureDir();
  await fs.writeFile(SCHEDULES_PATH, JSON.stringify(schedules, null, 2), "utf8");
}

export async function upsertSchedule(input: Partial<CampaignSchedule> & { id?: string }): Promise<CampaignSchedule> {
  const all = await loadSchedules();
  const id = input.id || randomUUID();
  const idx = all.findIndex((x) => x.id === id);

  const now = new Date();

  if (idx >= 0) {
    const existing = all[idx];
    const updated: CampaignSchedule = {
      ...existing,
      ...input,
      id,
    };
    
    if (input.intervalHours && input.intervalHours !== existing.intervalHours) {
      updated.nextRunAt = new Date(now.getTime() + input.intervalHours * 3600_000).toISOString();
    }
    
    // If manually re-enabled, reset counters
    if (input.enabled === true && !existing.enabled) {
      updated.consecutiveEmptyRuns = 0;
      updated.disabledReason = undefined;
    }
    
    all[idx] = updated;
    await saveSchedules(all);
    return updated;
  } else {
    const intervalHours = input.intervalHours ?? 24;
    const record: CampaignSchedule = {
      id,
      region: input.region || "",
      marketDomain: input.marketDomain || "architectural firms",
      companySize: input.companySize || "small",
      limit: input.limit ?? 30,
      intervalHours,
      enabled: input.enabled ?? true,
      lastRunAt: null,
      nextRunAt: new Date(now.getTime() + intervalHours * 3600_000).toISOString(),
      sender: input.sender || { studioName: "", yourName: "", baseOffer: "" },
      consecutiveEmptyRuns: 0,
    };

    all.push(record);
    await saveSchedules(all);
    return record;
  }
}

export async function deleteSchedule(id: string) {
  const all = await loadSchedules();
  await saveSchedules(all.filter((x) => x.id !== id));
}

export async function getSchedulesDue(): Promise<CampaignSchedule[]> {
  const all = await loadSchedules();
  const now = Date.now();
  return all.filter((s) => s.enabled && s.nextRunAt && new Date(s.nextRunAt).getTime() <= now);
}

export async function markScheduleRun(
  id: string, 
  stats: { found: number; sent: number; failed: number }
): Promise<{ autoDisabled: boolean; reason?: string }> {
  const all = await loadSchedules();
  const idx = all.findIndex((x) => x.id === id);
  if (idx < 0) return { autoDisabled: false };

  const schedule = all[idx];
  const now = new Date();
  
  schedule.lastRunAt = now.toISOString();
  schedule.nextRunAt = new Date(now.getTime() + schedule.intervalHours * 3600_000).toISOString();
  schedule.lastRunStats = stats;

  let autoDisabled = false;
  let reason: string | undefined;

  if (stats.found === 0) {
    schedule.consecutiveEmptyRuns = (schedule.consecutiveEmptyRuns || 0) + 1;
    
    if (schedule.consecutiveEmptyRuns >= 3) {
      schedule.enabled = false;
      schedule.disabledReason = "empty_results";
      autoDisabled = true;
      reason = `Auto-disabled after ${schedule.consecutiveEmptyRuns} consecutive empty runs`;
    }
  } else {
    schedule.consecutiveEmptyRuns = 0;
  }

  await saveSchedules(all);
 
  return { autoDisabled, reason };
}

export async function areAllSchedulesDisabled(): Promise<boolean> {
  const all = await loadSchedules();
  if (all.length === 0) return true;
  return all.every((s) => !s.enabled);
}

export async function getSchedulerStatus(): Promise<{
  total: number;
  enabled: number;
  disabled: number;
  allDisabled: boolean;
  disabledReasons: Record<string, number>;
}> {
  const all = await loadSchedules();
  const enabled = all.filter((s) => s.enabled).length;
  const disabled = all.length - enabled;
  
  const disabledReasons: Record<string, number> = {};
  for (const s of all.filter((x) => !x.enabled)) {
    const reason = s.disabledReason || "manual";
    disabledReasons[reason] = (disabledReasons[reason] || 0) + 1;
  }

  return {
    total: all.length,
    enabled,
    disabled,
    allDisabled: all.length > 0 && enabled === 0,
    disabledReasons,
  };
}