import type { SVGProps } from "react";

export type IconName =
  | "home"
  | "calendar"
  | "document"
  | "building"
  | "shield"
  | "audit"
  | "users"
  | "briefcase"
  | "message"
  | "folder"
  | "tasks"
  | "chart"
  | "bell"
  | "menu"
  | "logout"
  | "wifi"
  | "search"
  | "plus"
  | "chevronLeft"
  | "chevronRight"
  | "chevronDown"
  | "clock"
  | "check"
  | "lock"
  | "eye"
  | "filter"
  | "megaphone"
  | "layers"
  | "sparkles";

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
}

function IconPath({ name }: { name: IconName }) {
  switch (name) {
    case "home":
      return <path strokeLinecap="round" strokeLinejoin="round" d="m3 11 9-8 9 8M5 10v10h14V10M9 20v-6h6v6" />;
    case "calendar":
      return <><path strokeLinecap="round" strokeLinejoin="round" d="M6 3v3m12-3v3M4 9h16M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /><path strokeLinecap="round" d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01" /></>;
    case "document":
      return <><path strokeLinecap="round" strokeLinejoin="round" d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M14 3v5h5M9 13h6m-6 4h6" /></>;
    case "building":
      return <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M5 21V8l7-5 7 5v13M8 11h2m4 0h2m-8 4h2m4 0h2m-6 6v-3h4v3" />;
    case "shield":
      return <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-3.8 8-10V5l-8-3-8 3v7c0 6.2 8 10 8 10Zm-3-10 2 2 4-5" />;
    case "audit":
      return <><path strokeLinecap="round" strokeLinejoin="round" d="M9 4h6m-7 0H6a2 2 0 0 0-2 2v14h16V6a2 2 0 0 0-2-2h-2M9 2h6v4H9V2Z" /><path strokeLinecap="round" strokeLinejoin="round" d="m8 13 2 2 5-5" /></>;
    case "users":
      return <><path strokeLinecap="round" strokeLinejoin="round" d="M16 20v-1.5A3.5 3.5 0 0 0 12.5 15h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M17 8a3 3 0 0 1 0 6m4 6v-1.5a3.5 3.5 0 0 0-2.3-3.3" /></>;
    case "briefcase":
      return <><path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16a2 2 0 0 1 2 2v10H2V9a2 2 0 0 1 2-2Zm4 0V4h8v3M2 12h20" /><path strokeLinecap="round" d="M10 12v2h4v-2" /></>;
    case "message":
      return <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a8 8 0 0 1-8 8H5l-3 2 1-5a9 9 0 1 1 18-5Z" />;
    case "folder":
      return <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h7l2 2h9v11H3V6Z" />;
    case "tasks":
      return <path strokeLinecap="round" strokeLinejoin="round" d="M9 5h11M9 12h11M9 19h11M3 5l1 1 2-2M3 12l1 1 2-2M3 19l1 1 2-2" />;
    case "chart":
      return <path strokeLinecap="round" strokeLinejoin="round" d="M4 20V10m6 10V4m6 16v-7m5 7H2" />;
    case "bell":
      return <path strokeLinecap="round" strokeLinejoin="round" d="M18 9a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Zm-8 12h4" />;
    case "menu":
      return <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />;
    case "logout":
      return <path strokeLinecap="round" strokeLinejoin="round" d="M10 4H5v16h5m5-4 4-4-4-4m4 4H9" />;
    case "wifi":
      return <><path strokeLinecap="round" d="M4 9a12 12 0 0 1 16 0M7 13a8 8 0 0 1 10 0m-7 4a3 3 0 0 1 4 0" /><path strokeLinecap="round" d="M12 21h.01" /></>;
    case "search":
      return <><circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="m20 20-4-4" /></>;
    case "plus":
      return <path strokeLinecap="round" d="M12 5v14M5 12h14" />;
    case "chevronLeft":
      return <path strokeLinecap="round" strokeLinejoin="round" d="m15 18-6-6 6-6" />;
    case "chevronRight":
      return <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />;
    case "chevronDown":
      return <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />;
    case "clock":
      return <><circle cx="12" cy="12" r="9" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" /></>;
    case "check":
      return <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 4 4L19 6" />;
    case "lock":
      return <><rect x="5" y="10" width="14" height="11" rx="2" /><path strokeLinecap="round" d="M8 10V7a4 4 0 0 1 8 0v3" /></>;
    case "eye":
      return <><path strokeLinecap="round" strokeLinejoin="round" d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="2.5" /></>;
    case "filter":
      return <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16l-6 7v6l-4 2v-8L4 5Z" />;
    case "megaphone":
      return <><path strokeLinecap="round" strokeLinejoin="round" d="M4 13V9h4l10-4v12L8 13H4Zm4 0 2 7h4l-2-5" /><path strokeLinecap="round" d="M21 8v6" /></>;
    case "layers":
      return <path strokeLinecap="round" strokeLinejoin="round" d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" />;
    case "sparkles":
      return <path strokeLinecap="round" strokeLinejoin="round" d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Zm6 10 .8 2.2L21 16l-2.2.8L18 19l-.8-2.2L15 16l2.2-.8L18 13ZM5 13l.8 2.2L8 16l-2.2.8L5 19l-.8-2.2L2 16l2.2-.8L5 13Z" />;
  }
}

export function InstitutionalIcon({ name, className = "h-5 w-5", ...props }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} {...props}>
      <IconPath name={name} />
    </svg>
  );
}
