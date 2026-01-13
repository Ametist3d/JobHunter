import React from "react";

export default function SenderForm(props: {
  studioName: string;
  setStudioName: (v: string) => void;
  yourName: string;
  setYourName: (v: string) => void;
  baseOffer: string;
  setBaseOffer: (v: string) => void;
}) {
  return (
    <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/20 p-4">
      <div className="text-sm font-semibold">Sender settings (Step 3)</div>

      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <label className="text-sm text-slate-300">Studio name</label>
          <input
            value={props.studioName}
            onChange={(e) => props.setStudioName(e.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-violet-300"
          />
        </div>

        <div>
          <label className="text-sm text-slate-300">Your name</label>
          <input
            value={props.yourName}
            onChange={(e) => props.setYourName(e.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-violet-300"
          />
        </div>

        <div className="md:col-span-3">
          <label className="text-sm text-slate-300">Offer (1–2 sentences)</label>
          <textarea
            value={props.baseOffer}
            onChange={(e) => props.setBaseOffer(e.target.value)}
            rows={3}
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-violet-300"
          />
        </div>
      </div>
    </div>
  );
}
