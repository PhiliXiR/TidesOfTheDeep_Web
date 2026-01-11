# Menu RPG Web Lab (Next.js + Supabase)

Minimal scaffold for a JSON-driven menu RPG prototype with:
- Supabase Auth (email/password)
- Postgres tables: runs, run_state, content
- API routes: /api/run/new, /api/run/latest, /api/run/save, /api/content
- Basic UI on the home page to Sign in, Create Run, Load Latest, Save (advance turn), and view Content.

## 1) Prereqs
- Node.js (LTS recommended)

## 2) Install
```bash
npm install
```

## 3) Configure env
Copy `.env.local.example` to `.env.local` and fill:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 4) Run dev
```bash
npm run dev
```
Open http://localhost:3000

## 5) Create DB tables in Supabase
Run the SQL in `supabase/schema.sql` inside Supabase SQL Editor.

## 6) Seed content
Insert a row into `content` table:
- key: `combat_core`
- json: your combat config JSON

Then click **Load Latest Run** to fetch it.

---

Next: Plug your full CombatMenu UI into `src/app/page.tsx` and autosave state on every action.
