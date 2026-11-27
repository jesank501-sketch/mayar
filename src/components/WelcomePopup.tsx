import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  MapPin,
  MessageCircle,
  Phone,
  User,
  UserPlus,
  LogIn,
  X,
} from 'lucide-react';
import { AdminPresence, FIELD_LIMITS, Language, PublicPageSettings } from '../types';
import { formatRelativeTime } from '../utils/formatters';
import { isValidPhoneDigits, normalizePhoneDigits } from '../utils/phoneAuth';
import { Avatar } from './Avatar';

interface WelcomePopupProps {
  isOpen: boolean;
  onClose: () => void;
  onSignIn: () => void;
  onPhoneRegister: (params: {
    name: string;
    phone: string;
    address: string;
    password: string;
  }) => Promise<boolean>;
  onPhoneSignIn: (params: { phone: string; password: string }) => Promise<void>;
  onClearError: () => void;
  isSigningIn: boolean;
  authError: string | null;
  settings: PublicPageSettings;
  adminOnline: boolean;
  adminPresence: AdminPresence | null;
  lang: Language;
}

type AuthTabMode = 'register' | 'login';

export const WelcomePopup: React.FC<WelcomePopupProps> = ({
  isOpen,
  onClose,
  onSignIn,
  onPhoneRegister,
  onPhoneSignIn,
  onClearError,
  isSigningIn,
  authError,
  settings,
  adminOnline,
  adminPresence,
  lang,
}) => {
  const [authTab, setAuthTab] = useState<AuthTabMode>('register');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setLocalError(null);
    }
  }, [isOpen]);

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

  const handleSwitchTab = (nextTab: AuthTabMode) => {
    setAuthTab(nextTab);
    setLocalError(null);
    onClearError();
  };

  const handleSubmitPhoneForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSigningIn) return;
    setLocalError(null);
    onClearError();

    const digits = normalizePhoneDigits(phone);
    if (!isValidPhoneDigits(digits)) {
      setLocalError(
        lang === 'bn'
          ? 'অনুগ্রহ করে সঠিক মোবাইল নম্বর লিখুন (কমপক্ষে ৬–১৫ সংখ্যা, যেমন 017XXXXXXXX)।'
          : 'Please enter a valid mobile number (6–15 digits, e.g. 017XXXXXXXX).',
      );
      return;
    }

    if (password.length < 6) {
      setLocalError(
        lang === 'bn'
          ? 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।'
          : 'Password must be at least 6 characters.',
      );
      return;
    }

    if (authTab === 'register') {
      const cleanName = name.trim();
      const cleanAddress = address.trim();
      if (!cleanName) {
        setLocalError(
          lang === 'bn' ? 'আপনার নাম লিখুন।' : 'Please enter your name.',
        );
        return;
      }
      if (!cleanAddress) {
        setLocalError(
          lang === 'bn' ? 'আপনার ঠিকানা লিখুন।' : 'Please enter your address.',
        );
        return;
      }

      const switchedToLogin = await onPhoneRegister({
        name: cleanName,
        phone: digits,
        address: cleanAddress,
        password,
      });
      if (switchedToLogin) {
        setAuthTab('login');
      }
      return;
    }

    await onPhoneSignIn({ phone: digits, password });
  };

  const displayError = localError || authError;

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
        <div className="p-5 sm:p-6 pb-safe space-y-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-blue-700 mb-1">
              <MessageCircle className="w-3.5 h-3.5" />
              <span>{lang === 'bn' ? 'তাৎক্ষণিক মেসেঞ্জার চ্যাট' : 'Instant Messenger Chat'}</span>
            </div>
            <h2
              id="welcome-popup-title"
              className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight"
            >
              {title}
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-slate-600 leading-relaxed">{subtitle}</p>
          </div>

          {/* Preview incoming bubble from Admin */}
          <div className="flex items-end gap-2.5">
            <Avatar src={settings.adminAvatarURL} name={settings.pageName} size="sm" />
            <div className="bg-slate-100 text-slate-800 text-xs sm:text-sm leading-relaxed px-3.5 py-2.5 rounded-2xl rounded-bl-sm max-w-[88%]">
              {greeting}
            </div>
          </div>

          {/* Demo Mode: Mobile Number + Name + Address + Password (No OTP needed) */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-200/75 rounded-lg">
              <button
                type="button"
                onClick={() => handleSwitchTab('register')}
                className={`inline-flex items-center justify-center gap-1.5 min-h-[38px] px-2 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  authTab === 'register'
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <UserPlus className="w-3.5 h-3.5 shrink-0" />
                <span>{lang === 'bn' ? 'নতুন অ্যাকাউন্ট' : 'New Demo Account'}</span>
              </button>
              <button
                type="button"
                onClick={() => handleSwitchTab('login')}
                className={`inline-flex items-center justify-center gap-1.5 min-h-[38px] px-2 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  authTab === 'login'
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LogIn className="w-3.5 h-3.5 shrink-0" />
                <span>{lang === 'bn' ? 'লগইন করুন' : 'Phone Login'}</span>
              </button>
            </div>

            <form onSubmit={(e) => void handleSubmitPhoneForm(e)} className="space-y-2.5">
              {authTab === 'register' && (
                <div>
                  <label
                    htmlFor="demo-name"
                    className="block text-[11px] font-semibold text-slate-700 mb-1"
                  >
                    {lang === 'bn' ? 'আপনার নাম' : 'Full Name'}
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="demo-name"
                      type="text"
                      required
                      maxLength={FIELD_LIMITS.DISPLAY_NAME_MAX}
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        if (localError) setLocalError(null);
                      }}
                      placeholder={lang === 'bn' ? 'যেমন: রাকিব হাসান' : 'Enter your name'}
                      className="w-full min-h-[42px] pl-9 pr-3 py-2 text-base sm:text-xs bg-white border border-slate-200 rounded-xl focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div>
                <label
                  htmlFor="demo-phone"
                  className="block text-[11px] font-semibold text-slate-700 mb-1"
                >
                  {lang === 'bn' ? 'মোবাইল নম্বর (ভেরিফিকেশন ছাড়া)' : 'Mobile Number (No OTP)'}
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="demo-phone"
                    type="tel"
                    inputMode="tel"
                    required
                    maxLength={FIELD_LIMITS.PHONE_MAX}
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      if (localError) setLocalError(null);
                    }}
                    placeholder="01XXXXXXXXX"
                    className="w-full min-h-[42px] pl-9 pr-3 py-2 text-base sm:text-xs bg-white border border-slate-200 rounded-xl focus:border-blue-500 focus:outline-none font-mono"
                  />
                </div>
              </div>

              {authTab === 'register' && (
                <div>
                  <label
                    htmlFor="demo-address"
                    className="block text-[11px] font-semibold text-slate-700 mb-1"
                  >
                    {lang === 'bn' ? 'ঠিকানা' : 'Address'}
                  </label>
                  <div className="relative">
                    <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="demo-address"
                      type="text"
                      required
                      maxLength={FIELD_LIMITS.ADDRESS_MAX}
                      value={address}
                      onChange={(e) => {
                        setAddress(e.target.value);
                        if (localError) setLocalError(null);
                      }}
                      placeholder={
                        lang === 'bn' ? 'যেমন: মিরপুর, ঢাকা' : 'House / Area / City'
                      }
                      className="w-full min-h-[42px] pl-9 pr-3 py-2 text-base sm:text-xs bg-white border border-slate-200 rounded-xl focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div>
                <label
                  htmlFor="demo-password"
                  className="block text-[11px] font-semibold text-slate-700 mb-1"
                >
                  {lang === 'bn' ? 'পাসওয়ার্ড' : 'Password'}
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="demo-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (localError) setLocalError(null);
                    }}
                    placeholder={
                      lang === 'bn'
                        ? 'কমপক্ষে ৬ অক্ষরের পাসওয়ার্ড'
                        : 'At least 6 characters'
                    }
                    className="w-full min-h-[42px] pl-9 pr-11 py-2 text-base sm:text-xs bg-white border border-slate-200 rounded-xl focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={
                      showPassword
                        ? lang === 'bn'
                          ? 'পাসওয়ার্ড লুকান'
                          : 'Hide password'
                        : lang === 'bn'
                          ? 'পাসওয়ার্ড দেখুন'
                          : 'Show password'
                    }
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 min-w-[36px] min-h-[36px] flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {displayError && (
                <div
                  role="alert"
                  className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 leading-relaxed"
                >
                  {displayError}
                </div>
              )}

              <button
                type="submit"
                disabled={isSigningIn}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-xl transition-transform active:scale-[0.98] cursor-pointer"
              >
                <span>
                  {isSigningIn
                    ? lang === 'bn'
                      ? 'প্রবেশ হচ্ছে...'
                      : 'Connecting...'
                    : authTab === 'register'
                      ? lang === 'bn'
                        ? 'তথ্য দিয়ে ফ্রি চ্যাট শুরু করুন'
                        : 'Register & Start Chatting'
                      : lang === 'bn'
                        ? 'নম্বর ও পাসওয়ার্ড দিয়ে লগইন করুন'
                        : 'Sign In with Phone & Password'}
                </span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </button>

              <p className="text-[11px] text-slate-500 text-center leading-relaxed">
                {authTab === 'register'
                  ? lang === 'bn'
                    ? 'কোনো ফোন ভেরিফিকেশন (OTP) লাগবে না — পরে শুধু এই নম্বর ও পাসওয়ার্ড দিয়ে লগইন করলেই হবে।'
                    : 'No phone verification required — sign back in anytime using your mobile number and password.'
                  : lang === 'bn'
                    ? 'আগে অ্যাকাউন্ট খুলে থাকলে সেই মোবাইল নম্বর ও পাসওয়ার্ড দিয়ে প্রবেশ করুন।'
                    : 'Enter the mobile number and password you used when creating your account.'}
              </p>
            </form>
          </div>

          <div className="relative flex items-center py-0.5">
            <div className="flex-grow border-t border-slate-200" />
            <span className="shrink-0 mx-3 text-[11px] font-medium text-slate-400">
              {lang === 'bn' ? 'অথবা Google দিয়ে' : 'or continue with'}
            </span>
            <div className="flex-grow border-t border-slate-200" />
          </div>

          <div className="space-y-2.5">
            <button
              type="button"
              onClick={onSignIn}
              disabled={isSigningIn}
              className="w-full min-h-[44px] flex items-center justify-center gap-2.5 px-4 py-2.5 text-sm font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 rounded-xl transition-transform active:scale-[0.98] cursor-pointer"
            >
              <span>
                {isSigningIn
                  ? lang === 'bn'
                    ? 'লগইন হচ্ছে...'
                    : 'Connecting...'
                  : lang === 'bn'
                    ? 'Google দিয়ে ফ্রি চ্যাট শুরু করুন'
                    : 'Continue with Google'}
              </span>
              <ArrowRight className="w-4 h-4 shrink-0 text-slate-500" />
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
