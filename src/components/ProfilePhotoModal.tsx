import React, { useRef, useState } from 'react';
import { Camera, Upload, X } from 'lucide-react';
import { Language } from '../types';
import { compressAvatarFile, isSafeAvatarUrl } from '../utils/media';
import { Avatar } from './Avatar';

interface ProfilePhotoModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPhotoURL: string;
  displayName: string;
  lang: Language;
  onSavePhoto: (newPhotoURL: string) => Promise<void>;
}

export const ProfilePhotoModal: React.FC<ProfilePhotoModalProps> = ({
  isOpen,
  onClose,
  currentPhotoURL,
  displayName,
  lang,
  onSavePhoto,
}) => {
  const [previewURL, setPreviewURL] = useState(currentPhotoURL);
  const [urlInput, setUrlInput] = useState(
    currentPhotoURL.startsWith('https://') ? currentPhotoURL : '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const compressed = await compressAvatarFile(file);
      setPreviewURL(compressed);
      setUrlInput('');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : lang === 'bn'
            ? 'ছবিটি প্রসেস করা যায়নি।'
            : 'Could not process image.',
      );
    }
  };

  const handleUrlApply = () => {
    const cleaned = urlInput.trim();
    if (!cleaned) return;
    if (!cleaned.startsWith('https://') || !isSafeAvatarUrl(cleaned)) {
      setError(
        lang === 'bn'
          ? 'সঠিক https:// ইমেজ লিংক দিন।'
          : 'Please enter a valid https:// image URL.',
      );
      return;
    }
    setError(null);
    setPreviewURL(cleaned);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSavePhoto(previewURL);
      onClose();
    } catch {
      setError(
        lang === 'bn'
          ? 'প্রোফাইল ছবি সেভ করা যায়নি।'
          : 'Failed to save profile photo.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/45 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">
            {lang === 'bn' ? 'প্রোফাইল ছবি পরিবর্তন করুন' : 'Change Profile Picture'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="flex flex-col items-center gap-3">
            <Avatar src={previewURL} name={displayName} size="xl" />
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => void handleFilePick(e)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>
                {lang === 'bn' ? 'ডিভাইস থেকে ছবি আপলোড করুন' : 'Upload Photo from Device'}
              </span>
            </button>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-600">
              {lang === 'bn' ? 'অথবা ছবির HTTPS লিংক দিন' : 'Or paste an HTTPS image URL'}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://..."
                className="flex-1 px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleUrlApply}
                className="px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
              >
                {lang === 'bn' ? 'প্রিভিউ' : 'Preview'}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              {lang === 'bn' ? 'বাতিল' : 'Cancel'}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>
                {saving
                  ? lang === 'bn'
                    ? 'সেভ হচ্ছে...'
                    : 'Saving...'
                  : lang === 'bn'
                    ? 'ছবি সেভ করুন'
                    : 'Save Photo'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
