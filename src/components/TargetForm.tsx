import React from "react";
import type { CompanySize } from "../api";

export default function TargetForm(props: {
  region: string;
  setRegion: (v: string) => void;
  companySize: CompanySize;
  setCompanySize: (v: CompanySize) => void;
  marketDomain: string;
  setMarketDomain: (v: string) => void;
  limit: number;
  setLimit: (v: number) => void;

  onSearch: () => void;
  onAnalyze: () => void;
  onGenerateEmails: () => void;
  onDownload: () => void;

  canSearch: boolean;
  canAnalyze: boolean;
  canGenerate: boolean;
  canDownload: boolean;
  busy: boolean;
  elapsedSeconds: number;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/20 p-4">
      <h2 className="text-lg font-semibold">Target parameters</h2>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="md:col-span-2">
          <label className="text-sm text-slate-300">Region</label>
          <input
            value={props.region}
            onChange={(e) => props.setRegion(e.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-emerald-400"
          />
        </div>

        <div>
          <label className="text-sm text-slate-300">Company size</label>
          <select
            value={props.companySize}
            onChange={(e) => props.setCompanySize(e.target.value as CompanySize)}
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-emerald-400"
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </div>

        <div>
          <label className="text-sm text-slate-300">Max results</label>
          <input
            type="number"
            value={props.limit}
            min={10}
            max={500}
            onChange={(e) => props.setLimit(parseInt(e.target.value || "0", 10))}
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-emerald-400"
          />
          <div className="mt-1 text-xs text-slate-400">10–500</div>
        </div>

        <div className="md:col-span-4">
          <label className="text-sm text-slate-300">Market domain</label>
          <input
            value={props.marketDomain}
            onChange={(e) => props.setMarketDomain(e.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-emerald-400"
          />
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-3 md:flex-row">
          <button
            onClick={props.onSearch}
            disabled={!props.canSearch}
            className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-4 py-2 font-medium text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Search companies
          </button>

          <button
            onClick={props.onAnalyze}
            disabled={!props.canAnalyze}
            className="inline-flex items-center justify-center rounded-xl bg-sky-400 px-4 py-2 font-medium text-slate-950 hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Analyze contacts
          </button>

          <button
            onClick={props.onGenerateEmails}
            disabled={!props.canGenerate}
            className="inline-flex items-center justify-center rounded-xl bg-violet-400 px-4 py-2 font-medium text-slate-950 hover:bg-violet-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Generate emails
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={props.onDownload}
            disabled={!props.canDownload}
            className="rounded-xl border border-slate-700 bg-slate-950/40 px-4 py-2 text-sm text-slate-100 hover:bg-slate-950/70 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download CSV
          </button>
          <div className="text-xs text-slate-400">Exports: website, title, snippet, source</div>
        </div>
      </div>

      {props.busy && (
        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-emerald-500" />
          </div>
          <div className="mt-2 text-xs text-slate-400">Working… {props.elapsedSeconds.toFixed(1)}s</div>
        </div>
      )}
    </div>
  );
}
