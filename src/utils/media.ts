import { User } from 'firebase/auth';

const SAFE_AVATAR_REGEX =
  /^(https:\/\/.*|\/src\/assets\/.*|data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+)$/;

const SAFE_MEDIA_REGEX =
  /^(https:\/\/.*|\/api\/media\/[a-zA-Z0-9_\-]+\/[a-zA-Z0-9_\-]+\.(mp4|webm|mov|mp3|wav|ogg|m4a|jpg|jpeg|png|webp|gif))$/;

export function isSafeAvatarUrl(url: string): boolean {
  if (!url) return true;
  return url.length <= 65536 && SAFE_AVATAR_REGEX.test(url);
}

export function isSafeMediaUrl(url: string): boolean {
  if (!url) return false;
  return url.length <= 1000 && SAFE_MEDIA_REGEX.test(url);
}

export function extractYouTubeEmbedUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    let videoId: string | null = null;
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (parsed.pathname === '/watch') {
        videoId = parsed.searchParams.get('v');
      } else if (parsed.pathname.startsWith('/shorts/')) {
        videoId = parsed.pathname.split('/')[2] ?? null;
      }
    } else if (host === 'youtu.be') {
      videoId = parsed.pathname.slice(1).split('/')[0] ?? null;
    }
    if (videoId && /^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) {
      return `https://www.youtube-nocookie.com/embed/${videoId}`;
    }
    return null;
  } catch {
    return null;
  }
}

export function inferMediaMimeType(file: File): string {
  if (file.type) return file.type.split(';')[0].trim().toLowerCase();
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'mp4':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mov':
      return 'video/quicktime';
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
      return 'audio/mp4';
    case 'ogg':
      return 'audio/ogg';
    case 'wav':
      return 'audio/wav';
    default:
      return '';
  }
}

export async function compressAvatarFile(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Only JPG, PNG, or WebP images are supported.');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to load selected image.'));
      el.src = objectUrl;
    });

    const size = 192;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');

    const minDim = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - minDim) / 2;
    const sy = (img.naturalHeight - minDim) / 2;

    ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);

    let dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    if (dataUrl.length > 52000) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.6);
    }
    if (dataUrl.length > 65000) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.45);
    }
    if (!isSafeAvatarUrl(dataUrl)) {
      throw new Error('Compressed image exceeded size limit.');
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function safeParseApiJson<T>(resp: Response, fallbackMsg: string): Promise<T> {
  const rawText = await resp.text();
  const contentType = (resp.headers.get('content-type') ?? '').toLowerCase();
  const trimmed = rawText.trimStart();

  if (trimmed.startsWith('<') || (!contentType.includes('application/json') && trimmed.startsWith('<!'))) {
    throw new Error(
      'সার্ভার থেকে সঠিক JSON উত্তর পাওয়া যায়নি (HTML পেজ এসেছে)। অনুগ্রহ করে পেজটি রিলোড (Refresh) করে আবার চেষ্টা করুন।',
    );
  }

  let parsed: (T & { error?: string }) | null = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText) as T & { error?: string };
    } catch {
      if (!resp.ok) {
        throw new Error(fallbackMsg);
      }
      throw new Error('সার্ভার রেসপন্স পড়া যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।');
    }
  }

  if (!resp.ok) {
    throw new Error(parsed?.error || fallbackMsg);
  }

  if (!parsed) {
    throw new Error(fallbackMsg);
  }

  return parsed;
}

export async function uploadMediaFile(params: {
  file: Blob;
  mimeType: string;
  threadId: string;
  user: User;
}): Promise<{ url: string; mediaType: 'image' | 'video' | 'audio'; mimeType: string }> {
  const token = await params.user.getIdToken();
  const baseMime = params.mimeType.split(';')[0].trim().toLowerCase();

  const resp = await fetch('/api/media/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': baseMime,
      'X-Media-Mime': baseMime,
      'X-Thread-Id': params.threadId,
    },
    body: params.file,
  });

  return safeParseApiJson<{
    url: string;
    mediaType: 'image' | 'video' | 'audio';
    mimeType: string;
  }>(resp, 'Media upload failed');
}

export type GoogleFemaleVoiceName = 'Kore';

export async function convertVoiceToGoogleFemaleVoice(params: {
  file: Blob;
  mimeType: string;
  threadId: string;
  user: User;
  voiceName?: GoogleFemaleVoiceName;
}): Promise<{
  url: string;
  mediaType: 'audio';
  mimeType: string;
  transcript: string;
}> {
  const token = await params.user.getIdToken();
  const baseMime = params.mimeType.split(';')[0].trim().toLowerCase() || 'audio/webm';

  const resp = await fetch('/api/voice/female-convert', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': baseMime,
      'X-Media-Mime': baseMime,
      'X-Thread-Id': params.threadId,
      'X-Voice-Name': params.voiceName ?? 'Kore',
    },
    body: params.file,
  });

  return safeParseApiJson<{
    url: string;
    mediaType: 'audio';
    mimeType: string;
    transcript: string;
  }>(resp, 'Google female voice conversion failed');
}

export async function generateGoogleFemaleVoiceFromText(params: {
  text: string;
  threadId: string;
  user: User;
  voiceName?: GoogleFemaleVoiceName;
}): Promise<{ url: string; mediaType: 'audio'; mimeType: string }> {
  const token = await params.user.getIdToken();

  const resp = await fetch('/api/voice/female-tts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: params.text,
      threadId: params.threadId,
      voiceName: params.voiceName ?? 'Kore',
    }),
  });

  return safeParseApiJson<{
    url: string;
    mediaType: 'audio';
    mimeType: string;
  }>(resp, 'Google female voice generation failed');
}
