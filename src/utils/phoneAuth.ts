import { FIELD_LIMITS } from '../types';
import { clampText } from './formatters';

export const SYNTHETIC_PHONE_EMAIL_DOMAIN = '@phone.bartaconnect.local';
const SYNTHETIC_PHONE_EMAIL_REGEX = /^[0-9]{6,15}@phone\.bartaconnect\.local$/i;

export interface PhoneDemoMeta {
  displayName?: string;
  phone?: string;
  address?: string;
}

const BENGALI_TO_ASCII_DIGITS: Record<string, string> = {
  '০': '0',
  '১': '1',
  '২': '2',
  '৩': '3',
  '৪': '4',
  '৫': '5',
  '৬': '6',
  '৭': '7',
  '৮': '8',
  '৯': '9',
};

export function normalizePhoneDigits(raw: string | null | undefined): string {
  if (!raw) return '';
  const ascii = raw.replace(/[০-৯]/g, (ch) => BENGALI_TO_ASCII_DIGITS[ch] ?? ch);
  return ascii.replace(/[^0-9]/g, '').slice(0, FIELD_LIMITS.PHONE_MAX);
}

export function isValidPhoneDigits(digits: string): boolean {
  return /^[0-9]{6,15}$/.test(digits);
}

export function phoneToSyntheticEmail(digits: string): string {
  return `${digits}${SYNTHETIC_PHONE_EMAIL_DOMAIN}`;
}

export function isSyntheticPhoneEmail(email: string | null | undefined): boolean {
  return SYNTHETIC_PHONE_EMAIL_REGEX.test((email ?? '').trim());
}

export function extractPhoneFromSyntheticEmail(email: string | null | undefined): string {
  const trimmed = (email ?? '').trim();
  if (!isSyntheticPhoneEmail(trimmed)) return '';
  return trimmed.split('@')[0] ?? '';
}

export function formatClientContactLabel(params: {
  email?: string | null;
  phone?: string | null;
  address?: string | null;
}): string {
  const cleanPhone = clampText(
    params.phone || extractPhoneFromSyntheticEmail(params.email),
    FIELD_LIMITS.PHONE_MAX,
  );
  const cleanAddress = clampText(params.address, FIELD_LIMITS.ADDRESS_MAX);

  if (isSyntheticPhoneEmail(params.email) || cleanPhone) {
    if (cleanPhone && cleanAddress) {
      return `${cleanPhone} · ${cleanAddress}`;
    }
    return cleanPhone || cleanAddress || 'Demo Client';
  }

  return clampText(params.email, FIELD_LIMITS.EMAIL_MAX, 'Client');
}

function getDemoMetaStorageKey(digits: string): string {
  return `bartaconnect_phone_meta_${digits}`;
}

export function savePendingPhoneDemoMeta(digits: string, meta: PhoneDemoMeta): void {
  if (!isValidPhoneDigits(digits)) return;
  try {
    const cleanMeta: PhoneDemoMeta = {
      displayName: clampText(meta.displayName, FIELD_LIMITS.DISPLAY_NAME_MAX),
      phone: clampText(meta.phone || digits, FIELD_LIMITS.PHONE_MAX),
      address: clampText(meta.address, FIELD_LIMITS.ADDRESS_MAX),
    };
    window.localStorage.setItem(getDemoMetaStorageKey(digits), JSON.stringify(cleanMeta));
  } catch {
    // Ignore storage unavailability
  }
}

export function loadPendingPhoneDemoMeta(email: string | null | undefined): PhoneDemoMeta | null {
  const digits = extractPhoneFromSyntheticEmail(email);
  if (!digits) return null;
  try {
    const raw = window.localStorage.getItem(getDemoMetaStorageKey(digits));
    if (!raw) return { phone: digits };
    const parsed = JSON.parse(raw) as Partial<PhoneDemoMeta>;
    return {
      displayName: clampText(parsed.displayName, FIELD_LIMITS.DISPLAY_NAME_MAX),
      phone: clampText(parsed.phone || digits, FIELD_LIMITS.PHONE_MAX),
      address: clampText(parsed.address, FIELD_LIMITS.ADDRESS_MAX),
    };
  } catch {
    return { phone: digits };
  }
}
