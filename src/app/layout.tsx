import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Menu RPG Web Lab",
  description: "JSON-driven menu RPG prototype (Next.js + Supabase)"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#060812", color: "#eaf0ff" }}>
        {children}
      </body>
    </html>
  );
}
