export function canReuseAiCredential(
  previous: { provider: string; baseURL: string },
  next: { provider: string; baseURL: string }
): boolean {
  if (previous.provider !== next.provider) return false;
  try {
    const oldUrl = new URL(previous.baseURL);
    const nextUrl = new URL(next.baseURL);
    return ['https:', 'http:'].includes(nextUrl.protocol) && oldUrl.origin === nextUrl.origin;
  } catch {
    return false;
  }
}
