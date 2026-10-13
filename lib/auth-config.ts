/**
 * Whether accounts (Clerk) are configured. The publishable key is public and inlined at build
 * time, so this works on the server and in the browser.
 */
export const AUTH_ENABLED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
