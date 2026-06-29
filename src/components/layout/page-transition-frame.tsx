"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type NavPreview = {
  href: string;
  label: string;
  direction: "from-right" | "from-left";
  fromPath: string;
  kind?: "home" | "classes" | "inbox" | "me" | "subpage";
};

export function PageTransitionFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [preview, setPreview] = useState<NavPreview | null>(null);

  useEffect(() => {
    function handlePreview(event: Event) {
      const detail = (event as CustomEvent<NavPreview>).detail;
      if (!detail?.href || detail.href === pathname) {
        return;
      }

      setPreview(detail);
    }

    window.addEventListener("tareeqah:nav-preview", handlePreview);
    return () => window.removeEventListener("tareeqah:nav-preview", handlePreview);
  }, [pathname]);

  return (
    <main
      key={pathname}
      className="pb-20 md:pb-0"
    >
      {preview && preview.fromPath === pathname ? <InstantNavPreview preview={preview} /> : children}
    </main>
  );
}

function InstantNavPreview({ preview }: { preview: NavPreview }) {
  const title = preview.label === "Me" ? "Me" : preview.label;
  const slideClass = preview.direction === "from-right" ? "page-slide-in-from-right" : "page-slide-in-from-left";

  if (preview.label === "Me") {
    return (
      <div className={slideClass}>
        <div className="min-h-[calc(100vh-140px)] bg-[#F7F8FA] px-5 py-8">
          <div className="mx-auto max-w-sm space-y-4">
            <div className="mx-auto h-28 w-28 animate-pulse rounded-full bg-[#E8EEF2]" />
            <div className="mx-auto h-6 w-40 animate-pulse rounded-full bg-[#E8EEF2]" />
            <div className="mx-auto h-4 w-28 animate-pulse rounded-full bg-[#E8EEF2]" />
            <div className="mt-8 space-y-3">
              <div className="h-16 animate-pulse rounded-2xl bg-white" />
              <div className="h-16 animate-pulse rounded-2xl bg-white" />
              <div className="h-16 animate-pulse rounded-2xl bg-white" />
            </div>
        </div>
        </div>
      </div>
    );
  }

  return (
    <div className={slideClass}>
      <section className="bg-[radial-gradient(circle_at_top_left,#E5FFF0_0,#D6F7E8_30%,#7ECFC2_62%,#2E9B82_100%)] text-[#26323A]">
        <div className={preview.kind === "subpage" ? "app-container flex min-h-60 flex-col items-start justify-start px-7 pb-32 pt-32 text-left md:min-h-64 md:pt-32" : "app-container flex min-h-60 flex-col items-center justify-start pb-32 pt-32 text-center md:min-h-64"}>
          {preview.kind === "subpage" ? (
            <div className="flex w-full translate-y-12 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[#111827] shadow-[0_8px_18px_rgba(38,50,58,0.14)] ring-1 ring-white/80">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
                  <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <h1 className="text-[2.15rem] font-semibold leading-none tracking-normal md:text-5xl">{title}</h1>
            </div>
          ) : (
            <h1 className="translate-y-12 text-[2.35rem] font-medium leading-none tracking-normal md:text-5xl">{title}</h1>
          )}
        </div>
      </section>
      <div className="app-container relative z-10 pb-8" style={{ marginTop: "-132px", paddingLeft: "4px", paddingRight: "4px" }}>
        <div className="overflow-hidden rounded-t-[34px] border border-[#D6DCE0] bg-white shadow-[0_-18px_48px_rgba(38,50,58,0.18)]">
          <InstantPreviewContent preview={preview} />
        </div>
      </div>
    </div>
  );
}

function InstantPreviewContent({ preview }: { preview: NavPreview }) {
  if (preview.kind === "subpage") {
    return <PreviewDetailSkeleton />;
  }

  if (preview.kind === "classes" || preview.label === "Classes" || preview.label === "Programs") {
    const isStudentClasses = preview.href.includes("/portal/classes");
    return (
      <>
        {isStudentClasses ? (
          <div className="grid grid-cols-2 border-b border-[#D6DCE0]">
            <div className="flex min-h-12 items-center justify-center border-b-2 border-[#2F8FB3] text-sm font-medium text-[#2F8FB3]">Enrolled</div>
            <div className="flex min-h-12 items-center justify-center text-sm font-medium text-[#6B747B]">Browse</div>
          </div>
        ) : null}
        <PreviewClassCards count={isStudentClasses ? 1 : 2} />
      </>
    );
  }

  if (preview.label === "Inbox") {
    return (
      <>
        <div className="border-b border-[#D6DCE0] bg-white p-3">
          <div className="grid grid-cols-2 rounded-full bg-[#EEF2F4] p-1">
            <div className="flex min-h-10 items-center justify-center rounded-full bg-white px-3 text-sm font-semibold text-[#17624F] shadow-sm">Announcements</div>
            <div className="flex min-h-10 items-center justify-center px-3 text-sm font-semibold text-[#6B747B]">Requests</div>
          </div>
        </div>
        <div className="space-y-4 bg-[#F5F7F8] p-4">
          <div className="flex min-h-64 items-center justify-center">
            <span className="h-11 w-11 animate-spin rounded-full border-4 border-[#DDEEF3] border-t-[#2F8FB3]" />
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="space-y-5 bg-[#F5F7F8] p-4">
      <div className="rounded-[30px] bg-white p-5 shadow-[0_18px_45px_rgba(38,50,58,0.08)]">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 shrink-0 animate-pulse rounded-2xl bg-[#E8EEF2]" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-5 w-36 animate-pulse rounded-full bg-[#E8EEF2]" />
            <div className="h-4 w-44 animate-pulse rounded-full bg-[#EEF2F4]" />
          </div>
          <div className="h-10 w-20 animate-pulse rounded-full bg-[#EEF2F4]" />
        </div>
      </div>
      <div className="px-1 pt-1">
        <h2 className="text-lg font-semibold text-[#26323A]">Upcoming</h2>
      </div>
      <div className="space-y-5">
        <div className="grid grid-cols-7 gap-1 px-1">
          {Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className="flex flex-col items-center gap-1.5">
              <div className="h-14 w-full max-w-12 animate-pulse rounded-2xl bg-[#E8EEF2]" />
              <div className="h-2 w-3 animate-pulse rounded-full bg-[#DDE8EE]" />
            </div>
          ))}
        </div>
        <div className="rounded-[24px] bg-white px-4 py-3 shadow-[0_8px_24px_rgba(38,50,58,0.06)]">
          <div className="flex items-center gap-3">
            <div className="h-14 w-14 shrink-0 animate-pulse rounded-2xl bg-[#E8EEF2]" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-5 w-44 animate-pulse rounded-full bg-[#E8EEF2]" />
              <div className="h-4 w-32 animate-pulse rounded-full bg-[#EEF2F4]" />
            </div>
            <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#A8C9D4]" />
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewDetailSkeleton() {
  return (
    <div className="space-y-5 bg-[#F5F7F8] p-4">
      <div className="overflow-hidden rounded-[24px] bg-white shadow-[0_12px_28px_rgba(38,50,58,0.08)]">
        <div className="h-40 animate-pulse bg-[#E6EDF0]" />
        <div className="space-y-3 p-4">
          <div className="h-7 w-4/5 animate-pulse rounded-full bg-[#E6EDF0]" />
          <div className="h-4 w-1/2 animate-pulse rounded-full bg-[#EDF2F4]" />
          <div className="h-4 w-3/4 animate-pulse rounded-full bg-[#EDF2F4]" />
        </div>
      </div>
      <div className="rounded-[24px] bg-white p-5 shadow-[0_12px_28px_rgba(38,50,58,0.06)]">
        <div className="h-6 w-44 animate-pulse rounded-full bg-[#E6EDF0]" />
        <div className="mt-5 grid gap-3">
          <div className="h-14 animate-pulse rounded-2xl bg-[#EDF2F4]" />
          <div className="h-14 animate-pulse rounded-2xl bg-[#EDF2F4]" />
          <div className="h-14 animate-pulse rounded-2xl bg-[#EDF2F4]" />
        </div>
      </div>
    </div>
  );
}

function PreviewClassCards({ count }: { count: number }) {
  return (
    <div className="grid gap-4 bg-[#F5F7F8] p-4 md:grid-cols-2">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-[22px] border border-[#E4EAED] bg-white shadow-[0_12px_28px_rgba(38,50,58,0.08)]">
          <div className="h-36 animate-pulse bg-[#E6EDF0]" />
          <div className="space-y-3 p-4">
            <div className="h-6 w-3/4 animate-pulse rounded bg-[#E6EDF0]" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-[#EDF2F4]" />
            <div className="flex gap-3 pt-2">
              <div className="h-9 flex-1 animate-pulse rounded bg-[#EDF2F4]" />
              <div className="h-9 flex-1 animate-pulse rounded bg-[#EDF2F4]" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
