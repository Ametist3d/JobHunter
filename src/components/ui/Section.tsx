import React from "react";

export default function Section(props: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <div className="flex items-end justify-between">
        <h3 className="text-lg font-semibold">{props.title}</h3>
        <div className="text-xs text-slate-400">{props.subtitle}</div>
      </div>
      <div className="mt-3">{props.children}</div>
    </div>
  );
}
