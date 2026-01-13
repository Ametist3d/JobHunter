import React from "react";
import StatCard from "./ui/StatCard";

type DiscoverStats = { total: number; uniqueDomains: number; withTitles: number };
type AnalyzeStats = { total: number; ok: number; failed: number; withEmail: number; withoutEmail: number };
type DraftStats = { total: number; ok: number; failed: number; contextMode: number; lightMode: number };

export default function StatsGrid(props: {
  discover: DiscoverStats;
  analyze: AnalyzeStats;
  drafts: DraftStats;
  model?: string;
  promptSha?: string;
}) {
  return (
    <>
      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatCard label="Leads found" value={props.discover.total} />
        <StatCard label="Unique domains" value={props.discover.uniqueDomains} />
        <StatCard label="With titles" value={props.discover.withTitles} />
      </div>

      {(props.model || props.promptSha) && (
        <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/30 p-3 text-xs text-slate-300">
          <div>
            <span className="text-slate-500">Model:</span> {props.model ?? "—"}
          </div>
          <div className="mt-1 break-all">
            <span className="text-slate-500">Prompt SHA:</span> {props.promptSha ?? "—"}
          </div>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-5">
        <StatCard label="Analyzed" value={props.analyze.total} />
        <StatCard label="OK" value={props.analyze.ok} />
        <StatCard label="Failed" value={props.analyze.failed} />
        <StatCard label="With email" value={props.analyze.withEmail} />
        <StatCard label="No email" value={props.analyze.withoutEmail} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-5">
        <StatCard label="Drafts" value={props.drafts.total} />
        <StatCard label="OK" value={props.drafts.ok} />
        <StatCard label="Failed" value={props.drafts.failed} />
        <StatCard label="Context" value={props.drafts.contextMode} />
        <StatCard label="Light" value={props.drafts.lightMode} />
      </div>
    </>
  );
}
