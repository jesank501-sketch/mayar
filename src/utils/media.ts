import { User } from 'firebase/auth';

const SAFE_AVATAR_REGEX =
  /^(https:\/\/.*|\/src\/assets\/.*|data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+)$/;

const SAFE_MEDIA_REGEX =
  /^(https:\/\/.*|\/api\/media\/[a-zA-Z0-9_\-]+\/[a-zA-Z0-9_\-]+\.(mp4|webm|mov|mp3|wav|ogg|m4a|jpg|jpeg|png|webp|gif|aac|amr|3gp)|data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+|data:audio\/(webm|mp4|mpeg|mp3|ogg|wav|x-wav|aac|x-m4a|3gpp);base64,[A-Za-z0-9+/=]+|data:video\/(mp4|webm|quicktime|3gpp);base64,[A-Za-z0-9+/=]+)$/;

export function isSafeAvatarUrl(url: string): boolean {
  if (!url) return true;
  return url.length <= 65536 && SAFE_AVATAR_REGEX.test(url);
}

export function isSafeMediaUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('https://') || url.startsWith('/api/media/')) {
    return url.length <= 1000 && SAFE_MEDIA_REGEX.test(url);
  }
  return url.length <= 900000 && SAFE_MEDIA_REGEX.test(url);
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

export function inferMediaMimeType(
  file: File,
  fallbackKind?: 'image' | 'video' | 'audio',
): string {
  const rawType = file.type ? file.type.split(';')[0].trim().toLowerCase() : '';
  if (rawType && rawType !== 'application/octet-stream') {
    return rawType;
  }
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
    case 'avif':
      return 'image/avif';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    case 'bmp':
      return 'image/bmp';
    case 'mp4':
    case 'm4v':
    case 'mpeg':
    case 'mpg':
    case 'ts':
    case 'mts':
    case 'avi':
    case 'flv':
      return 'video/mp4';
    case 'webm':
    case 'ogv':
      return 'video/webm';
    case 'mov':
      return 'video/quicktime';
    case '3gp':
    case '3g2':
      return 'video/3gpp';
    case 'mkv':
      return 'video/x-matroska';
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
      return 'audio/mp4';
    case 'aac':
      return 'audio/aac';
    case 'ogg':
    case 'opus':
      return 'audio/ogg';
    case 'wav':
      return 'audio/wav';
    case 'amr':
      return 'audio/amr';
    default:
      if (fallbackKind === 'video') return 'video/mp4';
      if (fallbackKind === 'audio') return 'audio/mpeg';
      return '';
  }
}

export async function compressAvatarFile(file: File): Promise<string> {
  const mime = inferMediaMimeType(file);
  if (mime && !mime.startsWith('image/')) {
    throw new Error('Only image files are supported.');
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

function normalizeAudioMimeForDataUrl(rawMime: string): string {
  const base = rawMime.split(';')[0].trim().toLowerCase();
  const allowed = new Set([
    'audio/webm',
    'audio/mp4',
    'audio/mpeg',
    'audio/mp3',
    'audio/ogg',
    'audio/wav',
    'audio/x-wav',
    'audio/aac',
    'audio/x-m4a',
    'audio/3gpp',
  ]);
  if (allowed.has(base)) return base;
  if (base === 'audio/opus') return 'audio/ogg';
  if (base === 'audio/x-aac') return 'audio/aac';
  if (base === 'audio/wave') return 'audio/wav';
  if (base === 'audio/mpeg3' || base === 'audio/x-mpeg-3') return 'audio/mpeg';
  if (base.startsWith('video/webm') || base === 'audio/x-matroska' || base === 'video/x-matroska') {
    return 'audio/webm';
  }
  return 'audio/webm';
}

export function encodePcmFloat32ToWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) {
      view.setUint8(offset + i, s.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

async function compressAudioBlobForFirestore(blob: Blob): Promise<Blob | null> {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx || typeof OfflineAudioContext === 'undefined') return null;

    const arrayBuf = await blob.arrayBuffer();
    const ctx = new AudioCtx();
    try {
      const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
      const ratesToTry = [11025, 8000];
      for (const targetRate of ratesToTry) {
        const frameCount = Math.max(1, Math.ceil(decoded.duration * targetRate));
        const offline = new OfflineAudioContext(1, frameCount, targetRate);
        const src = offline.createBufferSource();
        src.buffer = decoded;
        src.connect(offline.destination);
        src.start(0);
        const rendered = await offline.startRendering();
        const wavBlob = encodePcmFloat32ToWavBlob(rendered.getChannelData(0), targetRate);
        if (wavBlob.size <= 640 * 1024) {
          return wavBlob;
        }
      }
      return null;
    } finally {
      void ctx.close().catch(() => {});
    }
  } catch {
    return null;
  }
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read file'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to encode file'));
    reader.readAsDataURL(blob);
  });
}

export async function compressChatImage(file: File): Promise<{
  blob: Blob;
  dataUrl: string;
  mimeType: string;
}> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('ছবি লোড করা যায়নি। JPG/PNG/WebP ছবি নির্বাচন করুন।'));
      el.src = objectUrl;
    });

    const maxDim = 1080;
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');

    ctx.drawImage(img, 0, 0, width, height);

    let quality = 0.82;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    while (dataUrl.length > 460000 && quality > 0.35) {
      quality -= 0.12;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }

    let targetCanvas = canvas;
    if (dataUrl.length > 580000) {
      const smallerCanvas = document.createElement('canvas');
      smallerCanvas.width = Math.max(1, Math.round(width * 0.7));
      smallerCanvas.height = Math.max(1, Math.round(height * 0.7));
      const smallCtx = smallerCanvas.getContext('2d');
      if (smallCtx) {
        smallCtx.drawImage(canvas, 0, 0, smallerCanvas.width, smallerCanvas.height);
        dataUrl = smallerCanvas.toDataURL('image/jpeg', 0.65);
        targetCanvas = smallerCanvas;
      }
    }

    const blob = await new Promise<Blob>((resolve, reject) => {
      targetCanvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error('Image compression failed'));
        },
        'image/jpeg',
        0.8,
      );
    });

    return {
      blob,
      dataUrl,
      mimeType: 'image/jpeg',
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function blobToSafeAudioDataUrl(
  blob: Blob,
  mimeHint: string,
): Promise<{ dataUrl: string; mimeType: string } | null> {
  if (blob.size <= 0) return null;

  let workingBlob = blob;
  let normalizedMime = normalizeAudioMimeForDataUrl(mimeHint || blob.type || 'audio/webm');

  if (workingBlob.size > 640 * 1024) {
    const compressed = await compressAudioBlobForFirestore(workingBlob);
    if (!compressed) return null;
    workingBlob = compressed;
    normalizedMime = 'audio/wav';
  }

  const cleanBlob = new Blob([workingBlob], { type: normalizedMime });
  const rawDataUrl = await readBlobAsDataUrl(cleanBlob);
  const commaIdx = rawDataUrl.indexOf(',');
  if (commaIdx < 0) return null;
  const base64Part = rawDataUrl.slice(commaIdx + 1);
  const formatted = `data:${normalizedMime};base64,${base64Part}`;
  if (!isSafeMediaUrl(formatted)) return null;
  return { dataUrl: formatted, mimeType: normalizedMime };
}

async function safeParseApiJson<T>(resp: Response, fallbackMsg: string): Promise<T> {
  const rawText = await resp.text();
  const contentType = (resp.headers.get('content-type') ?? '').toLowerCase();
  const trimmed = rawText.trimStart();

  if (trimmed.startsWith('<') || (!contentType.includes('application/json') && trimmed.startsWith('<!'))) {
    throw new Error(
      'BACKEND_HTML_RESPONSE: সার্ভার API পাওয়া যায়নি।',
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
  mediaKind?: 'image' | 'video' | 'audio';
}): Promise<{ url: string; mediaType: 'image' | 'video' | 'audio'; mimeType: string }> {
  const token = await params.user.getIdToken();
  const baseMime = params.mimeType.split(';')[0].trim().toLowerCase() || 'application/octet-stream';

  const resp = await fetch('/api/media/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': baseMime,
      'X-Media-Mime': baseMime,
      ...(params.mediaKind ? { 'X-Media-Kind': params.mediaKind } : {}),
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

function normalizeVideoMimeForDataUrl(rawMime: string): string {
  const base = rawMime.split(';')[0].trim().toLowerCase();
  if (base === 'video/webm' || base === 'video/ogg') return 'video/webm';
  if (base === 'video/quicktime') return 'video/quicktime';
  if (base === 'video/3gpp' || base === 'video/3gpp2') return 'video/3gpp';
  return 'video/mp4';
}

function generateUploadId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/[^a-zA-Z0-9_-]/g, '');
  }
  return `vid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const VIDEO_CHUNK_BYTES = 3.5 * 1024 * 1024;

export async function uploadChatVideoWithFallback(params: {
  file: File;
  mimeType: string;
  threadId: string;
  user: User;
  onProgress?: (percent: number) => void;
}): Promise<{ url: string; mediaType: 'video'; mimeType: string }> {
  const cleanMime = (
    params.mimeType || inferMediaMimeType(params.file, 'video') || 'video/mp4'
  )
    .split(';')[0]
    .trim()
    .toLowerCase();

  try {
    if (params.file.size <= VIDEO_CHUNK_BYTES) {
      params.onProgress?.(25);
      const uploaded = await uploadMediaFile({
        file: params.file,
        mimeType: cleanMime,
        threadId: params.threadId,
        user: params.user,
        mediaKind: 'video',
      });
      params.onProgress?.(100);
      if (uploaded.url && isSafeMediaUrl(uploaded.url)) {
        return {
          url: uploaded.url,
          mediaType: 'video',
          mimeType: uploaded.mimeType,
        };
      }
    } else {
      const totalChunks = Math.ceil(params.file.size / VIDEO_CHUNK_BYTES);
      const uploadId = generateUploadId();
      const token = await params.user.getIdToken();

      for (let idx = 0; idx < totalChunks; idx += 1) {
        const start = idx * VIDEO_CHUNK_BYTES;
        const end = Math.min(params.file.size, start + VIDEO_CHUNK_BYTES);
        const chunkBlob = params.file.slice(start, end);

        const resp = await fetch('/api/media/upload-chunk', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/octet-stream',
            'X-Media-Mime': cleanMime,
            'X-Media-Kind': 'video',
            'X-Thread-Id': params.threadId,
            'X-Upload-Id': uploadId,
            'X-Chunk-Index': String(idx),
            'X-Total-Chunks': String(totalChunks),
          },
          body: chunkBlob,
        });

        const parsed = await safeParseApiJson<{
          ok: boolean;
          complete?: boolean;
          url?: string;
          mimeType?: string;
        }>(resp, 'ভিডিও আপলোড ব্যর্থ হয়েছে।');

        params.onProgress?.(Math.min(99, Math.round(((idx + 1) / totalChunks) * 100)));

        if (parsed.complete && parsed.url && isSafeMediaUrl(parsed.url)) {
          params.onProgress?.(100);
          return {
            url: parsed.url,
            mediaType: 'video',
            mimeType: parsed.mimeType || cleanMime,
          };
        }
      }
      throw new Error('ভিডিও আপলোড সম্পন্ন হয়নি। অনুগ্রহ করে আবার চেষ্টা করুন।');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    const isBackendMissing =
      msg.includes('BACKEND_HTML_RESPONSE') ||
      msg.includes('Failed to fetch') ||
      msg.includes('Load failed') ||
      msg.includes('NetworkError');

    if (isBackendMissing && params.file.size <= 640 * 1024) {
      const normalized = normalizeVideoMimeForDataUrl(cleanMime);
      const rawDataUrl = await readBlobAsDataUrl(new Blob([params.file], { type: normalized }));
      const commaIdx = rawDataUrl.indexOf(',');
      if (commaIdx >= 0) {
        const formatted = `data:${normalized};base64,${rawDataUrl.slice(commaIdx + 1)}`;
        if (isSafeMediaUrl(formatted)) {
          return {
            url: formatted,
            mediaType: 'video',
            mimeType: normalized,
          };
        }
      }
    }
    throw err;
  }

  throw new Error('ভিডিও আপলোড ব্যর্থ হয়েছে।');
}

export async function uploadChatPhotoWithFallback(params: {
  file: File;
  threadId: string;
  user: User;
}): Promise<{ url: string; mediaType: 'image'; mimeType: string }> {
  const compressed = await compressChatImage(params.file);

  try {
    const uploaded = await uploadMediaFile({
      file: compressed.blob,
      mimeType: compressed.mimeType,
      threadId: params.threadId,
      user: params.user,
      mediaKind: 'image',
    });
    if (uploaded.url && isSafeMediaUrl(uploaded.url)) {
      return {
        url: uploaded.url,
        mediaType: 'image',
        mimeType: uploaded.mimeType,
      };
    }
  } catch {
    // Fallback to direct Firestore-safe compressed JPEG data URL (works on Netlify & offline)
  }

  if (!isSafeMediaUrl(compressed.dataUrl)) {
    throw new Error('ছবির সাইজ অনেক বড়। অনুগ্রহ করে অপেক্ষাকৃত ছোট ছবি দিন।');
  }

  return {
    url: compressed.dataUrl,
    mediaType: 'image',
    mimeType: compressed.mimeType,
  };
}

export async function uploadAudioWithFallback(params: {
  file: Blob;
  mimeType: string;
  threadId: string;
  user: User;
}): Promise<{ url: string; mediaType: 'audio'; mimeType: string }> {
  const cleanMime = params.mimeType.split(';')[0].trim().toLowerCase() || 'audio/webm';

  try {
    const uploaded = await uploadMediaFile({
      file: params.file,
      mimeType: cleanMime,
      threadId: params.threadId,
      user: params.user,
      mediaKind: 'audio',
    });
    if (uploaded.url && isSafeMediaUrl(uploaded.url)) {
      return {
        url: uploaded.url,
        mediaType: 'audio',
        mimeType: uploaded.mimeType,
      };
    }
  } catch {
    // Fallback to direct Firestore-safe audio data URL (works on Netlify static hosting too)
  }

  const encoded = await blobToSafeAudioDataUrl(params.file, cleanMime);
  if (!encoded) {
    throw new Error(
      'ভয়েস বা অডিও ফাইলটি সাইজে অনেক বড়। অনুগ্রহ করে ১ মিনিটের মধ্যে ভয়েস রেকর্ড করে পাঠান।',
    );
  }

  return {
    url: encoded.dataUrl,
    mediaType: 'audio',
    mimeType: encoded.mimeType,
  };
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
