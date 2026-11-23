import React from 'react';
import { ArrowRight, Lock, MessageCircle, X } from 'lucide-react';
import { AdminPresence, Language, PublicPageSettings } from '../types';
import { formatRelativeTime } from '../utils/formatters';
import { Avatar } from './Avatar';

interface WelcomePopupProps {
  isOpen: boolean;
  onClose: () => void;
  onSignIn: () => void;
  isSigningIn: boolean;
  authError: string | null;
  settings: PublicPageSettings;
  adminOnline: boolean;
  adminPresence: AdminPresence | null;
  lang: Language;
}

export const WelcomePopup: React.FC<WelcomePopupProps> = ({
  isOpen,
  onClose,
  onSignIn,
  isSigningIn,
  authError,
  settings,
  adminOnline,
  adminPresence,
  lang,
}) => {
  if (!isOpen) return null;

  const title = lang === 'bn' ? settings.welcomePopupTitle : 'Chat With Us Free';
  const subtitle =
    lang === 'bn'
      ? settings.welcomePopupSubtitle
      : 'Talk directly and privately with our page admin in real time without Facebook restrictions.';
  const greeting =
    lang === 'bn'
      ? settings.greetingMessage
      : 'Welcome! Send your message here anytime and our team will reply right away.';

  const statusText = adminOnline
    ? lang === 'bn'
      ? 'অ্যাডমিন এখন অনলাইনে আছেন'
      : 'Admin is active now'
    : adminPresence?.lastSeenAt
      ? lang === 'bn'
        ? `অফলাইন · শেষ দেখা ${formatRelativeTime(adminPresence.lastSeenAt, lang)} আগে`
        : `Offline · Last seen ${formatRelativeTime(adminPresence.lastSeenAt, lang)} ago`
      : lang === 'bn'
        ? 'অফলাইনে আছেন · মেসেজ দিলে অটো উত্তর পাবেন'
        : 'Currently offline · Leave a message anytime';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/45 backdrop-blur-xs animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-popup-title"
    >
      <div className="relative w-full max-w-md bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl shadow-xl overflow-hidden max-h-[92dvh] overflow-y-auto">
        <div className="sm:hidden pt-2.5 pb-1 bg-blue-600 flex justify-center">
          <span className="w-10 h-1 rounded-full bg-white/40" aria-hidden="true" />
        </div>
        {/* Messenger-style header bar */}
        <div className="flex items-center justify-between gap-4 px-5 sm:px-6 py-3.5 sm:py-4 bg-blue-600 text-white">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar
              src={settings.adminAvatarURL}
              name={settings.pageName}
              size="md"
              className="border-white/30"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{settings.pageName}</p>
              <p className="text-xs text-blue-100 truncate flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                    adminOnline ? 'bg-emerald-300' : 'bg-slate-300'
                  }`}
                />
                <span className="truncate">{statusText}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={lang === 'bn' ? 'বন্ধ করুন' : 'Close popup'}
            className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-blue-100 hover:text-white hover:bg-blue-700 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 pb-safe space-y-4 sm:space-y-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-blue-700 mb-1.5">
              <MessageCircle className="w-3.5 h-3.5" />
              <span>{lang === 'bn' ? 'তাৎক্ষণিক মেসেঞ্জার চ্যাট' : 'Instant Messenger Chat'}</span>
            </div>
            <h2
              id="welcome-popup-title"
              className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight"
            >
              {title}
            </h2>
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{subtitle}</p>
          </div>

          {/* Preview incoming bubble from Admin */}
          <div className="flex items-end gap-2.5">
            <Avatar src={settings.adminAvatarURL} name={settings.pageName} size="sm" />
            <div className="bg-slate-100 text-slate-800 text-sm leading-relaxed px-4 py-3 rounded-2xl rounded-bl-sm max-w-[86%]">
              {greeting}
            </div>
          </div>

          {authError && (
            <div
              role="alert"
              className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5"
            >
              {authError}
            </div>
          )}

          <div className="space-y-3 pt-1">
            <button
              type="button"
              onClick={onSignIn}
              disabled={isSigningIn}
              className="w-full min-h-[48px] flex items-center justify-center gap-2.5 px-5 py-3 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-xl transition-transform active:scale-[0.98] cursor-pointer"
            >
              <span>
                {isSigningIn
                  ? lang === 'bn'
                    ? 'লগইন হচ্ছে...'
                    : 'Connecting...'
                  : lang === 'bn'
                    ? 'Google দিয়ে ফ্রি চ্যাট শুরু করুন'
                    : 'Start Free Chat with Google'}
              </span>
              <ArrowRight className="w-4 h-4 shrink-0" />
            </button>

            <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
              <Lock className="w-3.5 h-3.5 shrink-0" />
              <span>
                {lang === 'bn'
                  ? '১০০% ব্যক্তিগত · টেক্সট, অডিও ও ভিডিও শেয়ার সুবিধা'
                  : '100% Private · Text, Audio & Video sharing supported'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
