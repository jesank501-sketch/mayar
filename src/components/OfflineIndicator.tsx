import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { Language } from '../types';

export const OfflineIndicator: React.FC<{ lang: Language }> = ({ lang }) => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-safe left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>
        {lang === 'bn'
          ? 'অফলাইন মোড · ইন্টারনেট সংযোগ বিচ্ছিন্ন'
          : 'Offline · Waiting for connection'}
      </span>
    </div>
  );
};
