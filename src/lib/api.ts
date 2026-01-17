import { supabase } from "@/lib/supabaseClient";

async function getToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function authedFetch(input: RequestInfo, init?: RequestInit) {
  const token = await getToken();
  if (!token) throw new Error("Not logged in");

  const headers = new Headers(init?.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json");

  return fetch(input, { ...init, headers });
}

export async function createRun(title: string, initialState: any) {
  const res = await authedFetch("/api/run/new", {
    method: "POST",
    body: JSON.stringify({ title, initialState })
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as Promise<{ run: any }>;
}

export async function loadLatestRun() {
  const res = await authedFetch("/api/run/latest", { method: "GET" });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as Promise<{ run: any | null; state: any | null }>;
}

export async function saveRun(runId: string, state: any) {
  const res = await authedFetch("/api/run/save", {
    method: "POST",
    body: JSON.stringify({ runId, state })
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as Promise<{ ok: true }>;
}

type ContentMeta = {
  writeAllowed?: boolean;
  writeMode?: string;
};

export async function loadContent(keys: string[]): Promise<{ content: Record<string, any> }>;
export async function loadContent(
  keys: string[],
  opts: { includeMeta: true }
): Promise<{ content: Record<string, any>; meta?: ContentMeta }>;
export async function loadContent(keys: string[], opts?: { includeMeta?: boolean }) {
  const qs = encodeURIComponent(keys.join(","));
  const res = await authedFetch(`/api/content?keys=${qs}`, { method: "GET" });
  if (!res.ok) throw new Error(await res.text());
  const json = (await res.json()) as { content: Record<string, any>; meta?: ContentMeta };
  return opts?.includeMeta ? json : ({ content: json.content } as { content: Record<string, any> });
}

export async function saveContent(key: string, json: any) {
  const res = await authedFetch("/api/content", {
    method: "POST",
    body: JSON.stringify({ key, json })
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as Promise<{ ok: true }>;
}
