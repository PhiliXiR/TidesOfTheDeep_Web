"use client";

import React from "react";

type Props = {
  className?: string;
  children: React.ReactNode;
};

export function Card({ className = "", children }: Props) {
  return (
    <div
      className={[
        "relative rounded-2xl",
        // outer frame
        "border border-neon-500/14 bg-black/22",
        "shadow-[0_0_22px_rgba(79,125,255,0.10)]",
        // inner bevel
        "before:absolute before:inset-[1px] before:rounded-[15px]",
        "before:border before:border-white/8 before:pointer-events-none",
        // faint top sheen
        "after:absolute after:inset-0 after:rounded-2xl after:pointer-events-none",
        "after:bg-gradient-to-b after:from-white/7 after:to-transparent after:opacity-60",
        className
      ].join(" ")}
    >
      {/* subtle grain */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl opacity-[0.06] mix-blend-overlay bg-[radial-gradient(circle_at_20%_10%,white,transparent_35%),radial-gradient(circle_at_80%_30%,white,transparent_40%)]" />
      <div className="relative">{children}</div>
    </div>
  );
}

export default Card;
