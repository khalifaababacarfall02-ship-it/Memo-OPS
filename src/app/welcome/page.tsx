// /welcome: the first sign-in. Asks the person's name and, when nobody put them
// in a pôle yet, their pôle; then they land in that pôle's memos. Every other
// page sends people here until it is done (requireViewer).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SoloStyles } from "@/components/notfound/SoloStyles";
import { AppFrame } from "@/components/shell/AppFrame";
import { WelcomeForm } from "@/components/welcome/WelcomeForm";
import { requireViewer } from "@/lib/auth/viewer";
import { safeNext } from "@/lib/auth/redirect";
import { MEMO_TEAMS, doc, fmt, teamColors, ui } from "@/lib/content";
import { getLang } from "@/lib/i18n";
import "@/styles/login.css";
import "@/styles/welcome.css";

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata(): Promise<Metadata> {
  return { title: ui(await getLang()).welcomeH };
}

export default async function WelcomePage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const next = safeNext(first(params.next));
  const viewer = await requireViewer("/welcome", { setup: true });
  if (viewer.onboarded) redirect(next);

  const lang = await getLang();
  const u = ui(lang);
  const given = viewer.teams.length > 0;
  // The name the sign-up trigger guessed is the address's local part: only keep a real one.
  const local = viewer.email.split("@")[0];
  const initialName = viewer.fullName && viewer.fullName !== local ? viewer.fullName : "";

  return (
    <AppFrame
      lang={lang}
      team={viewer.teams[0] ?? "ops"}
      title={[u.welcomeH, "BoxHero"]}
      tag={doc(lang).tag}
      viewer={{ email: viewer.email, isAdmin: viewer.isAdmin }}
      wrapClassName="solo"
    >
      <main className="sheet solo-card">
        <SoloStyles />
        <h2 className="solo-h">{u.welcomeH}</h2>
        <WelcomeForm
          next={next}
          initialName={initialName}
          poles={given ? [] : MEMO_TEAMS.map((t) => ({ key: t, label: u.poles[t], color: teamColors(t).acc }))}
          t={{
            intro: u.welcomeIntro,
            nameL: u.welcomeNameL,
            poleL: u.welcomePoleL,
            poleGiven: given ? fmt(u.welcomePoleGiven, { pole: viewer.teams.map((t) => u.poles[t]).join(", ") }) : null,
            adminNote: !given && viewer.isAdmin ? u.welcomeAdminNote : null,
            go: u.welcomeGo,
            saving: u.welcomeSaving,
            errors: { nameRequired: u.nameRequired, welcomeNeedPole: u.welcomeNeedPole, saveError: u.saveError },
          }}
        />
      </main>
    </AppFrame>
  );
}
