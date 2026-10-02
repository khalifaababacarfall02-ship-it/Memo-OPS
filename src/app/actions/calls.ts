"use server";
// Home page "Mes prochains appels": connect / disconnect the person's calendar,
// and prepare the memo of a calendar event (public.create_call_memo: the memo,
// its call and its people in one go, as the signed-in person).
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { isValidEmail, normalizeEmail } from "@/lib/auth/allowed-email";
import { getViewer } from "@/lib/auth/viewer";
import { loginPath } from "@/lib/auth/redirect";
import { CalendarFetchError, fetchCalendar } from "@/lib/calendar/fetch";
import { IcsError, upcomingEvents } from "@/lib/calendar/ics";
import { type CalendarLinkError, normalizeCalendarUrl } from "@/lib/calendar/link";
import { isTeam, kindOf } from "@/lib/content";
import { getLang } from "@/lib/i18n";
import { canCreateIn } from "@/lib/memo/editor/types";
import { blankContent } from "@/lib/memo/model";
import { createClient } from "@/lib/supabase/server";

export type CalendarLinkState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; code: CalendarLinkError | "calUnreachable" | "calNotIcs" | "saveError" };

/** Checks the link (an allowed host that answers with a calendar), then stores it. */
export async function saveCalendarLink(_prev: CalendarLinkState, formData: FormData): Promise<CalendarLinkState> {
  const viewer = await getViewer();
  if (!viewer) redirect(loginPath("/"));
  const checked = normalizeCalendarUrl(formData.get("url"));
  if (!checked.ok) return { status: "error", code: checked.error };
  try {
    const now = Date.now();
    upcomingEvents(await fetchCalendar(checked.url, { fresh: true }), {
      from: new Date(now),
      to: new Date(now + 86_400_000),
      max: 1,
    });
  } catch (e) {
    if (e instanceof CalendarFetchError) return { status: "error", code: e.code };
    if (e instanceof IcsError) return { status: "error", code: "calNotIcs" };
    console.error("[calendar] check failed", e instanceof Error ? e.name : "unknown");
    return { status: "error", code: "calUnreachable" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("calendar_links")
    .upsert({ user_id: viewer.id, url: checked.url }, { onConflict: "user_id" });
  if (error) {
    console.error("[calendar] save failed", { code: error.code });
    return { status: "error", code: "saveError" };
  }
  refresh();
  return { status: "saved" };
}

export async function removeCalendarLink(): Promise<void> {
  const viewer = await getViewer();
  if (!viewer) redirect(loginPath("/"));
  const supabase = await createClient();
  const { error } = await supabase.from("calendar_links").delete().eq("user_id", viewer.id);
  if (error) throw new Error(`Could not remove the calendar link (${error.code})`);
  refresh();
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/** Creates (or reopens) the viewer's memo for a calendar event and opens it. */
export async function prepareCallMemo(formData: FormData): Promise<void> {
  const viewer = await getViewer();
  if (!viewer) redirect(loginPath("/"));

  let event: { id?: unknown; title?: unknown; start?: unknown; people?: unknown };
  try {
    event = JSON.parse(String(formData.get("event") ?? "{}"));
  } catch {
    throw new Error("Invalid event");
  }
  const eventId = typeof event.id === "string" && event.id.length > 0 && event.id.length <= 1024 ? event.id : null;
  const start = typeof event.start === "string" && ISO.test(event.start) ? event.start : null;
  if (!eventId || !start) throw new Error("Invalid event");
  const title = (typeof event.title === "string" ? event.title : "").trim().slice(0, 300);
  const me = viewer.email.toLowerCase();
  const people = (Array.isArray(event.people) ? event.people : [])
    .map(normalizeEmail)
    .filter((e) => isValidEmail(e) && e !== me)
    .slice(0, 49);

  // The pôle shown on the list if the viewer writes there, else their first one.
  const asked = formData.get("team");
  const team = isTeam(asked) && canCreateIn(viewer, asked) ? asked : (viewer.teams[0] ?? (viewer.isAdmin ? "ops" : null));
  if (!team) redirect("/");

  const supabase = await createClient();
  const names = new Map<string, string>();
  if (people.length) {
    const res = await supabase.from("profiles").select("email, full_name").in("email", people);
    for (const p of res.data ?? []) if (p.full_name.trim()) names.set(p.email, p.full_name.trim());
  }
  const lang = await getLang();
  // The date as the viewer's browser wrote it (their time zone), else the UTC day.
  const rawDate = String(formData.get("dateLabel") ?? "").trim().slice(0, 80);
  const dateLabel = rawDate || start.slice(0, 10);
  const content = blankContent(team);
  content.author = viewer.fullName;
  if (kindOf(team) === "mini") {
    content.meta = [viewer.fullName, dateLabel, "", ""];
  } else {
    content.meta = [people.map((p) => names.get(p) ?? p).join(", "), viewer.fullName, dateLabel, title];
  }

  const { data: id, error } = await supabase.rpc("create_call_memo", {
    p_team: team,
    p_lang: lang,
    p_title: title,
    p_content: content as never,
    p_starts_at: start,
    p_event_id: eventId,
    p_emails: people,
  });
  if (error || typeof id !== "string") throw new Error(`Could not prepare the memo (${error?.code ?? "no id"})`);
  redirect(`/memos/${id}`);
}
