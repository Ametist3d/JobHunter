import React, { useEffect, useState } from "react";

type SearchProvider = "gemini" | "deepseek" | "perplexity";

export type ScheduleFormData = {
  id?: string;
  region: string;
  marketDomain: string;
  companySize: "small" | "medium" | "large";
  limit: number;
  intervalHours: number;
  emailsPerCompany: number;
  providers: SearchProvider[];
  startAt?: string;    // datetime-local string used only for "create"
  nextRunAt?: string;  // datetime-local string used for "edit"
  sender: {
    studioName: string;
    yourName: string;
    baseOffer: string;
  };
};

type Props = {
  open: boolean;
  initialData?: Partial<ScheduleFormData>;
  onClose: () => void;
  onSave: (data: ScheduleFormData) => void;
};

const PROVIDER_OPTIONS: { value: SearchProvider; label: string; hint: string }[] = [
  { value: "gemini", label: "🔍 Gemini", hint: "grounding" },
  { value: "deepseek", label: "🤖 DeepSeek", hint: "cheap" },
  { value: "perplexity", label: "🌐 Perplexity", hint: "citations" },
];

// Helper: Convert ISO timestamp to datetime-local format
function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Helper: Get now + X minutes in datetime-local format
function nowPlusMinutesLocal(mins: number): string {
  return toDatetimeLocal(new Date(Date.now() + mins * 60_000).toISOString());
}

// Helper: Convert datetime-local string to ISO
function datetimeLocalToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

const DEFAULT_DATA: ScheduleFormData = {
  region: "",
  marketDomain: "architectural firms",
  companySize: "small",
  limit: 30,
  intervalHours: 24,
  emailsPerCompany: 3,
  providers: ["gemini"],
  startAt: nowPlusMinutesLocal(10),  // Default: now + 10 minutes
  nextRunAt: "",
  sender: {
    studioName: "Threedex Studio",
    yourName: "Iegor",
    baseOffer: "We create high-end architectural visualization (still + animation) that helps studios win clients and present projects clearly.",
  },
};

export default function ScheduleModal({ open, initialData, onClose, onSave }: Props) {
  const [form, setForm] = useState<ScheduleFormData>(DEFAULT_DATA);

  useEffect(() => {
    if (open) {
      const isEdit = !!initialData?.id;

      setForm({
        ...DEFAULT_DATA,
        ...initialData,
        providers: initialData?.providers ?? DEFAULT_DATA.providers,
        sender: { ...DEFAULT_DATA.sender, ...initialData?.sender },
        // For create: use startAt (default = now+10min)
        // For edit: use nextRunAt from existing schedule
        startAt: isEdit ? DEFAULT_DATA.startAt : nowPlusMinutesLocal(10),
        nextRunAt: isEdit ? toDatetimeLocal((initialData as any)?.nextRunAt) : "",
      });
    }
  }, [open, initialData]);

  if (!open) return null;

  const isEdit = !!initialData?.id;

  function toggleProvider(p: SearchProvider) {
    const current = form.providers;
    if (current.includes(p)) {
      // Don't allow deselecting all providers
      if (current.length > 1) {
        setForm({ ...form, providers: current.filter(x => x !== p) });
      }
    } else {
      setForm({ ...form, providers: [...current, p] });
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    if (!form.region.trim()) {
      alert("Region is required");
      return;
    }
    if (!form.sender.studioName.trim() || !form.sender.yourName.trim() || !form.sender.baseOffer.trim()) {
      alert("All sender fields are required");
      return;
    }
    if (form.providers.length === 0) {
      alert("Select at least one search provider");
      return;
    }

    const payload: any = { ...form };

    // Convert datetime-local to ISO for backend
    if (isEdit) {
      const iso = datetimeLocalToIso(form.nextRunAt || "");
      if (iso) payload.nextRunAt = iso;
      else delete payload.nextRunAt;
    } else {
      const iso = datetimeLocalToIso(form.startAt || "");
      if (iso) payload.startAt = iso;
      else delete payload.startAt;
    }

    onSave(payload);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 p-4 sticky top-0 bg-slate-950 z-10">
          <h3 className="text-lg font-semibold">
            {isEdit ? "Edit Schedule" : "New Scheduled Campaign"}
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-900/70"
            type="button"
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Target Section */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
            <h4 className="text-sm font-medium text-slate-300 mb-3">Target</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400">Region *</label>
                <input
                  value={form.region}
                  onChange={(e) => setForm({ ...form, region: e.target.value })}
                  placeholder="e.g., Germany, Estonia, Latvia"
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Market Domain</label>
                <input
                  value={form.marketDomain}
                  onChange={(e) => setForm({ ...form, marketDomain: e.target.value })}
                  placeholder="e.g., architectural firms"
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Company Size</label>
                <select
                  value={form.companySize}
                  onChange={(e) => setForm({ ...form, companySize: e.target.value as any })}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none"
                >
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400">Leads per Run</label>
                <input
                  type="number"
                  value={form.limit}
                  onChange={(e) => setForm({ ...form, limit: parseInt(e.target.value) || 30 })}
                  min={5}
                  max={100}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-slate-400">Emails per Company</label>
                <input
                  type="number"
                  value={form.emailsPerCompany}
                  onChange={(e) => setForm({ ...form, emailsPerCompany: Math.max(1, Math.min(5, parseInt(e.target.value) || 3)) })}
                  min={1}
                  max={5}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                />
                <div className="mt-1 text-xs text-slate-500">
                  How many HR contacts to email per company (1-5)
                </div>
              </div>
            </div>
          </div>

          {/* Search Providers Section */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
            <h4 className="text-sm font-medium text-slate-300 mb-3">Search Engines</h4>
            <div className="flex flex-wrap gap-4">
              {PROVIDER_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.providers.includes(opt.value)}
                    onChange={() => toggleProvider(opt.value)}
                    className="rounded border-slate-600"
                  />
                  <span className="text-sm text-slate-200">{opt.label}</span>
                  <span className="text-xs text-slate-500">({opt.hint})</span>
                </label>
              ))}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              Selected: {form.providers.join(", ") || "none"} • Results are combined and deduplicated
            </div>
          </div>

          {/* Schedule Section */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
            <h4 className="text-sm font-medium text-slate-300 mb-3">Schedule</h4>
            
            {/* Interval */}
            <div className="mb-3">
              <label className="text-xs text-slate-400">Run Interval</label>
              <select
                value={form.intervalHours}
                onChange={(e) => setForm({ ...form, intervalHours: parseInt(e.target.value) })}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none"
              >
                <option value={6}>Every 6 hours</option>
                <option value={12}>Every 12 hours</option>
                <option value={24}>Daily (24h)</option>
                <option value={48}>Every 2 days</option>
                <option value={72}>Every 3 days</option>
                <option value={168}>Weekly</option>
              </select>
            </div>

            {/* Start Time / Next Run Time */}
            <div>
              <label className="text-xs text-slate-400">
                {isEdit ? "Next Run Time (editable)" : "First Run Time"}
              </label>
              <input
                type="datetime-local"
                value={isEdit ? (form.nextRunAt || "") : (form.startAt || "")}
                onChange={(e) => {
                  const v = e.target.value;
                  if (isEdit) {
                    setForm({ ...form, nextRunAt: v });
                  } else {
                    setForm({ ...form, startAt: v });
                  }
                }}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
              />
              <div className="mt-1 text-xs text-slate-500">
                {isEdit 
                  ? "Edit when the next campaign run should start. This overrides the calculated next run time." 
                  : "When should the first campaign run start? Default is 10 minutes from now."}
              </div>
            </div>
          </div>

          {/* Sender Section */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
            <h4 className="text-sm font-medium text-slate-300 mb-3">Sender Info</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400">Studio Name *</label>
                <input
                  value={form.sender.studioName}
                  onChange={(e) => setForm({ 
                    ...form, 
                    sender: { ...form.sender, studioName: e.target.value } 
                  })}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Your Name *</label>
                <input
                  value={form.sender.yourName}
                  onChange={(e) => setForm({ 
                    ...form, 
                    sender: { ...form.sender, yourName: e.target.value } 
                  })}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-slate-400">Offer Text *</label>
                <textarea
                  value={form.sender.baseOffer}
                  onChange={(e) => setForm({ 
                    ...form, 
                    sender: { ...form.sender, baseOffer: e.target.value } 
                  })}
                  rows={3}
                  placeholder="Describe your service offering..."
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-400"
                />
                <div className="mt-1 text-xs text-slate-500">
                  This text will be used to personalize outreach emails for this campaign.
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-700 bg-slate-900/40 px-4 py-2 text-sm text-slate-100 hover:bg-slate-900/70"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-xl bg-emerald-500 px-6 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400"
            >
              {isEdit ? "Save Changes" : "Create Schedule"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}