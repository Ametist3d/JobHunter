import React from "react";

export default function LogsPanel(props: { logs: string[]; onClear: () => void }) {
  return (
    <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/30 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-slate-400">Logs</div>
        <button
          onClick={props.onClear}
          className="rounded-lg border border-slate-700 bg-slate-950/30 px-2 py-1 text-xs text-slate-200 hover:bg-slate-950/70"
          type="button"
        >
          Clear
        </button>
      </div>

      <div className="max-h-56 overflow-auto text-xs text-slate-200">
        {props.logs.length === 0 ? (
          <div className="text-slate-500">No logs yet.</div>
        ) : (
          <ul className="space-y-1">
            {props.logs.map((l, i) => (
              <li key={i} className="whitespace-pre-wrap">
                {l}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
