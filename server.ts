import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http, { type IncomingMessage } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { PushSubscription as WebPushSubscription } from 'web-push';

const require = createRequire(import.meta.url);
const webpush = require('web-push') as typeof import('web-push');

interface FirebaseAppletConfig {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId: string;
}

const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
const firebaseConfig = JSON.parse(
  fs.readFileSync(configPath, 'utf-8'),
) as FirebaseAppletConfig;

const BOOTSTRAPPED_ADMIN_EMAIL = 'jesank501@gmail.com';
const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const PUSH_STORE_DIR = path.resolve(UPLOAD_ROOT, '_push');
fs.mkdirSync(PUSH_STORE_DIR, { recursive: true });
const VAPID_KEYS_PATH = path.join(PUSH_STORE_DIR, 'vapid.json');
const SUBSCRIPTIONS_PATH = path.join(PUSH_STORE_DIR, 'subscriptions.json');

interface VapidKeyPair {
  publicKey: string;
  privateKey: string;
}

function loadOrCreateVapidKeys(): VapidKeyPair {
  const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (envPub && envPriv) {
    return { publicKey: envPub, privateKey: envPriv };
  }
  try {
    if (fs.existsSync(VAPID_KEYS_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(VAPID_KEYS_PATH, 'utf-8')) as Partial<VapidKeyPair>;
      if (parsed.publicKey && parsed.privateKey) {
        return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
      }
    }
  } catch {
    // Regenerate on corrupt file
  }
  const generated = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_KEYS_PATH, JSON.stringify(generated, null, 2));
  return generated;
}

const vapidKeys = loadOrCreateVapidKeys();
webpush.setVapidDetails(
  `mailto:${BOOTSTRAPPED_ADMIN_EMAIL}`,
  vapidKeys.publicKey,
  vapidKeys.privateKey,
);

type SubscriptionMap = Record<string, WebPushSubscription[]>;

function loadPushSubscriptions(): SubscriptionMap {
  try {
    if (fs.existsSync(SUBSCRIPTIONS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(SUBSCRIPTIONS_PATH, 'utf-8')) as unknown;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        return raw as SubscriptionMap;
      }
    }
  } catch {
    // Return empty map on parse error
  }
  return {};
}

const pushSubscriptions: SubscriptionMap = loadPushSubscriptions();

function savePushSubscriptions(): void {
  try {
    fs.writeFileSync(SUBSCRIPTIONS_PATH, JSON.stringify(pushSubscriptions, null, 2));
  } catch (err) {
    console.error('Failed to persist push subscriptions:', err);
  }
}

function isValidWebPushSubscription(sub: unknown): sub is WebPushSubscription {
  if (!sub || typeof sub !== 'object') return false;
  const candidate = sub as Partial<WebPushSubscription>;
  if (
    typeof candidate.endpoint !== 'string' ||
    !candidate.endpoint.startsWith('https://') ||
    candidate.endpoint.length > 2000
  ) {
    return false;
  }
  if (!candidate.keys || typeof candidate.keys !== 'object') return false;
  return (
    typeof candidate.keys.p256dh === 'string' &&
    candidate.keys.p256dh.length > 10 &&
    typeof candidate.keys.auth === 'string' &&
    candidate.keys.auth.length > 6
  );
}

const SAFE_ID_REGEX = /^[a-zA-Z0-9_\-]{1,128}$/;
const SAFE_FILE_REGEX =
  /^[a-zA-Z0-9_\-]+\.(mp4|webm|mov|mp3|wav|ogg|m4a|jpg|jpeg|png|webp|gif)$/;

const MIME_MAP: Record<
  string,
  { ext: string; kind: 'image' | 'video' | 'audio'; contentType: string }
> = {
  'image/jpeg': { ext: 'jpg', kind: 'image', contentType: 'image/jpeg' },
  'image/jpg': { ext: 'jpg', kind: 'image', contentType: 'image/jpeg' },
  'image/png': { ext: 'png', kind: 'image', contentType: 'image/png' },
  'image/webp': { ext: 'webp', kind: 'image', contentType: 'image/webp' },
  'image/gif': { ext: 'gif', kind: 'image', contentType: 'image/gif' },
  'video/mp4': { ext: 'mp4', kind: 'video', contentType: 'video/mp4' },
  'video/webm': { ext: 'webm', kind: 'video', contentType: 'video/webm' },
  'video/quicktime': { ext: 'mov', kind: 'video', contentType: 'video/quicktime' },
  'audio/webm': { ext: 'webm', kind: 'audio', contentType: 'audio/webm' },
  'audio/mp4': { ext: 'm4a', kind: 'audio', contentType: 'audio/mp4' },
  'audio/x-m4a': { ext: 'm4a', kind: 'audio', contentType: 'audio/mp4' },
  'audio/aac': { ext: 'm4a', kind: 'audio', contentType: 'audio/mp4' },
  'audio/mpeg': { ext: 'mp3', kind: 'audio', contentType: 'audio/mpeg' },
  'audio/mp3': { ext: 'mp3', kind: 'audio', contentType: 'audio/mpeg' },
  'audio/ogg': { ext: 'ogg', kind: 'audio', contentType: 'audio/ogg' },
  'audio/wav': { ext: 'wav', kind: 'audio', contentType: 'audio/wav' },
  'audio/wave': { ext: 'wav', kind: 'audio', contentType: 'audio/wav' },
  'audio/x-wav': { ext: 'wav', kind: 'audio', contentType: 'audio/wav' },
  'audio/flac': { ext: 'flac', kind: 'audio', contentType: 'audio/flac' },
  'audio/x-flac': { ext: 'flac', kind: 'audio', contentType: 'audio/flac' },
  'audio/3gpp': { ext: 'm4a', kind: 'audio', contentType: 'audio/3gpp' },
};

function resolveRequestedMime(req: Pick<IncomingMessage, 'headers'>): string {
  const headerMime = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (headerMime in MIME_MAP) return headerMime;
  const fallbackMime = String(req.headers['x-media-mime'] ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  return fallbackMime in MIME_MAP ? fallbackMime : headerMime;
}

const EXT_TO_CONTENT_TYPE: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

interface VerifiedCaller {
  uid: string;
  email: string;
  emailVerified: boolean;
}

async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedCaller | null> {
  if (!idToken || idToken.length > 4096) return null;
  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      },
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }>;
    };
    const user = data.users?.[0];
    if (!user?.localId) return null;
    return {
      uid: user.localId,
      email: user.email ?? '',
      emailVerified: Boolean(user.emailVerified),
    };
  } catch {
    return null;
  }
}

async function checkAdminDocWithToken(uid: string, idToken: string): Promise<boolean> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseConfig.projectId)}/databases/${encodeURIComponent(firebaseConfig.firestoreDatabaseId)}/documents/admins/${encodeURIComponent(uid)}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    return resp.ok;
  } catch {
    return false;
  }
}

const CANONICAL_FEMALE_VOICE = 'Kore';
const UNIFIED_VOICE_STYLE =
  'Single consistent young woman speaker, steady natural pitch, calm warm tone, even conversational pace, identical vocal identity across every reply';

function getGeminiClient(apiVersion: 'v1beta' | 'v1' = 'v1beta'): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    apiVersion,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isModelNotFoundOrUnsupportedError(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  if (status === 404) return true;
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return (
    msg.includes('NOT_FOUND') ||
    msg.includes('is not found') ||
    msg.includes('is not supported for generateContent')
  );
}

async function transcribeAdminAudio(params: {
  base64Audio: string;
  mimeType: string;
}): Promise<string> {
  const candidates: Array<{ apiVersion: 'v1beta' | 'v1'; model: string }> = [
    { apiVersion: 'v1beta', model: 'gemini-3.5-transcribe' },
    { apiVersion: 'v1beta', model: 'gemini-4-hydrogen' },
    { apiVersion: 'v1', model: 'gemini-4-hydrogen' },
  ];

  let lastNotFoundErr: unknown;
  for (const candidate of candidates) {
    const ai = getGeminiClient(candidate.apiVersion);
    if (!ai) {
      throw new Error('GEMINI_API_KEY_MISSING');
    }
    try {
      const transcribeResp = await ai.models.generateContent({
        model: candidate.model,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: params.mimeType,
                data: params.base64Audio,
              },
            },
            {
              text: 'Transcribe the exact spoken words in this audio accurately. Preserve Bengali in Bengali script and English in English, keeping natural punctuation and tone. Return ONLY the spoken transcript text without timestamps, speaker labels, or explanations.',
            },
          ],
        },
      });
      return (transcribeResp.text ?? '').trim();
    } catch (err) {
      if (isModelNotFoundOrUnsupportedError(err)) {
        console.warn(
          `Audio transcription model ${candidate.model} (${candidate.apiVersion}) unavailable, trying fallback:`,
          err instanceof Error ? err.message : err,
        );
        lastNotFoundErr = err;
        continue;
      }
      throw err;
    }
  }

  throw lastNotFoundErr instanceof Error
    ? lastNotFoundErr
    : new Error('No supported audio transcription model available');
}

function normalizeWavAudioBuffer(wavBuffer: Buffer): Buffer {
  if (
    wavBuffer.length < 44 ||
    wavBuffer.toString('ascii', 0, 4) !== 'RIFF' ||
    wavBuffer.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    return wavBuffer;
  }

  let offset = 12;
  let audioFormat = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= wavBuffer.length) {
    const chunkId = wavBuffer.toString('ascii', offset, offset + 4);
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);
    const payloadOffset = offset + 8;

    if (chunkId === 'fmt ' && payloadOffset + 16 <= wavBuffer.length) {
      audioFormat = wavBuffer.readUInt16LE(payloadOffset);
      bitsPerSample = wavBuffer.readUInt16LE(payloadOffset + 14);
    } else if (chunkId === 'data') {
      dataOffset = payloadOffset;
      dataSize = Math.min(chunkSize, wavBuffer.length - payloadOffset);
      break;
    }

    offset = payloadOffset + chunkSize + (chunkSize % 2);
  }

  if (audioFormat !== 1 || bitsPerSample !== 16 || dataOffset < 0 || dataSize < 64) {
    return wavBuffer;
  }

  const sampleCount = Math.floor(dataSize / 2);
  if (sampleCount < 32) return wavBuffer;

  const out = Buffer.from(wavBuffer);
  let sum = 0;
  for (let i = 0; i < sampleCount; i++) {
    sum += out.readInt16LE(dataOffset + i * 2);
  }
  const dcOffset = sum / sampleCount;

  let sumSq = 0;
  for (let i = 0; i < sampleCount; i++) {
    const centered = out.readInt16LE(dataOffset + i * 2) - dcOffset;
    sumSq += centered * centered;
  }
  const rms = Math.sqrt(sumSq / sampleCount);
  if (!Number.isFinite(rms) || rms < 40) {
    return wavBuffer;
  }

  // Target steady conversational level (~ -17.5 dBFS RMS) across all clips
  const targetRms = 4400;
  const gain = Math.min(3.2, Math.max(0.5, targetRms / rms));
  const softThreshold = 25000;
  const maxSample = 32000;
  const fadeSamples = Math.min(360, Math.floor(sampleCount / 8));

  for (let i = 0; i < sampleCount; i++) {
    let sample = (out.readInt16LE(dataOffset + i * 2) - dcOffset) * gain;

    if (fadeSamples > 0) {
      if (i < fadeSamples) {
        sample *= i / fadeSamples;
      } else if (i > sampleCount - fadeSamples) {
        sample *= (sampleCount - i) / fadeSamples;
      }
    }

    const absVal = Math.abs(sample);
    if (absVal > softThreshold) {
      const excess = (absVal - softThreshold) / (maxSample - softThreshold);
      const compressed = softThreshold + (maxSample - softThreshold) * Math.tanh(excess);
      sample = Math.sign(sample) * compressed;
    }

    const clamped = Math.max(-32767, Math.min(32767, Math.round(sample)));
    out.writeInt16LE(clamped, dataOffset + i * 2);
  }

  return out;
}

async function synthesizeGoogleFemaleVoiceWav(params: {
  text: string;
}): Promise<Buffer> {
  const candidates: Array<{ apiVersion: 'v1beta' | 'v1'; model: string }> = [
    { apiVersion: 'v1beta', model: 'gemini-3.8-flash-lite-tts' },
    { apiVersion: 'v1', model: 'gemini-3.8-flash-lite-tts' },
    { apiVersion: 'v1beta', model: 'gemini-3.8-flash-tts' },
  ];

  let lastNotFoundErr: unknown;
  for (const candidate of candidates) {
    const ai = getGeminiClient(candidate.apiVersion);
    if (!ai) {
      throw new Error('GEMINI_API_KEY_MISSING');
    }
    try {
      const ttsResponse = await ai.models.generateContent({
        model: candidate.model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: params.text,
                speechMetadata: {
                  style: UNIFIED_VOICE_STYLE,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: CANONICAL_FEMALE_VOICE },
            },
          },
        },
      });

      const base64Wav =
        ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Wav) {
        throw new Error('Google female voice synthesis returned empty audio');
      }
      return normalizeWavAudioBuffer(Buffer.from(base64Wav, 'base64'));
    } catch (err) {
      if (isModelNotFoundOrUnsupportedError(err)) {
        console.warn(
          `Female TTS model ${candidate.model} (${candidate.apiVersion}) unavailable, trying fallback:`,
          err instanceof Error ? err.message : err,
        );
        lastNotFoundErr = err;
        continue;
      }
      throw err;
    }
  }

  throw lastNotFoundErr instanceof Error
    ? lastNotFoundErr
    : new Error('No supported Google female TTS model available');
}

function sendGeminiVoiceError(res: Response, err: unknown, defaultMsg: string): void {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (msg === 'GEMINI_API_KEY_MISSING') {
    res.status(503).json({
      error: 'Google voice service API key is not configured on the server.',
    });
    return;
  }
  if (msg.includes('API_KEY_INVALID') || msg.includes('PERMISSION_DENIED')) {
    res.status(502).json({
      error: 'Google Voice API key rejected. Please check your key in Settings > Secrets.',
    });
    return;
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
    res.status(429).json({
      error: 'Google Voice service is temporarily busy. Please try again in a moment.',
    });
    return;
  }
  if (isModelNotFoundOrUnsupportedError(err)) {
    res.status(502).json({
      error: 'Google Voice model is currently unavailable for this API key. Please try again later.',
    });
    return;
  }
  res.status(502).json({ error: defaultMsg });
}

async function saveThreadMediaBuffer(params: {
  threadId: string;
  ext: string;
  buffer: Buffer;
}): Promise<string> {
  const threadDir = path.resolve(UPLOAD_ROOT, params.threadId);
  if (!threadDir.startsWith(UPLOAD_ROOT + path.sep)) {
    throw new Error('Invalid storage path');
  }
  fs.mkdirSync(threadDir, { recursive: true });

  const fileName = `${crypto.randomUUID()}.${params.ext}`;
  const destPath = path.resolve(threadDir, fileName);
  if (!destPath.startsWith(threadDir + path.sep)) {
    throw new Error('Invalid file destination');
  }

  await fs.promises.writeFile(destPath, params.buffer);
  return `/api/media/${params.threadId}/${fileName}`;
}

async function startServer(): Promise<void> {
  const app = express();
  app.disable('x-powered-by');

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post(
    '/api/media/upload',
    express.raw({
      limit: '26mb',
      type: (req) => {
        const raw = resolveRequestedMime(req);
        return raw in MIME_MAP;
      },
    }),
    async (req: Request, res: Response) => {
      try {
        const authHeader = req.headers.authorization ?? '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        const caller = await verifyFirebaseIdToken(token);
        if (!caller || !caller.emailVerified) {
          res.status(401).json({ error: 'Authentication required' });
          return;
        }

        const threadId = String(req.headers['x-thread-id'] ?? '').trim();
        if (!SAFE_ID_REGEX.test(threadId)) {
          res.status(400).json({ error: 'Invalid thread identifier' });
          return;
        }

        const isOwner = threadId === caller.uid;
        const isBootstrappedAdmin =
          caller.email === BOOTSTRAPPED_ADMIN_EMAIL && caller.emailVerified;
        const isAllowedAdmin =
          isBootstrappedAdmin || (await checkAdminDocWithToken(caller.uid, token));

        if (!isOwner && !isAllowedAdmin) {
          res.status(403).json({ error: 'Not authorized to upload to this thread' });
          return;
        }

        const baseMime = resolveRequestedMime(req);
        const mimeInfo = MIME_MAP[baseMime];
        if (!mimeInfo) {
          res.status(415).json({ error: 'Unsupported media format' });
          return;
        }

        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          res.status(400).json({ error: 'Empty media payload' });
          return;
        }

        const maxBytes =
          mimeInfo.kind === 'video'
            ? 25 * 1024 * 1024
            : mimeInfo.kind === 'audio'
              ? 15 * 1024 * 1024
              : 10 * 1024 * 1024;
        if (req.body.length > maxBytes) {
          res.status(413).json({ error: 'File exceeds maximum allowed size' });
          return;
        }

        const threadDir = path.resolve(UPLOAD_ROOT, threadId);
        if (!threadDir.startsWith(UPLOAD_ROOT + path.sep)) {
          res.status(400).json({ error: 'Invalid storage path' });
          return;
        }
        fs.mkdirSync(threadDir, { recursive: true });

        const fileName = `${crypto.randomUUID()}.${mimeInfo.ext}`;
        const destPath = path.resolve(threadDir, fileName);
        if (!destPath.startsWith(threadDir + path.sep)) {
          res.status(400).json({ error: 'Invalid file destination' });
          return;
        }

        await fs.promises.writeFile(destPath, req.body);

        res.status(201).json({
          url: `/api/media/${threadId}/${fileName}`,
          mediaType: mimeInfo.kind,
          mimeType: mimeInfo.contentType,
          sizeBytes: req.body.length,
        });
      } catch (err) {
        console.error('Media upload failed:', err);
        res.status(500).json({ error: 'Upload failed' });
      }
    },
  );

  // Convert Admin speech/audio into natural Google Female Voice (gemini-3.5-transcribe + gemini-3.8-flash-lite-tts)
  app.post(
    '/api/voice/female-convert',
    express.raw({
      limit: '16mb',
      type: (req) => {
        const raw = resolveRequestedMime(req);
        return raw in MIME_MAP && MIME_MAP[raw].kind === 'audio';
      },
    }),
    async (req: Request, res: Response) => {
      try {
        const authHeader = req.headers.authorization ?? '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        const caller = await verifyFirebaseIdToken(token);
        if (!caller || !caller.emailVerified) {
          res.status(401).json({ error: 'Authentication required' });
          return;
        }

        const isBootstrappedAdmin =
          caller.email === BOOTSTRAPPED_ADMIN_EMAIL && caller.emailVerified;
        const isAllowedAdmin =
          isBootstrappedAdmin || (await checkAdminDocWithToken(caller.uid, token));
        if (!isAllowedAdmin) {
          res.status(403).json({ error: 'Admin access required for female voice studio' });
          return;
        }

        const threadId = String(req.headers['x-thread-id'] ?? '').trim();
        if (!SAFE_ID_REGEX.test(threadId)) {
          res.status(400).json({ error: 'Invalid thread identifier' });
          return;
        }

        const voiceName = CANONICAL_FEMALE_VOICE;

        const baseMime = resolveRequestedMime(req);
        const mimeInfo = MIME_MAP[baseMime];
        if (!mimeInfo || mimeInfo.kind !== 'audio') {
          res.status(415).json({ error: 'Unsupported audio format' });
          return;
        }

        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          res.status(400).json({ error: 'Empty audio payload' });
          return;
        }
        if (req.body.length > 15 * 1024 * 1024) {
          res.status(413).json({ error: 'Audio file exceeds 15 MB limit' });
          return;
        }

        if (!process.env.GEMINI_API_KEY?.trim()) {
          res.status(503).json({
            error: 'Google voice service API key is not configured on the server.',
          });
          return;
        }

        // Step 1: Transcribe the Admin's spoken words accurately
        const transcript = await transcribeAdminAudio({
          base64Audio: req.body.toString('base64'),
          mimeType: mimeInfo.contentType,
        });

        if (!transcript) {
          res.status(422).json({
            error:
              'কোনো স্পষ্ট কথা শনাক্ত হয়নি। অনুগ্রহ করে মাইক্রোফোনের কাছে পরিষ্কারভাবে কথা বলে আবার চেষ্টা করুন।',
          });
          return;
        }

        // Step 2: Re-voice the transcript using the locked canonical single female voice
        const wavBuffer = await synthesizeGoogleFemaleVoiceWav({
          text: transcript,
        });

        const mediaUrl = await saveThreadMediaBuffer({
          threadId,
          ext: 'wav',
          buffer: wavBuffer,
        });

        res.status(201).json({
          url: mediaUrl,
          mediaType: 'audio',
          mimeType: 'audio/wav',
          transcript,
          voiceName,
        });
      } catch (err) {
        console.error('Google female voice conversion failed:', err);
        sendGeminiVoiceError(
          res,
          err,
          'Google female voice conversion failed. Please try speaking again.',
        );
      }
    },
  );

  // Generate natural Google Female Voice directly from Admin typed text
  app.post(
    '/api/voice/female-tts',
    express.json({ limit: '16kb' }),
    async (req: Request, res: Response) => {
      try {
        const authHeader = req.headers.authorization ?? '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        const caller = await verifyFirebaseIdToken(token);
        if (!caller || !caller.emailVerified) {
          res.status(401).json({ error: 'Authentication required' });
          return;
        }

        const isBootstrappedAdmin =
          caller.email === BOOTSTRAPPED_ADMIN_EMAIL && caller.emailVerified;
        const isAllowedAdmin =
          isBootstrappedAdmin || (await checkAdminDocWithToken(caller.uid, token));
        if (!isAllowedAdmin) {
          res.status(403).json({ error: 'Admin access required' });
          return;
        }

        const body = req.body as { threadId?: unknown; text?: unknown };
        const threadId = typeof body?.threadId === 'string' ? body.threadId.trim() : '';
        const text = typeof body?.text === 'string' ? body.text.trim() : '';
        const voiceName = CANONICAL_FEMALE_VOICE;

        if (!SAFE_ID_REGEX.test(threadId)) {
          res.status(400).json({ error: 'Invalid thread identifier' });
          return;
        }
        if (!text || text.length > 1000) {
          res.status(400).json({ error: 'Text must be between 1 and 1000 characters' });
          return;
        }

        if (!process.env.GEMINI_API_KEY?.trim()) {
          res.status(503).json({
            error: 'Google voice service API key is not configured on the server.',
          });
          return;
        }

        const wavBuffer = await synthesizeGoogleFemaleVoiceWav({
          text,
        });

        const mediaUrl = await saveThreadMediaBuffer({
          threadId,
          ext: 'wav',
          buffer: wavBuffer,
        });

        res.status(201).json({
          url: mediaUrl,
          mediaType: 'audio',
          mimeType: 'audio/wav',
          voiceName,
        });
      } catch (err) {
        console.error('Google female TTS failed:', err);
        sendGeminiVoiceError(res, err, 'Could not generate Google female voice message.');
      }
    },
  );

  // Web Push: expose public VAPID key
  app.get('/api/push/vapid-public-key', (_req: Request, res: Response) => {
    res.json({ publicKey: vapidKeys.publicKey });
  });

  // Web Push: register mobile/browser push subscription for the signed-in user
  app.post(
    '/api/push/subscribe',
    express.json({ limit: '16kb' }),
    async (req: Request, res: Response) => {
      try {
        const authHeader = req.headers.authorization ?? '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        const caller = await verifyFirebaseIdToken(token);
        if (!caller || !caller.emailVerified) {
          res.status(401).json({ error: 'Authentication required' });
          return;
        }

        const sub = (req.body as { subscription?: unknown })?.subscription;
        if (!isValidWebPushSubscription(sub)) {
          res.status(400).json({ error: 'Invalid push subscription payload' });
          return;
        }

        const existing = pushSubscriptions[caller.uid] ?? [];
        const deduped = existing.filter((item) => item.endpoint !== sub.endpoint);
        // Keep up to 5 recent devices per user
        pushSubscriptions[caller.uid] = [sub, ...deduped].slice(0, 5);
        savePushSubscriptions();

        res.status(201).json({ ok: true, devices: pushSubscriptions[caller.uid].length });
      } catch (err) {
        console.error('Push subscribe failed:', err);
        res.status(500).json({ error: 'Could not save notification subscription.' });
      }
    },
  );

  // Web Push: remove subscription on unsubscribe/signout
  app.post(
    '/api/push/unsubscribe',
    express.json({ limit: '16kb' }),
    async (req: Request, res: Response) => {
      try {
        const authHeader = req.headers.authorization ?? '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        const caller = await verifyFirebaseIdToken(token);
        if (!caller || !caller.emailVerified) {
          res.status(401).json({ error: 'Authentication required' });
          return;
        }

        const endpoint = String((req.body as { endpoint?: unknown })?.endpoint ?? '').trim();
        if (endpoint && pushSubscriptions[caller.uid]) {
          pushSubscriptions[caller.uid] = pushSubscriptions[caller.uid].filter(
            (item) => item.endpoint !== endpoint,
          );
          if (pushSubscriptions[caller.uid].length === 0) {
            delete pushSubscriptions[caller.uid];
          }
          savePushSubscriptions();
        }
        res.json({ ok: true });
      } catch (err) {
        console.error('Push unsubscribe failed:', err);
        res.status(500).json({ error: 'Could not remove notification subscription.' });
      }
    },
  );

  // Web Push: Admin triggers instant mobile push when replying or broadcasting
  app.post(
    '/api/push/notify',
    express.json({ limit: '16kb' }),
    async (req: Request, res: Response) => {
      try {
        const authHeader = req.headers.authorization ?? '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        const caller = await verifyFirebaseIdToken(token);
        if (!caller || !caller.emailVerified) {
          res.status(401).json({ error: 'Authentication required' });
          return;
        }

        const isBootstrappedAdmin =
          caller.email === BOOTSTRAPPED_ADMIN_EMAIL && caller.emailVerified;
        const isAllowedAdmin =
          isBootstrappedAdmin || (await checkAdminDocWithToken(caller.uid, token));
        if (!isAllowedAdmin) {
          res.status(403).json({ error: 'Admin access required to send notifications' });
          return;
        }

        const bodyObj = req.body as {
          targetUserId?: unknown;
          broadcast?: unknown;
          title?: unknown;
          body?: unknown;
          tag?: unknown;
        };

        const isBroadcast = Boolean(bodyObj?.broadcast);
        const targetUserId =
          typeof bodyObj?.targetUserId === 'string' ? bodyObj.targetUserId.trim() : '';
        if (!isBroadcast && !SAFE_ID_REGEX.test(targetUserId)) {
          res.status(400).json({ error: 'Valid targetUserId or broadcast flag is required' });
          return;
        }

        const title =
          (typeof bodyObj?.title === 'string' ? bodyObj.title.trim() : '').slice(0, 100) ||
          'BartaConnect';
        const bodyText =
          (typeof bodyObj?.body === 'string' ? bodyObj.body.trim() : '').slice(0, 260) ||
          'আপনার জন্য নতুন একটি মেসেজ এসেছে।';
        const tag =
          (typeof bodyObj?.tag === 'string' ? bodyObj.tag.trim() : '').slice(0, 80) ||
          'bartaconnect-message';

        const recipientUids = isBroadcast
          ? Object.keys(pushSubscriptions).filter((uid) => uid !== caller.uid)
          : [targetUserId];

        const payload = JSON.stringify({
          title,
          body: bodyText,
          tag,
          url: '/',
        });

        let sentCount = 0;
        let dirty = false;

        for (const uid of recipientUids) {
          const subs = pushSubscriptions[uid];
          if (!subs || subs.length === 0) continue;

          const activeSubs: WebPushSubscription[] = [];
          await Promise.all(
            subs.map(async (sub) => {
              try {
                await webpush.sendNotification(sub, payload, { TTL: 86_400 });
                activeSubs.push(sub);
                sentCount += 1;
              } catch (pushErr) {
                const statusCode = (pushErr as { statusCode?: number })?.statusCode;
                if (statusCode === 404 || statusCode === 410) {
                  dirty = true;
                } else {
                  activeSubs.push(sub);
                  console.warn('Web push delivery warning:', statusCode ?? pushErr);
                }
              }
            }),
          );

          if (activeSubs.length !== subs.length) {
            if (activeSubs.length === 0) {
              delete pushSubscriptions[uid];
            } else {
              pushSubscriptions[uid] = activeSubs;
            }
          }
        }

        if (dirty) savePushSubscriptions();

        res.json({ ok: true, sent: sentCount });
      } catch (err) {
        console.error('Push notify failed:', err);
        res.status(500).json({ error: 'Push notification dispatch failed.' });
      }
    },
  );

  app.get('/api/media/:threadId/:fileName', async (req: Request, res: Response) => {
    const threadId = String(req.params.threadId ?? '');
    const fileName = String(req.params.fileName ?? '');

    if (!SAFE_ID_REGEX.test(threadId) || !SAFE_FILE_REGEX.test(fileName)) {
      res.status(400).json({ error: 'Invalid media path' });
      return;
    }

    const filePath = path.resolve(UPLOAD_ROOT, threadId, fileName);
    if (!filePath.startsWith(UPLOAD_ROOT + path.sep)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) {
        res.status(404).end();
        return;
      }

      const ext = path.extname(fileName).toLowerCase();
      const contentType = EXT_TO_CONTENT_TYPE[ext] ?? 'application/octet-stream';
      const total = stat.size;
      const rangeHeader = req.headers.range;

      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

      if (rangeHeader) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
        if (!match) {
          res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
          return;
        }
        const start = Number.parseInt(match[1], 10);
        const end = match[2] ? Math.min(Number.parseInt(match[2], 10), total - 1) : total - 1;
        if (start >= total || start > end) {
          res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
          return;
        }

        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
        res.setHeader('Content-Length', String(end - start + 1));
        res.setHeader('Content-Type', contentType);
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.status(200);
        res.setHeader('Content-Length', String(total));
        res.setHeader('Content-Type', contentType);
        fs.createReadStream(filePath).pipe(res);
      }
    } catch {
      res.status(404).end();
    }
  });

  // Strict JSON 404 + Error barrier so /api/* never returns HTML
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API route not found' });
  });

  app.use(
    '/api',
    (
      err: unknown,
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) => {
      const status =
        typeof (err as { status?: unknown })?.status === 'number'
          ? (err as { status: number }).status
          : 500;
      const errType = (err as { type?: unknown })?.type;
      if (status === 413 || errType === 'entity.too.large') {
        res.status(413).json({ error: 'Uploaded file exceeds the allowed size limit.' });
        return;
      }
      if (status === 400 && errType === 'entity.parse.failed') {
        res.status(400).json({ error: 'Invalid JSON request payload.' });
        return;
      }
      console.error('API middleware error:', err);
      res.status(status >= 400 && status < 600 ? status : 500).json({
        error: 'Server API request failed. Please try again.',
      });
    },
  );

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*splat', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

void startServer();
