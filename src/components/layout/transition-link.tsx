"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent, ReactNode } from "react";

type TransitionDirection = "from-right" | "from-left";
type PreviewKind = "home" | "classes" | "inbox" | "me" | "subpage";

function canHandleClientClick(event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>) {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function dispatchPreview({ href, label, direction, fromPath, kind }: { href: string; label: string; direction: TransitionDirection; fromPath: string; kind?: PreviewKind }) {
  window.dispatchEvent(
    new CustomEvent("tareeqah:nav-preview", {
      detail: { href, label, direction, fromPath, kind },
    }),
  );
}

export function TransitionLink({
  href,
  label,
  direction = "from-right",
  kind = "subpage",
  children,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
  label: string;
  direction?: TransitionDirection;
  kind?: PreviewKind;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <Link
      {...props}
      href={href}
      onClick={(event) => {
        props.onClick?.(event);
        if (!canHandleClientClick(event) || href === pathname) {
          return;
        }

        event.preventDefault();
        dispatchPreview({ href, label, direction, fromPath: pathname, kind });
        router.push(href);
      }}
    >
      {children}
    </Link>
  );
}

export function TransitionBackButton({
  fallbackHref,
  label,
  className,
  ariaLabel = "Back",
}: {
  fallbackHref: string;
  label: string;
  className?: string;
  ariaLabel?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={className}
      onClick={() => {
        dispatchPreview({ href: fallbackHref, label, direction: "from-left", fromPath: pathname, kind: label === "Classes" || label === "Programs" ? "classes" : "subpage" });
        router.push(fallbackHref);
      }}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
        <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
