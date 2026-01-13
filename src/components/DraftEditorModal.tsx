import React, { useEffect, useState } from "react";

export type EditableDraft = {
  id: string;
  website: string;
  emails: string[];  // Array, not string
  subject: string;
  body: string;
  mode?: "context" | "light";
  disabled?: boolean;
};

export default function DraftEditorModal(props: {
  open: boolean;
  draft: EditableDraft | null;
  onClose: () => void;
  onSave: (updated: EditableDraft) => void;
}) {
  const [local, setLocal] = useState<EditableDraft | null>(props.draft);

  useEffect(() => {
    setLocal(props.draft);
  }, [props.draft]);

  if (!props.open || !local) return null;

  // Join emails for editing, split on save
  const emailsText = local.emails.join(", ");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-3xl rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 p-4">
          <div>
            <div className="text-sm font-semibold">Edit draft</div>
            <a
              href={local.website}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block text-xs text-emerald-300 hover:underline"
            >
              {local.website}
            </a>
          </div>
          <button
            onClick={props.onClose}
            className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-900/70"
            type="button"
          >
            Close
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="md:col-span-1">
              <label className="text-sm text-slate-300">To (comma-separated)</label>
              <textarea
                value={emailsText}
                onChange={(e) => setLocal({ 
                  ...local, 
                  emails: e.target.value.split(",").map(s => s.trim()).filter(Boolean)
                })}
                rows={2}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2 text-slate-100 outline-none focus:border-violet-300"
              />
              <div className="mt-1 text-xs text-slate-500">{local.emails.length} recipient(s)</div>
            </div>

            <div className="md:col-span-2">
              <label className="text-sm text-slate-300">Subject</label>
              <input
                value={local.subject}
                onChange={(e) => setLocal({ ...local, subject: e.target.value })}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2 text-slate-100 outline-none focus:border-violet-300"
              />
            </div>
          </div>

          <div>
            <label className="text-sm text-slate-300">Body</label>
            <textarea
              value={local.body}
              onChange={(e) => setLocal({ ...local, body: e.target.value })}
              rows={14}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2 text-slate-100 outline-none focus:border-violet-300"
            />
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={Boolean(local.disabled)}
                onChange={(e) => setLocal({ ...local, disabled: e.target.checked })}
              />
              Disable this draft (skip sending)
            </label>

            <div className="flex gap-2">
              <button
                onClick={props.onClose}
                className="rounded-xl border border-slate-700 bg-slate-900/40 px-4 py-2 text-sm text-slate-100 hover:bg-slate-900/70"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={() => props.onSave(local)}
                className="rounded-xl bg-violet-400 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-violet-300"
                type="button"
              >
                Save changes
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
