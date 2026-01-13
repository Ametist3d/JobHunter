import React, { useState } from "react";
import type { SendResultRow, EmailValidationResult } from "../api";
import type { EditableDraft } from "./DraftEditorModal";

export default function DraftTable(props: {
  rows: EditableDraft[];
  sendResultsById: Record<string, SendResultRow | undefined>;
  onToggleDisabled: (id: string, disabled: boolean) => void;
  onEdit: (id: string) => void;

  emailsPerCompany: number;
  onEmailsPerCompanyChange: (n: number) => void;
}) {
  const [validationResults, setValidationResults] = useState<Record<string, EmailValidationResult>>({});
  const [validating, setValidating] = useState(false);

  async function validateAllEmails() {
    setValidating(true);

    try {
      const allEmails = props.rows.flatMap((r) => r.emails);
      const unique = [...new Set(allEmails)].filter(Boolean);

      if (unique.length === 0) {
        setValidating(false);
        return;
      }

      const res = await fetch("/api/validate-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: unique, skipSmtp: true }),
      });

      const data = await res.json();

      if (data.ok && Array.isArray(data.results)) {
        const byEmail: Record<string, EmailValidationResult> = {};
        data.results.forEach((r: EmailValidationResult) => {
          byEmail[r.email] = r;
        });
        setValidationResults(byEmail);
      }
    } catch (e) {
      console.error("Validation failed:", e);
    } finally {
      setValidating(false);
    }
  }

  // Stats
  const totalEmails = props.rows.reduce((sum, r) => sum + r.emails.length, 0);
  const validatedCount = Object.keys(validationResults).length;
  const lowRisk = Object.values(validationResults).filter((r) => r.risk === "low").length;
  const mediumRisk = Object.values(validationResults).filter((r) => r.risk === "medium").length;
  const highRisk = Object.values(validationResults).filter((r) => r.risk === "high").length;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>Emails / company</span>
          <input
            type="number"
            min={1}
            max={5}
            value={props.emailsPerCompany}
            onChange={(e) => {
              const n = Math.max(1, Math.min(5, parseInt(e.target.value || "1", 10)));
              props.onEmailsPerCompanyChange(n);
            }}
            className="w-16 rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1 text-slate-100"
            title="Limit how many recipients each company will have"
          />
        </div>

        <button
          onClick={validateAllEmails}
          disabled={validating || totalEmails === 0}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {validating ? "Validating..." : "Validate Emails"}
        </button>
      </div>


      <div className="max-h-[480px] overflow-auto bg-slate-950/30">
        {props.rows.length === 0 ? (
          <div className="p-6 text-sm text-slate-400">No drafts yet.</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-950/70 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-3 w-[90px]">Send</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Recipients</th>
                <th className="px-4 py-3 w-[120px]">Status</th>
                <th className="px-4 py-3 w-[90px]">Edit</th>
              </tr>
            </thead>
            <tbody>
              {props.rows.map((d) => {
                const r = props.sendResultsById[d.id];
                const ok = r?.ok;
                const isDry = r?.dryRun;
                const skippedDup = r?.dedupeSkipped;
                const statusText = !r
                  ? "—"
                  : skippedDup
                    ? "Duplicate"
                    : ok && isDry
                      ? "Dry-run OK"
                      : ok && !isDry
                        ? "Sent"
                        : "Error";

                const statusColor =
                  !r ? "text-slate-500"
                  : skippedDup ? "text-amber-300"
                  : ok ? "text-emerald-300"
                  : "text-red-300";
                const hasHighRisk = d.emails.some(
                  (e) => validationResults[e]?.risk === "high"
                );
                
                return (
                  <tr key={d.id} className="border-t border-slate-800/70 align-top">
                    <td className="px-4 py-3">
                      <label className="flex items-center gap-2 text-sm text-slate-200">
                        <input
                          type="checkbox"
                          checked={!d.disabled}
                          onChange={(e) => props.onToggleDisabled(d.id, !e.target.checked)}
                        />
                        <span className="text-xs text-slate-400">{d.disabled ? "Off" : "On"}</span>
                      </label>
                    </td>

                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <a
                          href={d.website}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-300 hover:underline"
                        >
                          {new URL(d.website).hostname}
                        </a>
                        <div className="text-slate-400 text-xs truncate max-w-[180px]">{d.subject || "—"}</div>
                        {r?.error && <div className="text-xs text-red-300">{r.error}</div>}
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        {d.emails.map((email, i) => {
                          const v = validationResults[email];
                          const riskIcon = !v
                            ? "○"
                            : v.risk === "low"
                              ? "✓"
                              : v.risk === "medium"
                                ? "⚠"
                                : "✕";
                          const riskColor = !v
                            ? "text-slate-500"
                            : v.risk === "low"
                              ? "text-emerald-400"
                              : v.risk === "medium"
                                ? "text-amber-400"
                                : "text-red-400";

                          return (
                            <div
                              key={i}
                              className={`flex items-center gap-2 ${i > 0 ? "text-xs" : "text-sm"}`}
                              title={v?.reason || "Not validated"}
                            >
                              <span className={`${riskColor} w-4`}>{riskIcon}</span>
                              <span className={i === 0 ? "text-slate-200" : "text-slate-400"}>
                                {email}
                              </span>
                              {v?.checks?.isRoleBased && (
                                <span className="text-[10px] text-amber-500 bg-amber-500/10 px-1 rounded">
                                  role
                                </span>
                              )}
                              {v?.checks?.isCatchAll && (
                                <span className="text-[10px] text-blue-400 bg-blue-500/10 px-1 rounded">
                                  catch-all
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </td>

                    <td className={`px-4 py-3 ${statusColor}`}>
                      {statusText}
                    </td>

                    <td className="px-4 py-3">
                      <button
                        onClick={() => props.onEdit(d.id)}
                        className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-900/70"
                        type="button"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
