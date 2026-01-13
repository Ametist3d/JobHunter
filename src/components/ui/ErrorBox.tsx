import React from "react";

export default function ErrorBox({ text }: { text: string }) {
  return (
    <div className="mt-5 rounded-xl border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-200">
      {text}
    </div>
  );
}
