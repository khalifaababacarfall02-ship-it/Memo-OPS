// Button icons. The first four are the prototype's SVGs, attribute for
// attribute; the workflow ones follow the same 24px stroke style.

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export const CopyIcon = () => (
  <svg {...base}>
    <rect x="9" y="9" width="12" height="12" rx="2.5" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export const PdfIcon = () => (
  <svg {...base}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M12 12v6" />
    <path d="m9 15 3 3 3-3" />
  </svg>
);

export const ExampleIcon = () => (
  <svg {...base}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

/** The prototype's "+" has no stroke-linejoin. */
export const NewIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

/** "Send for decision": a plain arrow (the paper plane is the Asana button's icon). */
export const SendIcon = () => (
  <svg {...base}>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </svg>
);

export const DecideIcon = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="10" />
    <path d="m8 12 3 3 5-6" />
  </svg>
);

export const BackIcon = () => (
  <svg {...base}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
  </svg>
);

export const ReopenIcon = () => (
  <svg {...base}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

export const ArchiveIcon = () => (
  <svg {...base}>
    <rect x="2" y="3" width="20" height="5" rx="1" />
    <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
    <path d="M10 12h4" />
  </svg>
);
