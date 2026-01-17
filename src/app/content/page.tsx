"use client";

import React from "react";
import ContentEditor from "@/ui/ContentEditor";

export default function ContentPage() {
  return (
    <div className="min-h-screen bg-ink-950">
      <div className="noise" />
      <ContentEditor />
    </div>
  );
}
