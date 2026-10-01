// The prototype's button icons (render(): #bNew, #bExample).
const svg = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  "aria-hidden": true,
} as const;

export function PlusIcon() {
  return (
    <svg {...svg}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function EyeIcon() {
  return (
    <svg {...svg} strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Not in the prototype: a back arrow in the same line style (404 page). */
export function BackIcon() {
  return (
    <svg {...svg} strokeLinejoin="round">
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}
