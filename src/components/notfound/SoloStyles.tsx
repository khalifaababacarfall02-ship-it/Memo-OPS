// Single-card pages (/login, the 404s, the error page): the hero, then one
// centred sheet instead of the sheet + rail grid. Same tokens, radii and
// spacing as the prototype.
//
// A React <style> (hoisted into <head> and deduplicated by href) rather than an
// imported .css file: Next.js preloads the CSS of the root not-found.tsx and
// error.tsx on every page, where it then goes unused ("preloaded using link
// preload but not used" in the console). This is only sent when a card renders.
const SOLO_CSS = [
  ".wrap.solo{grid-template-columns:minmax(0,560px);justify-content:center}",
  ".sheet.solo-card{padding:32px 36px 36px}",
  "@media (max-width:600px){.sheet.solo-card{padding:24px 18px 28px}}",
  ".solo-h{margin:0 0 14px;font-size:30px;font-weight:800;letter-spacing:-.01em;text-transform:uppercase;line-height:1.1}",
  ".btn.solo-btn{margin-top:16px}",
  ".solo-card a.btn{text-decoration:none}",
].join("");

export function SoloStyles() {
  // Same precedence as the app's stylesheets: it comes after them, like an import would.
  return (
    <style href="bxh-solo" precedence="next">
      {SOLO_CSS}
    </style>
  );
}
