import React, { useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Language } from '../types';

interface PWAInstallButtonProps {
  lang: Language;
  variant?: 'primary' | 'compact' | 'header';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  lang,
  variant = 'compact',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (!accepted) {
        setShowGuide(true);
      }
      return;
    }
    setShowGuide(true);
  };

  const buttonClasses =
    variant === 'primary'
      ? 'w-full sm:w-auto min-h-[48px] inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition-transform active:scale-[0.98] whitespace-nowrap shrink-0 cursor-pointer'
      : variant === 'header'
        ? 'min-h-[40px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer'
        : 'min-h-[44px] min-w-[44px] inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer';

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        aria-label={lang === 'bn' ? 'মোবাইল অ্যাপ ইনস্টল করুন' : 'Install Mobile App'}
        className={buttonClasses}
      >
        <Download className="w-4 h-4 shrink-0" />
        <span className={variant === 'compact' ? 'hidden sm:inline' : ''}>
          {lang === 'bn' ? 'অ্যাপ ইনস্টল করুন' : 'Install App'}
        </span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/50 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-guide-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl shadow-xl overflow-hidden">
            <div className="sm:hidden pt-2.5 pb-1 flex justify-center">
              <span className="w-10 h-1 rounded-full bg-slate-300" aria-hidden="true" />
            </div>

            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <Smartphone className="w-5 h-5" />
                </div>
                <h3
                  id="pwa-install-guide-title"
                  className="text-base font-bold text-slate-900"
                >
                  {lang === 'bn'
                    ? 'মোবাইলে অ্যাপ হিসেবে ইনস্টল করুন'
                    : 'Install App on Your Phone'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label={lang === 'bn' ? 'বন্ধ করুন' : 'Close'}
                className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 pb-safe space-y-4 text-sm text-slate-700 leading-relaxed">
              {isIOS ? (
                <ol className="space-y-2.5 list-decimal list-inside">
                  <li>
                    {lang === 'bn' ? (
                      <>
                        Safari ব্রাউজারের নিচে{' '}
                        <span className="inline-flex items-center gap-1 font-semibold text-slate-900">
                          <Share className="w-3.5 h-3.5" /> Share
                        </span>{' '}
                        বাটনে ট্যাপ করুন।
                      </>
                    ) : (
                      <>
                        Tap the <strong>Share</strong> button in Safari&apos;s toolbar.
                      </>
                    )}
                  </li>
                  <li>
                    {lang === 'bn' ? (
                      <>
                        নিচে স্ক্রল করে <strong>Add to Home Screen</strong> সিলেক্ট করুন।
                      </>
                    ) : (
                      <>
                        Scroll down and tap <strong>Add to Home Screen</strong>.
                      </>
                    )}
                  </li>
                  <li>
                    {lang === 'bn'
                      ? 'উপরের Add বাটনে চাপলেই হোম স্ক্রিনে অ্যাপ আইকন চলে আসবে।'
                      : 'Tap Add in the top corner to install it on your Home Screen.'}
                  </li>
                </ol>
              ) : (
                <ol className="space-y-2.5 list-decimal list-inside">
                  <li>
                    {lang === 'bn' ? (
                      <>
                        Facebook অ্যাপের ভেতরে থাকলে ডান উপরের মেনু (<strong>⋮</strong>) থেকে{' '}
                        <strong>Open in Chrome / Browser</strong> চাপুন।
                      </>
                    ) : (
                      <>
                        If opened inside Facebook, tap <strong>⋮</strong> and select{' '}
                        <strong>Open in Chrome</strong>.
                      </>
                    )}
                  </li>
                  <li>
                    {lang === 'bn' ? (
                      <>
                        Chrome ব্রাউজারের ডান উপরের মেনু (<strong>⋮</strong>) থেকে{' '}
                        <strong>Install app</strong> বা <strong>Add to Home screen</strong> ট্যাপ করুন।
                      </>
                    ) : (
                      <>
                        In Chrome, open the <strong>⋮</strong> menu and tap{' '}
                        <strong>Install app</strong> or <strong>Add to Home screen</strong>.
                      </>
                    )}
                  </li>
                </ol>
              )}

              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="w-full min-h-[44px] py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors cursor-pointer"
              >
                {lang === 'bn' ? 'বুঝেছি' : 'Got it'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
