import { NextRequest, NextResponse } from "next/server";

const DEFAULT_ROOT_DOMAIN = "tareeqah.ca";
const RESERVED_SUBDOMAINS = new Set(["www"]);

function hostnameFromRequest(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host") || "";

  return host.split(":")[0]?.toLowerCase() ?? "";
}

function rootDomain() {
  return (process.env.NEXT_PUBLIC_ROOT_DOMAIN || DEFAULT_ROOT_DOMAIN).toLowerCase();
}

function subdomainFromHost(hostname: string) {
  const configuredRoot = rootDomain();

  if (!hostname || hostname === configuredRoot || hostname === `www.${configuredRoot}`) {
    return null;
  }

  if (hostname.endsWith(`.${configuredRoot}`)) {
    const subdomain = hostname.slice(0, -(`.${configuredRoot}`.length));
    return subdomain && !RESERVED_SUBDOMAINS.has(subdomain) ? subdomain : null;
  }

  if (hostname.endsWith(".localhost")) {
    const subdomain = hostname.slice(0, -(".localhost".length));
    return subdomain && !RESERVED_SUBDOMAINS.has(subdomain) ? subdomain : null;
  }

  return null;
}

function cleanPathFromInternalPath(pathname: string, slug: string) {
  const scopedRoot = `/m/${slug}`;

  if (pathname === scopedRoot) {
    return "/";
  }

  if (pathname.startsWith(`${scopedRoot}/`)) {
    return pathname.slice(scopedRoot.length);
  }

  if (pathname === "/m" || pathname.startsWith("/m/")) {
    return "/";
  }

  return null;
}

export function proxy(request: NextRequest) {
  const hostname = hostnameFromRequest(request);
  const slug = subdomainFromHost(hostname);

  if (!slug) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  const cleanPath = cleanPathFromInternalPath(url.pathname, slug);

  if (cleanPath) {
    url.pathname = cleanPath;
    return NextResponse.redirect(url);
  }

  url.pathname = `/m/${slug}${url.pathname === "/" ? "" : url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|favicon-16x16.png|favicon-32x32.png|icon-.*\\.png|maskable-icon-.*\\.png|apple-touch-icon.png|sw.js|.*\\..*).*)",
  ],
};
