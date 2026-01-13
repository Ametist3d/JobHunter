import React, { useState } from "react";
import {
  analyzeLeads,
  discoverJobs,
  exportLeadsCsv,
  generateApplications,
  sendApplications,
  prefilterLeads,  
  type CompanySize,
  type JobLead,
  type AnalyzeResultRow,
  type SendResultRow,
  type SearchProvider,
} from "../api";

import Section from "../components/ui/Section";
import ErrorBox from "../components/ui/ErrorBox";
import StatCard from "../components/ui/StatCard";
import LogsPanel from "../components/LogsPanel";
import LeadTable from "../components/LeadTable";
import AnalyzeTable from "../components/AnalyzeTable";
import DraftTable from "../components/DraftTable";
import DraftEditorModal, { type EditableDraft } from "../components/DraftEditorModal";
import JobSchedulesPanel from "../components/JobSchedulesPanel";

function nowTime() {
  return new Date().toLocaleTimeString();
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function uniqByDomain(leads: JobLead[]): JobLead[] {
  const seen = new Set<string>();
  return leads.filter((l) => {
    const h = safeHostname(l.website);
    if (!h || seen.has(h)) return false;
    seen.add(h);
    return true;
  });
}

function makeId(website: string, to: string, idx: number) {
  return `${idx}::${website}::${to}`.slice(0, 200);
}

export default function JobSearchPage() {
  // Search params
  const [region, setRegion] = useState("Germany");
  const [position, setPosition] = useState("3D Artist");
  const [industry, setIndustry] = useState("");
  const [companySize, setCompanySize] = useState<CompanySize>("small");
  const [limit, setLimit] = useState(30);

  // Applicant info
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [coverLetterBase, setCoverLetterBase] = useState("");
  const [cvFilename, setCvFilename] = useState("");
  const [cvFile, setCvFile] = useState<File | null>(null);

  // State
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [emailsPerCompany, setEmailsPerCompany] = useState(1);
  
  const [providers, setProviders] = useState<SearchProvider[]>(["gemini"]);

  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const [leads, setLeads] = useState<JobLead[]>([]);
  const [analysis, setAnalysis] = useState<AnalyzeResultRow[]>([]);
  const [drafts, setDrafts] = useState<EditableDraft[]>([]);
  const [sendResults, setSendResults] = useState<Record<string, SendResultRow | undefined>>({});

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const busy = loading || analyzing || generating || sending;

  function log(msg: string) {
    setLogs((prev) => [...prev, `[${nowTime()}] ${msg}`]);
  }

  function applyEmailsPerCompany(n: number) {
    setEmailsPerCompany(n);
    setDrafts((prev) =>
      prev.map((d) => ({ ...d, emails: (d.emails || []).slice(0, n) }))
    );
  }

  const enabledDrafts = drafts.filter((d) => !d.disabled && d.emails.length > 0 && d.subject && d.body);

  function toggleProvider(p: SearchProvider) {
    setProviders(prev => 
      prev.includes(p) 
        ? prev.filter(x => x !== p)
        : [...prev, p]
    );
  }

  async function handleCvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!file.name.endsWith('.pdf')) {
        setError('Please upload a PDF file');
        return;
    }
    
    setCvFile(file);
    setCvFilename(file.name);
    
    // Upload to server
    const formData = new FormData();
    formData.append('cv', file);
    
    try {
        const res = await fetch('/api/upload-cv', {
        method: 'POST',
        body: formData,
        });
        const data = await res.json();
        if (data.ok) {
        log(`CV uploaded: ${file.name}`);
        } else {
        setError(data.error || 'Upload failed');
        }
    } catch (err: any) {
        setError(err.message);
    }
    }

  // Search
  async function onSearch() {
    setLoading(true);
    setError(null);
    setLeads([]);
    setAnalysis([]);
    setDrafts([]);

    try {
      log(`Searching with: ${providers.join(", ")}...`);
      const res = await discoverJobs({
        region: region.trim(),
        position: position.trim(),
        industry: industry.trim() || undefined,
        companySize,
        limit,
        providers,
      });

      setLeads(res.leads);
      
      // Log per-provider results
      Object.entries(res.byProvider).forEach(([p, data]) => {
        log(`  ${p}: ${data.count} leads`);
      });
      log(`Total: ${res.stats.total} → ${res.stats.unique} unique (${res.stats.duplicatesRemoved} duplicates removed)`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Analyze
  async function onAnalyze() {
    setAnalyzing(true);
    setError(null);
    setAnalysis([]);

    try {
      const unique = uniqByDomain(leads);

      // Step 1: Prefilter
      log(`Prefiltering ${unique.length} companies with DeepSeek...`);
      const prefilterRes = await prefilterLeads({
        websites: unique.map(l => l.website),
        position: position.trim(),
      });

      const validLeads = prefilterRes.results
        .filter(r => r.isCompany && r.hasOpenJobs)
        .map(r => {
          const original = unique.find(l => l.website === r.website);
          return {
            ...original!,
            careersUrl: r.careersUrl,  // Direct careers URL
          };
        })
        .filter(Boolean);

      log(`Prefilter: ${unique.length} → ${validLeads.length} valid (${prefilterRes.stats.filtered} filtered out)`);

      if (validLeads.length === 0) {
        setAnalysis([]);
        return;
      }

      // Step 2: Crawl valid companies
      log(`Crawling ${validLeads.length} companies for HR contacts...`);
      const res = await analyzeLeads({
        leads: validLeads,
        position: position.trim(),
        maxSites: validLeads.length,
        timeoutMs: 15000,
        maxPages: 10,
      });

      setAnalysis(res.results);
      log(`Found ${res.stats.withEmail} with HR contacts`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAnalyzing(false);
    }
  }
  
  function pickTopEmails(emails: string[], max = 3): string[] {
    const scored = emails.map(email => {
      const e = email.toLowerCase();
      let score = 0;

      // Highest priority
      if (e.includes("hr")) score += 100;
      if (e.includes("career")) score += 90;
      if (e.includes("jobs")) score += 85;
      if (e.includes("hiring")) score += 80;
      if (e.includes("recruit")) score += 75;

      // Generic but acceptable
      if (e.startsWith("info@")) score += 40;
      if (e.startsWith("contact@")) score += 35;
      if (e.startsWith("office@")) score += 30;

      // Personal emails (usually worse)
      if (/^[a-z]+\.[a-z]+@/.test(e)) score -= 10;

      return { email, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, max)
      .map(x => x.email);
  }
  // Generate
  function isLikelyValidContactEmail(email: string): boolean {
    const e = email.toLowerCase();
    
    // Skip obvious system/noreply emails
    const skipPrefixes = [
      "noreply", "no-reply", "no_reply",
      "donotreply", "do-not-reply",
      "mailer-daemon", "postmaster",
      "bounce", "unsubscribe",
    ];
    
    if (skipPrefixes.some(p => e.startsWith(p))) return false;
    
    // Skip if domain looks like tracking/system
    const skipDomains = [
      "sentry.io", "mailchimp", "sendgrid", "mailgun",
      "amazonses", "postmarkapp", "intercom",
    ];
    
    if (skipDomains.some(d => e.includes(d))) return false;
    
    return true;
  }

  
  async function onGenerate() {
    setGenerating(true);
    setError(null);
    setDrafts([]);
    setSendResults({});

    try {
      if (!fullName.trim() || !coverLetterBase.trim()) {
        throw new Error("Please fill your name and cover letter base");
      }

      // ONE target per COMPANY (not per email)
      const targets = analysis
        .filter((r) => r.ok !== false && (r.emails?.length ?? 0) > 0)
        .map((r) => {
          const validEmails = pickTopEmails(
            r.emails!.filter(email => isLikelyValidContactEmail(email)),
            3 // ← change to 2 if you want stricter
          );
          return {
            website: r.website,
            companyName: (r as any).companyName,
            jobTitle: (r as any).jobTitle,
            to: validEmails[0],  // First email for generation
            allEmails: validEmails,  // Keep all for sending
            siteContext: r.siteContext || undefined,
          };
        })
        .filter((t) => t.website && t.to);

      log(`Generating applications for ${targets.length} companies...`);

      const res = await generateApplications({
        applicant: {
          fullName: fullName.trim(),
          phone: phone.trim() || undefined,
          portfolioUrl: portfolioUrl.trim() || undefined,
          coverLetterBase: coverLetterBase.trim(),
        },
        position: position.trim(),
        targets,
      });

      const editable: EditableDraft[] = res.results
        .filter((x) => x.ok)
        .map((x, idx) => ({
          id: makeId(x.website, targets[idx]?.allEmails?.[0] || "", idx),
          website: x.website,
          emails: (targets[idx]?.allEmails || [x.to || ""]).slice(0, emailsPerCompany),
          subject: x.subject || "",
          body: x.body || "",
          disabled: false,
        }));

      setDrafts(editable);
      
      const totalEmails = editable.reduce((sum, d) => sum + d.emails.length, 0);
      log(`Generated ${editable.length} drafts → ${totalEmails} total recipients`);
    } catch (e: any) {
      setError(e.message);
      log(`ERROR: ${e.message}`);
    } finally {
      setGenerating(false);
    }
  }


// Fix onDryRun - expand to all emails:
async function onDryRun() {
  setSending(true);
  setError(null);

  try {
    const items = enabledDrafts.flatMap((d) =>
      d.emails.map((email) => ({
        website: d.website,
        to: email,
        subject: d.subject,
        body: d.body,
      }))
    );

    log(`Dry-run: ${enabledDrafts.length} companies → ${items.length} emails...`);

    const res = await sendApplications({ dryRun: true, items });

    // Map results back to draft IDs (simplified - mark draft OK if any email OK)
    const byId: Record<string, SendResultRow> = {};
    let i = 0;
    for (const d of enabledDrafts) {
      const draftResults = res.results.slice(i, i + d.emails.length);
      i += d.emails.length;
      // Use first result as representative
      if (draftResults[0]) byId[d.id] = draftResults[0];
    }
    setSendResults((prev) => ({ ...prev, ...byId }));

    log(`Dry-run: ${res.stats.dryRunOk} OK, ${res.stats.failed} failed`);
  } catch (e: any) {
    setError(e.message);
  } finally {
    setSending(false);
  }
}

// Send real
async function onSendReal() {
  setSending(true);
  setError(null);

  try {
    const items = enabledDrafts.flatMap((d) =>
      d.emails.map((email) => ({
        website: d.website,
        to: email,
        subject: d.subject,
        body: d.body,
      }))
    );

    log(`Sending ${enabledDrafts.length} companies → ${items.length} emails...`);

    const res = await sendApplications({
      dryRun: false,
      delayMs: 2000,
      cvFilename: cvFilename.trim() || undefined,
      region: region.trim(),
      items,
    });

    const byId: Record<string, SendResultRow> = {};
    let i = 0;
    for (const d of enabledDrafts) {
      const draftResults = res.results.slice(i, i + d.emails.length);
      i += d.emails.length;
      if (draftResults[0]) byId[d.id] = draftResults[0];
    }
    setSendResults((prev) => ({ ...prev, ...byId }));

    log(`Sent: ${res.stats.sent}, Failed: ${res.stats.failed}, Dups: ${res.stats.skippedDuplicates}`);
  } catch (e: any) {
    setError(e.message);
  } finally {
    setSending(false);
  }
}
  

  const editingDraft = drafts.find((d) => d.id === editingId) || null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-slate-100">
      <div className="mx-auto max-w-5xl px-6 py-10">
        {/* Header */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-800/60 px-3 py-1 text-xs">
            <span className={`h-2 w-2 rounded-full ${busy ? "bg-amber-400" : "bg-emerald-400"}`} />
            Search → Analyze → Draft → Validate → Apply
          </div>
          <h1 className="mt-4 text-4xl font-semibold">JobHunter</h1>
          <p className="mt-2 text-slate-400">Automated job search and application system</p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
          {/* Search Form */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/20 p-4">
            <h2 className="text-lg font-semibold mb-4">Job Search</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-2">
                <label className="text-sm text-slate-300">Position</label>
                <input
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  placeholder="e.g., 3D Artist, Unity Developer"
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm text-slate-300">Region</label>
                <input
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100"
                />
              </div>
              <div className="md:col-span-4">
                <label className="text-sm text-slate-300">Search Providers</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(["gemini", "perplexity", "deepseek"] as SearchProvider[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => toggleProvider(p)}
                      className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        providers.includes(p)
                          ? "bg-emerald-500 text-slate-950"
                          : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                      }`}
                    >
                      {p === "gemini" && "🔍 Gemini"}
                      {p === "perplexity" && "🌐 Perplexity"}
                      {p === "deepseek" && "🤖 DeepSeek"}
                    </button>
                  ))}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {providers.length === 0 
                    ? "⚠ Select at least one provider" 
                    : `${providers.length} provider(s) selected → results merged & deduplicated`
                  }
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="text-sm text-slate-300">Industry (optional)</label>
                <input
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  placeholder="e.g., gaming, architecture, product"
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100"
                />
              </div>
              <div>
                <label className="text-sm text-slate-300">Company Size</label>
                <select
                  value={companySize}
                  onChange={(e) => setCompanySize(e.target.value as CompanySize)}
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100"
                >
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-300">Max Results</label>
                <input
                  type="number"
                  value={limit}
                  onChange={(e) => setLimit(parseInt(e.target.value) || 30)}
                  min={10}
                  max={100}
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100"
                />
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={onSearch}
                disabled={busy || !position.trim() || !region.trim()}
                className="rounded-xl bg-emerald-500 px-4 py-2 font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                Search Jobs
              </button>
              <button
                onClick={onAnalyze}
                disabled={busy || leads.length === 0}
                className="rounded-xl bg-sky-400 px-4 py-2 font-medium text-slate-950 hover:bg-sky-300 disabled:opacity-50"
              >
                Prefilter and Analyze
              </button>
              <button
                onClick={onGenerate}
                disabled={busy || analysis.filter((r) => r.emails?.length).length === 0}
                className="rounded-xl bg-violet-400 px-4 py-2 font-medium text-slate-950 hover:bg-violet-300 disabled:opacity-50"
              >
                Generate Applications
              </button>
              <button
                onClick={() => exportLeadsCsv(`jobs_${region}_${position}.csv`, leads)}
                disabled={leads.length === 0}
                className="rounded-xl border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
              >
                Export CSV
              </button>
            </div>

            {busy && (
              <div className="mt-4">
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full w-1/2 animate-pulse rounded-full bg-emerald-500" />
                </div>
                <div className="mt-2 text-xs text-slate-400">Working...</div>
              </div>
            )}
          </div>

          {error && <ErrorBox text={error} />}

          {/* Stats */}
          <div className="mt-6 grid grid-cols-4 gap-3">
            <StatCard label="Companies Found" value={leads.length} />
            <StatCard label="With HR Email" value={analysis.filter((r) => r.emails?.length).length} />
            <StatCard label="Drafts Ready" value={drafts.length} />
            <StatCard label="Sent" value={Object.values(sendResults).filter((r) => r?.ok && !r.dryRun).length} />
          </div>

          {/* Applicant Form */}
          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/20 p-4">
            <h3 className="text-sm font-semibold mb-3">Your Application Info</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-slate-300">Full Name *</label>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100"
                />
              </div>
              <div>
                <label className="text-sm text-slate-300">Phone</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100"
                />
              </div>
              <div>
                <label className="text-sm text-slate-300">Portfolio URL</label>
                <input
                  value={portfolioUrl}
                  onChange={(e) => setPortfolioUrl(e.target.value)}
                  placeholder="https://..."
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100"
                />
              </div>
              <div>
                <label className="text-sm text-slate-300">CV (PDF)</label>
                <div className="mt-2 flex gap-2">
                    <input
                    type="text"
                    value={cvFilename}
                    readOnly
                    placeholder="No file selected"
                    className="flex-1 rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100"
                    />
                    <label className="cursor-pointer rounded-xl bg-slate-700 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600">
                    Browse
                    <input
                        type="file"
                        accept=".pdf"
                        onChange={handleCvUpload}
                        className="hidden"
                    />
                    </label>
                </div>
                {cvFile && (
                    <div className="mt-1 text-xs text-emerald-400">✓ {cvFile.name} ready</div>
                )}
              </div>
              <div className="md:col-span-2">
                <label className="text-sm text-slate-300">Cover Letter Base *</label>
                <textarea
                  value={coverLetterBase}
                  onChange={(e) => setCoverLetterBase(e.target.value)}
                  rows={4}
                  placeholder="Your key skills, experience, and what makes you a great candidate..."
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100"
                />
              </div>
            </div>
          </div>

          {/* Results */}
          <Section title="Found Companies" subtitle={`${leads.length} results`}>
            <LeadTable leads={leads} />
          </Section>

          <Section title="HR Contacts" subtitle={`${analysis.filter((r) => r.emails?.length).length} with email`}>
            <AnalyzeTable rows={analysis} />
          </Section>

          <Section title="Application Drafts" subtitle={`${drafts.length} drafts`}>
            <div className="mb-3 flex justify-between items-center">
              <div className="text-xs text-slate-400">
                Validate with dry-run first, then send real applications
              </div>
              <div className="flex gap-2">
                <button
                  onClick={onDryRun}
                  disabled={busy || enabledDrafts.length === 0}
                  className="rounded-xl bg-amber-300 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-amber-200 disabled:opacity-50"
                >
                  Dry-run
                </button>
                <button
                  onClick={onSendReal}
                  disabled={busy || enabledDrafts.length === 0}
                  className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                >
                  Send Applications
                </button>
              </div>
            </div>
            <DraftTable
              rows={drafts}
              sendResultsById={sendResults}
              onToggleDisabled={(id, disabled) =>
                setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, disabled } : d)))
              }
              onEdit={(id) => {
                setEditingId(id);
                setEditorOpen(true);
              }}
              emailsPerCompany={emailsPerCompany}
              onEmailsPerCompanyChange={applyEmailsPerCompany}
            />
          </Section>

          <LogsPanel logs={logs} onClear={() => setLogs([])} />
        </div>
        <JobSchedulesPanel />
      </div>

      <DraftEditorModal
        open={editorOpen}
        draft={editingDraft}
        onClose={() => {
          setEditorOpen(false);
          setEditingId(null);
        }}
        onSave={(updated) => {
          setDrafts((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
          setSendResults((prev) => {
            const copy = { ...prev };
            delete copy[updated.id];
            return copy;
          });
          setEditorOpen(false);
          setEditingId(null);
        }}
      />

    </div>
  );
}