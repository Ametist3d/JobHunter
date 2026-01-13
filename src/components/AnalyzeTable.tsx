import React from "react";
import type { AnalyzeResultRow } from "../api";

export default function AnalyzeTable({ rows }: { rows: AnalyzeResultRow[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800">
      <div className="max-h-[360px] overflow-auto bg-slate-950/30">
        {rows.length === 0 ? (
          <div className="p-6 text-sm text-slate-400">No analysis yet.</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-950/70 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-3">Website</th>
                <th className="px-4 py-3">OK</th>
                <th className="px-4 py-3">Emails</th>
                <th className="px-4 py-3">Context</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const ctx = r.siteContext?.textSnippet || r.siteContext?.combinedSnippet || "";
                // Treat missing `ok` as success to avoid false negatives when backend doesn't include it.
                const isOk = r.ok !== false;
                return (
                  <tr key={idx} className="border-t border-slate-800/70 align-top">
                    <td className="px-4 py-3">
                      <a href={r.website} target="_blank" rel="noreferrer" className="text-emerald-300 hover:underline">
                        {r.website}
                      </a>
                    </td>
                    <td className="px-4 py-3">{isOk ? "✅" : "❌"}</td>
                    <td className="px-4 py-3">
                      {r.emails?.length ? (
                        <div className="space-y-1">
                          {r.emails.slice(0, 5).map((email, i) => (
                            <div key={i} className={i === 0 ? "text-emerald-300" : "text-slate-300"}>
                              {email}
                            </div>
                          ))}
                          {r.emails.length > 5 && (
                            <div className="text-slate-500 text-xs">+{r.emails.length - 5} more</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300">{ctx ? ctx.slice(0, 240) + "…" : "—"}</td>
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
