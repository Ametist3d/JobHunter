import React, { useEffect, useState } from "react";
import type { SearchProvider } from "../api";

export type JobScheduleFormData = {
  region: string;
  position: string;
  industry?: string;
  marketDomain: string;
  companySize: "small" | "medium" | "large";
  providers: SearchProvider[];
  limit: number;
  intervalHours: number;
  emailsPerCompany: number;

  startAt?: string;    // ISO timestamp - used only when creating
  nextRunAt?: string;  // ISO timestamp - used only when editing

  applicant: {
    fullName: string;
    phone?: string;
    portfolioUrl?: string;
    coverLetterBase: string;
    cvFilename?: string;
  };
};

type Props = {
  open: boolean;
  initialData?: Partial<JobScheduleFormData>;
  onClose: () => void;
  onSave: (data: JobScheduleFormData) => void;
};

const DEFAULT_DATA: JobScheduleFormData = {
  region: "",
  position: "",
  marketDomain: "tech companies",
  companySize: "small",
  providers: ["gemini"],
  limit: 30,
  intervalHours: 6,
  emailsPerCompany: 1,
  applicant: {
    fullName: "",
    coverLetterBase: "",
  },
};

// ✅ Helper functions for datetime handling
function toDatetimeLocal(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const offset = d.getTimezoneOffset() * 60000;
    const localTime = new Date(d.getTime() - offset);
    return localTime.toISOString().slice(0, 16);
  } catch {
    return "";
  }
}

function nowPlusMinutesLocal(minutes: number): string {
  const d = new Date(Date.now() + minutes * 60000);
  const offset = d.getTimezoneOffset() * 60000;
  const localTime = new Date(d.getTime() - offset);
  return localTime.toISOString().slice(0, 16);
}

function datetimeLocalToIso(local: string): string | undefined {
  if (!local) return undefined;
  try {
    return new Date(local).toISOString();
  } catch {
    return undefined;
  }
}

export default function JobScheduleModal({ open, initialData, onClose, onSave }: Props) {
  const [form, setForm] = useState<JobScheduleFormData>(DEFAULT_DATA);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ✅ Local datetime state
  const [nextRunLocal, setNextRunLocal] = useState("");

  useEffect(() => {
    if (open) {
      const merged = {
        ...DEFAULT_DATA,
        ...initialData,
        applicant: { ...DEFAULT_DATA.applicant, ...initialData?.applicant },
        providers: initialData?.providers || ["gemini"],
      };
      setForm(merged);
      
      // ✅ Initialize datetime based on mode
      if (initialData?.nextRunAt) {
        // Edit mode: show existing nextRunAt
        setNextRunLocal(toDatetimeLocal(initialData.nextRunAt));
      } else {
        // Create mode: default to now + 10 minutes
        setNextRunLocal(nowPlusMinutesLocal(10));
      }
      
      setCvFile(null);
      setUploadError(null);
    }
  }, [open, initialData]);

  if (!open) return null;

  const isEdit = !!(initialData as any)?.id;

  function toggleProvider(p: SearchProvider) {
    setForm((prev) => ({
      ...prev,
      providers: prev.providers.includes(p)
        ? prev.providers.filter((x) => x !== p)
        : [...prev.providers, p],
    }));
  }

  async function handleCvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setUploadError("Please select a PDF file");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setUploadError("File too large (max 10MB)");
      return;
    }

    setCvFile(file);
    setUploadError(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("cv", file);

      const res = await fetch("/api/upload-cv", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!data.ok) {
        throw new Error(data.error || "Upload failed");
      }

      setForm((prev) => ({
        ...prev,
        applicant: { ...prev.applicant, cvFilename: data.filename },
      }));
    } catch (err: any) {
      setUploadError(err.message || "Upload failed");
      setCvFile(null);
    } finally {
      setUploading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    if (!form.region.trim() || !form.position.trim()) {
      alert("Region and Position are required");
      return;
    }
    if (!form.applicant.fullName.trim() || !form.applicant.coverLetterBase.trim()) {
      alert("Applicant name and cover letter are required");
      return;
    }
    if (form.providers.length === 0) {
      alert("Select at least one search provider");
      return;
    }
    
    const finalData = {
      ...form,
      ...(isEdit 
        ? { nextRunAt: datetimeLocalToIso(nextRunLocal) }  // Edit: override nextRunAt
        : { startAt: datetimeLocalToIso(nextRunLocal) }    // Create: set startAt
      ),
    };
    
    onSave(finalData);
  }

  const displayFilename = cvFile?.name || form.applicant.cvFilename || "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl">
        {/* ✅ Sticky header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-950 p-4">
          <h3 className="text-lg font-semibold">
            {isEdit ? "Edit Schedule" : "New Job Search Schedule"}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Target Section */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
            <h4 className="text-sm font-medium text-slate-300 mb-3">Job Search Target</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400">Position *</label>
                <input
                  value={form.position}
                  onChange={(e) => setForm({ ...form, position: e.target.value })}
                  placeholder="e.g., 3D Artist, Unity Developer"
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Region *</label>
                <input
                  value={form.region}
                  onChange={(e) => setForm({ ...form, region: e.target.value })}
                  placeholder="e.g., Germany, Denmark"
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Industry (optional)</label>
                <input
                  value={form.industry || ""}
                  onChange={(e) => setForm({ ...form, industry: e.target.value })}
                  placeholder="e.g., gaming, architecture"
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Leads per Run</label>
                <input
                  type="number"
                  value={form.limit}
                  onChange={(e) => setForm({ ...form, limit: parseInt(e.target.value) || 30 })}
                  min={10}
                  max={100}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Emails / company</label>
                <input
                  type="number"
                  value={form.emailsPerCompany}
                  onChange={(e) =>
                    setForm({ ...form, emailsPerCompany: Math.max(1, Math.min(5, parseInt(e.target.value) || 1)) })
                  }
                  min={1}
                  max={5}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                />
              </div>
            </div>

            {/* Provider Selection */}
            <div className="mt-3">
              <label className="text-xs text-slate-400">Search Providers *</label>
              <div className="mt-2 flex gap-2">
                {(["gemini", "deepseek", "perplexity"] as SearchProvider[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => toggleProvider(p)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      form.providers.includes(p)
                        ? "bg-emerald-500 text-slate-950"
                        : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                    }`}
                  >
                    {p === "gemini" && "🔍 Gemini"}
                    {p === "deepseek" && "🤖 DeepSeek"}
                    {p === "perplexity" && "🌐 Perplexity"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Schedule Section */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
            <h4 className="text-sm font-medium text-slate-300 mb-3">Schedule</h4>
            
            {/* ✅ Datetime picker */}
            <div className="mb-3">
              <label className="text-xs text-slate-400">
                {isEdit ? "Next Run Time" : "First Run Time"}
              </label>
              <input
                type="datetime-local"
                value={nextRunLocal}
                onChange={(e) => setNextRunLocal(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              />
              <div className="mt-1 text-xs text-slate-500">
                {isEdit ? "Override the calculated next run time" : "When to start the campaign"}
              </div>
            </div>
            
            <div>
              <label className="text-xs text-slate-400">Run Interval</label>
              <select
                value={form.intervalHours}
                onChange={(e) => setForm({ ...form, intervalHours: parseInt(e.target.value) })}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              >
                <option value={6}>Every 6 hours</option>
                <option value={12}>Every 12 hours</option>
                <option value={24}>Daily (24h)</option>
                <option value={48}>Every 2 days</option>
                <option value={168}>Weekly</option>
              </select>
            </div>
          </div>

          {/* Applicant Section */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
            <h4 className="text-sm font-medium text-slate-300 mb-3">Your Info</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400">Full Name *</label>
                <input
                  value={form.applicant.fullName}
                  onChange={(e) => setForm({
                    ...form,
                    applicant: { ...form.applicant, fullName: e.target.value },
                  })}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Phone</label>
                <input
                  value={form.applicant.phone || ""}
                  onChange={(e) => setForm({
                    ...form,
                    applicant: { ...form.applicant, phone: e.target.value },
                  })}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Portfolio URL</label>
                <input
                  value={form.applicant.portfolioUrl || ""}
                  onChange={(e) => setForm({
                    ...form,
                    applicant: { ...form.applicant, portfolioUrl: e.target.value },
                  })}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                />
              </div>
              
              <div>
                <label className="text-xs text-slate-400">CV (PDF)</label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="text"
                    value={displayFilename}
                    readOnly
                    placeholder="No file selected"
                    className="flex-1 rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100"
                  />
                  <label className={`cursor-pointer rounded-xl px-4 py-2 text-sm font-medium ${
                    uploading 
                      ? "bg-slate-600 text-slate-400 cursor-wait" 
                      : "bg-slate-700 text-slate-100 hover:bg-slate-600"
                  }`}>
                    {uploading ? "..." : "Browse"}
                    <input
                      type="file"
                      accept=".pdf"
                      onChange={handleCvUpload}
                      disabled={uploading}
                      className="hidden"
                    />
                  </label>
                </div>
                {uploadError && (
                  <div className="mt-1 text-xs text-red-400">{uploadError}</div>
                )}
                {displayFilename && !uploadError && (
                  <div className="mt-1 text-xs text-emerald-400">✓ {displayFilename} ready</div>
                )}
              </div>

              <div className="md:col-span-2">
                <label className="text-xs text-slate-400">Cover Letter Base *</label>
                <textarea
                  value={form.applicant.coverLetterBase}
                  onChange={(e) => setForm({
                    ...form,
                    applicant: { ...form.applicant, coverLetterBase: e.target.value },
                  })}
                  rows={4}
                  placeholder="Your skills, experience, and why you're a great fit..."
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploading}
              className="rounded-xl bg-emerald-500 px-6 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {isEdit ? "Save Changes" : "Create Schedule"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}