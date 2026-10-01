// Signed-in account pill in the hero: the team page (admins manage it, everyone
// can see who decides and edit their name) + sign out.
import Link from "next/link";
import { type Lang, fmt, ui } from "@/lib/content";

export function AccountMenu({ lang, email, isAdmin }: { lang: Lang; email: string; isAdmin?: boolean }) {
  const u = ui(lang);
  return (
    <div className="acct" title={fmt(u.account, { email })}>
      <Link href="/team" className="acct-link">
        {isAdmin ? u.manageTeam : u.teamH}
      </Link>
      <form action="/auth/signout" method="post">
        <button type="submit">{u.signOut}</button>
      </form>
    </div>
  );
}
