import "server-only";

export function getCheckoutOrigin(request: Request) {
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin) {
    return requestOrigin.replace(/\/$/, "");
  }

  const referer = request.headers.get("referer");
  if (referer) {
    return new URL(referer).origin;
  }

  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (configuredOrigin) {
    return configuredOrigin.replace(/\/$/, "");
  }

  return new URL(request.url).origin;
}

function isMasjidSubdomain(origin: string, mosqueSlug: string) {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    const rootDomain = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || "tareeqah.ca").toLowerCase();

    return hostname === `${mosqueSlug}.${rootDomain}` || hostname === `${mosqueSlug}.localhost`;
  } catch {
    return false;
  }
}

export function getPortalReturnPath(origin: string, mosqueSlug: string) {
  return isMasjidSubdomain(origin, mosqueSlug) ? "/portal/announcements" : `/m/${mosqueSlug}/portal/announcements`;
}

export function getRegistrationConfirmationPath(origin: string, mosqueSlug: string, enrollmentRequestId: string) {
  return isMasjidSubdomain(origin, mosqueSlug) ? `/registration/${enrollmentRequestId}` : `/m/${mosqueSlug}/registration/${enrollmentRequestId}`;
}
