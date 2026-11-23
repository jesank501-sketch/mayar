import { Timestamp } from 'firebase/firestore';
import { Language } from '../types';

export function clampText(value: string | null | undefined, max: number, fallback = ''): string {
  const normalized = (value ?? '').trim();
  if (!normalized) return fallback;
  return normalized.length > max ? normalized.slice(0, max) : normalized;
}

export function formatMessageTime(ts: Timestamp | null | undefined, lang: Language): string {
  if (!ts) return '';
  const date = ts.toDate();
  const locale = lang === 'bn' ? 'bn-BD' : 'en-US';
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatRelativeTime(ts: Timestamp | null | undefined, lang: Language): string {
  if (!ts) return '';
  const date = ts.toDate();
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return lang === 'bn' ? 'এইমাত্র' : 'Just now';
  if (diffMin < 60) return lang === 'bn' ? `${diffMin} মি.` : `${diffMin}m`;
  if (diffHr < 24) return lang === 'bn' ? `${diffHr} ঘ.` : `${diffHr}h`;
  if (diffDay < 7) return lang === 'bn' ? `${diffDay} দি.` : `${diffDay}d`;

  const locale = lang === 'bn' ? 'bn-BD' : 'en-US';
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
