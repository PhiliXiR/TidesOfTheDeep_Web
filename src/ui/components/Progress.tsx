"use client";

import React from "react";

type Props = {
  label: string;
  value: number;
  max: number;
  tone?: "neon" | "aqua";
};

export function Progress({ label, value, max, tone = "neon" }: Props) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  const fillClass = tone === "aqua" ? "bar-fill bar-fill--aqua" : "bar-fill bar-fill--neon";

  return (
    <div className="grid" style={{ gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="label">{label}</span>
        <span className="mono subtle">
          {value}/{max}
        </span>
      </div>
      <div className="bar">
        <div className={fillClass} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default Progress;
