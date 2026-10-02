// The signed-in person (sidebar foot / top bar): their address and sign-out.
import { type Lang, fmt, ui } from "@/lib/content";

export function AccountMenu({ lang, email }: { lang: Lang; email: string }) {
  const u = ui(lang);
  return (
    <div className="acct" title={fmt(u.account, { email })}>
      <span className="acct-mail">{email}</span>
      <form action="/auth/signout" method="post">
        <button type="submit">{u.signOut}</button>
      </form>
    </div>
  );
}
