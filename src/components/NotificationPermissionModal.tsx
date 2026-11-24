import React, { useState } from 'react';
import { Bell, BellOff, RefreshCw, Volume2, X } from 'lucide-react';
import { Language } from '../types';
import { playMessageAlertTone } from '../utils/pushNotifications';

interface NotificationPermissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  permission: NotificationPermission | 'unsupported';
  lang: Language;
  enabling: boolean;
  onRetryPermission: () => Promise<NotificationPermission | 'unsupported'>;
}

export const NotificationPermissionModal: React.FC<NotificationPermissionModalProps> = ({
  isOpen,
  onClose,
  permission,
  lang,
  enabling,
  onRetryPermission,
}) => {
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);

  if (!isOpen) return null;

  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

  const handleRetryClick = async () => {
    setStatusFeedback(null);
    const next = await onRetryPermission();
    if (next === 'granted') {
      playMessageAlertTone();
      onClose();
    } else if (next === 'denied') {
      setStatusFeedback(
        lang === 'bn'
          ? 'ব্রাউজার এখনো নোটিফিকেশন ব্লক করে রেখেছে — উপরে ব্রাউজার সেটিংস (Lock আইকন) থেকে Notifications -> Allow করে পেজটি রিলোড করুন।'
          : 'Browser still has notifications blocked — tap the Lock icon in the address bar, set Notifications to Allow, then reload.',
      );
    } else if (next === 'unsupported') {
      setStatusFeedback(
        lang === 'bn'
          ? 'এই ব্রাউজারে সিস্টেম নোটিফিকেশন সাপোর্ট করে না, তবে চ্যাট খোলা থাকলে সাউন্ড ও ইন-অ্যাপ অ্যালার্ট চালু থাকবে।'
          : 'System notifications are unsupported in this browser, though sound and in-app alerts remain active.',
      );
    }
  };

  const handleTestSound = () => {
    playMessageAlertTone();
    setStatusFeedback(
      lang === 'bn'
        ? 'সাউন্ড অ্যালার্ট চালু আছে! নতুন মেসেজ এলেই এই টোন বাজবে।'
        : 'Sound alert is active! This tone will play when a new message arrives.',
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                permission === 'denied'
                  ? 'bg-amber-50 text-amber-600'
                  : 'bg-blue-50 text-blue-600'
              }`}
            >
              {permission === 'denied' ? (
                <BellOff className="w-5 h-5" />
              ) : (
                <Bell className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {permission === 'denied'
                  ? lang === 'bn'
                    ? 'নোটিফিকেশন ব্লক করা আছে'
                    : 'Notifications Blocked'
                  : lang === 'bn'
                    ? 'নোটিফিকেশন চালু করুন'
                    : 'Enable Notifications'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === 'bn'
                  ? 'নতুন মেসেজ আসার সাথে সাথে মোবাইলে/ডেস্কটপে অ্যালার্ট পান'
                  : 'Receive instant alerts whenever a new message arrives'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={lang === 'bn' ? 'বন্ধ করুন' : 'Close'}
            className="min-w-[36px] min-h-[36px] rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-1.5 leading-relaxed">
          {permission === 'denied' ? (
            <>
              <p className="font-semibold text-slate-900">
                {lang === 'bn'
                  ? 'কেন ব্রাউজারের পপআপ আসেনি ও কিভাবে চালু করবেন:'
                  : 'Why the browser prompt stayed hidden & how to enable it:'}
              </p>
              <p>
                {lang === 'bn'
                  ? '১. আগে "Block" হয়ে থাকায় ব্রাউজার নিজে থেকে আর পপআপ দেয় না। অ্যাড্রেস বারের বামের তালা (Lock) বা সেটিংস আইকনে ক্লিক করুন।'
                  : '1. Once blocked, browsers suppress repeat popups. Tap the Lock / Site Settings icon in your address bar.'}
              </p>
              <p>
                {lang === 'bn'
                  ? '২. Notifications -> Allow সিলেক্ট করুন এবং নিচের "আবার অনুমতি চেষ্টা করুন" বাটনে ক্লিক করুন।'
                  : '2. Set Notifications to Allow, then click "Retry Permission" below.'}
              </p>
              {isInIframe && (
                <p className="text-blue-700 font-medium pt-0.5">
                  {lang === 'bn'
                    ? 'টিপস: প্রিভিউ ফ্রেমের ভেতর ব্রাউজার অনেক সময় নোটিফিকেশন আটকে দেয়—সরাসরি Netlify বা নিজের ব্রাউজার ট্যাবে খুললে সহজেই Allow পপআপ আসবে।'
                    : 'Tip: Embedded frames often block browser notifications — opening the live app directly in a browser tab allows 1-tap notification prompts.'}
                </p>
              )}
            </>
          ) : (
            <p>
              {lang === 'bn'
                ? 'নিচের "আবার অনুমতি চেষ্টা করুন" বাটনে ক্লিক করে ব্রাউজার পপআপে Allow দিন।'
                : 'Tap "Retry Permission" below and choose Allow when your browser asks.'}
            </p>
          )}
        </div>

        {statusFeedback && (
          <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-900 leading-relaxed">
            {statusFeedback}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={() => void handleRetryClick()}
            disabled={enabling}
            className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${enabling ? 'animate-spin' : ''}`} />
            <span>
              {enabling
                ? lang === 'bn'
                  ? 'চালু হচ্ছে...'
                  : 'Enabling...'
                : lang === 'bn'
                  ? 'আবার অনুমতি চেষ্টা করুন'
                  : 'Retry Permission'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleTestSound}
            className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs sm:text-sm font-medium cursor-pointer"
          >
            <Volume2 className="w-4 h-4" />
            <span>{lang === 'bn' ? 'সাউন্ড টেস্ট করুন' : 'Test Sound'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
