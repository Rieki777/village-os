/**
 * Loading the submissions list, and the words for when it fails.
 *
 * A code such as `auth_required` is not a sentence. This turns a refusal
 * into words a person can act on, and leaves a real sentence from the server
 * as it is.
 */
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";
import { storedText } from "@/lib/safeStorage";

/** Same key the header uses for the handled-today count. */
const HANDLED_KEY = "admin.handledToday";

export function handledOnThisDevice(now = new Date()): number {
  const raw = storedText("local", HANDLED_KEY);
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as { day?: unknown; count?: unknown };
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    if (parsed.day !== day || typeof parsed.count !== "number" || parsed.count < 1) return 0;
    return Math.floor(parsed.count);
  } catch {
    return 0;
  }
}

export function plainLoadProblem(status: number, body: unknown): string {
  if (status === 401 || status === 403) return "You need to sign in again before this list will open.";
  const said = refusal(body, "").trim();
  if (said && /\s/.test(said) && said.length < 180) return said;
  if (status === 0) return "The list did not load. Check your connection and try again.";
  return "The list did not load. Try again in a moment.";
}

export async function loadSubmissionRows(password: string, filter: string): Promise<{ rows: any[]; problem: string | null }> {
  const url = filter === "all" ? `${API_BASE}/admin/submissions` : `${API_BASE}/admin/submissions?type=${encodeURIComponent(filter)}`;
  try {
    const res = await fetch(url, { headers: authHeaders(password) });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { rows: [], problem: plainLoadProblem(res.status, data) };
    return { rows: Array.isArray(data) ? data : [], problem: null };
  } catch {
    return { rows: [], problem: plainLoadProblem(0, null) };
  }
}
