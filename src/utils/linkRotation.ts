export function isSafeHttpsLink(url: string): boolean {
  const trimmed = url.trim();
  return (
    trimmed.length >= 10 &&
    trimmed.length <= 300 &&
    /^https:\/\/[^\s]+$/i.test(trimmed)
  );
}

export function hashUserId(userId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < userId.length; i += 1) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function resolveActiveLinkForUser(params: {
  userId: string;
  links: string[];
  assignedFirstLink?: string;
  cycleCount?: number;
}): string | null {
  const validLinks = params.links.map((l) => l.trim()).filter(isSafeHttpsLink);
  if (validLinks.length === 0) return null;

  const cycle = Math.max(0, params.cycleCount ?? 0);
  const pinned = (params.assignedFirstLink ?? '').trim();

  if (pinned && isSafeHttpsLink(pinned)) {
    if (cycle === 0) {
      return pinned;
    }
    const pinnedIdx = validLinks.indexOf(pinned);
    const baseIdx = pinnedIdx >= 0 ? pinnedIdx : hashUserId(params.userId) % validLinks.length;
    return validLinks[(baseIdx + cycle) % validLinks.length];
  }

  const startIdx = hashUserId(params.userId) % validLinks.length;
  return validLinks[(startIdx + cycle) % validLinks.length];
}

export function formatLinkDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return 'external link';
  }
}

export function formatShortLinkLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const tail = parsed.pathname.split('/').filter(Boolean).pop() ?? '';
    if (!tail) return host;
    return tail.length > 10 ? `${host}/…${tail.slice(-6)}` : `${host}/${tail}`;
  } catch {
    return url.slice(0, 28);
  }
}
