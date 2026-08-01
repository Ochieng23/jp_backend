import { spawn } from 'child_process';
import { mkdtemp, writeFile, readdir, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import logger from '../utils/logger.js';

/**
 * Guardrail: screens an uploaded video for obscene/explicit content before
 * it is stored. Samples frames with ffmpeg and runs each through Azure AI
 * Content Safety's image analysis; the video is rejected if any frame's
 * severity meets the configured threshold.
 *
 * Env:
 *   CONTENT_SAFETY_ENDPOINT   e.g. https://<name>.cognitiveservices.azure.com
 *   CONTENT_SAFETY_KEY        API key
 *   CONTENT_SAFETY_SEXUAL_THRESHOLD    reject at/above this severity (default 2)
 *   CONTENT_SAFETY_VIOLENCE_THRESHOLD  reject at/above this severity (default 4)
 *
 * Unconfigured → uploads pass with a warning (local dev). A transient
 * Content Safety outage also fails open (with a warning) rather than
 * blocking every profile-video upload; a positive detection always rejects.
 */

const API_VERSION = '2024-09-01';
const MAX_FRAMES = 8;

export function isModerationConfigured() {
  return Boolean(process.env.CONTENT_SAFETY_ENDPOINT && process.env.CONTENT_SAFETY_KEY);
}

/** Writes the buffer to a temp file and extracts up to MAX_FRAMES evenly
 * spaced JPEG frames. Returns an array of frame buffers. */
async function extractFrames(buffer, ext) {
  const dir = await mkdtemp(path.join(tmpdir(), 'vidmod-'));
  const input = path.join(dir, `input.${ext}`);
  await writeFile(input, buffer);

  // ~1 frame every 2s, capped by -frames:v; scaled down — Content Safety
  // needs >=50px and moderates fine at low resolution, and small frames
  // keep request payloads light.
  const args = [
    '-i', input,
    '-vf', 'fps=1/2,scale=512:-2',
    '-frames:v', String(MAX_FRAMES),
    '-q:v', '4',
    path.join(dir, 'frame-%02d.jpg'),
  ];

  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d; });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) {resolve();}
        else {reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));}
      });
    });

    const files = (await readdir(dir)).filter((f) => f.startsWith('frame-')).sort();
    return await Promise.all(files.map((f) => readFile(path.join(dir, f))));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function analyzeFrame(frameBuffer) {
  const res = await fetch(
    `${process.env.CONTENT_SAFETY_ENDPOINT.replace(/\/$/, '')}/contentsafety/image:analyze?api-version=${API_VERSION}`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': process.env.CONTENT_SAFETY_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image: { content: frameBuffer.toString('base64') } }),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Content Safety returned ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const severities = {};
  for (const c of data.categoriesAnalysis || []) {
    severities[c.category] = c.severity ?? 0;
  }
  return severities;
}

/**
 * @param {Buffer} buffer - raw video bytes
 * @param {string} ext - file extension (mp4/webm/mov)
 * @returns {Promise<{ allowed: boolean, reason?: string }>}
 */
export async function moderateVideo(buffer, ext) {
  if (!isModerationConfigured()) {
    logger.warn('Content Safety not configured — video uploaded without moderation');
    return { allowed: true };
  }

  const sexualThreshold = parseInt(process.env.CONTENT_SAFETY_SEXUAL_THRESHOLD ?? '2', 10);
  const violenceThreshold = parseInt(process.env.CONTENT_SAFETY_VIOLENCE_THRESHOLD ?? '4', 10);

  let frames;
  try {
    frames = await extractFrames(buffer, ext);
  } catch (err) {
    // A video ffmpeg can't decode is suspicious enough to reject outright —
    // it also wouldn't play in the browser.
    logger.warn(`Video moderation: frame extraction failed — ${err.message}`);
    return { allowed: false, reason: 'The video could not be processed. Please upload a valid MP4, WEBM, or MOV file.' };
  }

  if (frames.length === 0) {
    return { allowed: false, reason: 'The video could not be processed. Please upload a valid MP4, WEBM, or MOV file.' };
  }

  try {
    for (const frame of frames) {
      const severities = await analyzeFrame(frame);
      if ((severities.Sexual ?? 0) >= sexualThreshold || (severities.Violence ?? 0) >= violenceThreshold) {
        logger.warn(
          `Video moderation: rejected upload (Sexual=${severities.Sexual ?? 0}, Violence=${severities.Violence ?? 0})`
        );
        return {
          allowed: false,
          reason: 'This video appears to contain explicit or graphic content and cannot be used as a profile video.',
        };
      }
    }
  } catch (err) {
    logger.warn(`Video moderation: analysis unavailable, allowing upload — ${err.message}`);
    return { allowed: true };
  }

  return { allowed: true };
}
