"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

/**
 * Vercel Web Analytics with signatures and wallet addresses removed from URLs, so the
 * dashboard groups visits by page type and never records which wallets people look up.
 */
function anonymize(event: BeforeSendEvent): BeforeSendEvent {
  const url = new URL(event.url);
  url.pathname = url.pathname.replace(/^\/tx\/[^/]+/, "/tx/[signature]").replace(/^\/address\/[^/]+/, "/address/[wallet]");
  return { ...event, url: url.toString() };
}

export function DocentAnalytics() {
  return <Analytics beforeSend={anonymize} />;
}
