// POST /api/agent/regenerate-scene
//
// Regenerates a single scene (1-4) of an existing completed job without
// remaking the other three scenes, the voiceover, or the final composite.
// Client-side studio page composites the per-scene videos anyway, so the
// server just needs to hand back a new frame + video for the target scene
// and update the job row; the frontend re-renders with the new arrays.
//
// Body shape (mirrors /api/agent plus the two new fields):
//   {
//     jobId:          string           // the completed job to regenerate against
//     sceneNumber:    1 | 2 | 3 | 4    // which scene to regenerate
//     customPrompt?:  string           // optional override for the scene's nb_prompt
//     videoType:      'ugc' | 'business'
//     avatarUrl?:     string           // required for 'ugc' (+ business non-scene-2)
//     productImageUrl?: string         // required for 'ugc' scene 2/3/4
//     businessPhotos?: string[]        // business flow only
//   }
//
// Returns: { success, sceneNumber, newFrameUrl, newVideoUrl, regenerations_used, result }

import { supabase } from '../../../../lib/supabase'
import { buildKlingPrompt } from '../../../../lib/agent-pipeline.js'
import { generateVideo as byteplusGenerateVideo, isByteplusConfigured, uploadToByteplusFiles } from '../../../../lib/byteplus-client.js'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, readFile, mkdir, rm } from 'fs/promises'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { createRequire } from 'module'
import sharp from 'sharp'

export const maxDuration = 300;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

if (!process.env.ARK_API_KEY) {
  console.warn('[regenerate-scene] ARK_API_KEY is not set — BytePlus video generation will fail; static fallback only');
}

const _require = createRequire(import.meta.url);
let ffmpegStaticPath = null;
try { ffmpegStaticPath = _require('ffmpeg-static'); } catch {}
const execFileAsync = promisify(execFile);

// v1: hard-coded per-scene cap. Upgrade to tier-based limits once the
// regenerations_used column is live and we want tier gating.
const MAX_REGENS_PER_SCENE = 3;

// Static fallback for when BytePlus Seedance fails. Single scene-relevant
// image (avatar for 1/3/4, product for UGC scene 2) → sharp cover-fit to
// 720x1280 → ffmpeg loop into 5-sec MP4 returned as data: URL. Mirrors the
// helper in app/api/agent/route.js — kept inline for the same reason
// ensureFalUrl was previously duplicated.
async function buildStaticFallbackVideo(imageUrl, durationSec = 5) {
  if (!imageUrl) return null;
  if (!ffmpegStaticPath || !fs.existsSync(ffmpegStaticPath)) {
    console.warn('[regenerate-scene][staticFallback] ffmpeg-static not available — cannot build fallback video');
    return null;
  }
  const tmpDir = path.join('/tmp', `static-${randomUUID()}`);
  await mkdir(tmpDir, { recursive: true });
  const inPath = path.join(tmpDir, 'frame.png');
  const outPath = path.join(tmpDir, 'static.mp4');
  try {
    let imgBuf;
    if (imageUrl.startsWith('data:')) {
      const m = imageUrl.match(/^data:[^;]+;base64,(.+)$/);
      if (!m) throw new Error('malformed data URL');
      imgBuf = Buffer.from(m[1], 'base64');
    } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      const resp = await fetch(imageUrl);
      if (!resp.ok) throw new Error(`fetch HTTP ${resp.status}`);
      imgBuf = Buffer.from(await resp.arrayBuffer());
    } else if (imageUrl.startsWith('/')) {
      const localPath = path.join(process.cwd(), 'public', imageUrl.replace(/^\/+/, ''));
      imgBuf = await readFile(localPath);
    } else {
      throw new Error(`unsupported image URL prefix: ${imageUrl.slice(0, 60)}`);
    }
    const framedBuf = await sharp(imgBuf)
      .resize(720, 1280, { fit: 'cover' })
      .png()
      .toBuffer();
    await writeFile(inPath, framedBuf);
    await execFileAsync(ffmpegStaticPath, [
      '-y', '-loop', '1', '-i', inPath,
      '-t', String(durationSec),
      '-r', '24',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outPath
    ], { timeout: 60000, maxBuffer: 20 * 1024 * 1024 });
    const stats = fs.statSync(outPath);
    if (stats.size < 10 * 1024) throw new Error('generated mp4 too small');
    const mp4Buf = await readFile(outPath);
    console.log(`[regenerate-scene][staticFallback] OK, ${mp4Buf.length} bytes`);
    return `data:video/mp4;base64,${mp4Buf.toString('base64')}`;
  } catch (e) {
    console.error('[regenerate-scene][staticFallback] failed:', e.message);
    return null;
  } finally {
    rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// BytePlus Seedance attempt — 3 retries, returns videoUrl or null.
async function runByteplusForScene(klingPrompt, referenceImages, sceneNumber) {
  console.log(`[regenerate-scene][BytePlus Scene ${sceneNumber}] prompt length: ${klingPrompt?.length ?? 0}, refs=${referenceImages.length}`);
  if ((klingPrompt?.length ?? 0) > 2500) {
    console.error(`[regenerate-scene][BytePlus Scene ${sceneNumber}] ⚠️ TOO LONG: ${klingPrompt.length}`);
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[regenerate-scene] BytePlus attempt ${attempt}/3`);
      const { videoUrl } = await byteplusGenerateVideo({
        prompt: klingPrompt,
        imageUrls: referenceImages.filter(Boolean),
        duration: 5
      });
      if (videoUrl) {
        console.log(`[regenerate-scene] BytePlus attempt ${attempt} OK: ${videoUrl.slice(0, 100)}`);
        return videoUrl;
      }
      console.warn(`[regenerate-scene] BytePlus attempt ${attempt} returned no url`);
    } catch (e) {
      console.error(`[regenerate-scene] BytePlus attempt ${attempt} failed:`, (e?.message || String(e)).slice(0, 500));
    }
    if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
  }
  return null;
}

export async function POST(req) {
  if (!supabase) {
    return Response.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  let body;
  try { body = await req.json(); }
  catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  let {
    jobId,
    sceneNumber,
    customPrompt,
    videoType,
    avatarUrl,
    productImageUrl,
    businessPhotos,
  } = body || {};

  if (!jobId || typeof jobId !== 'string') {
    return Response.json({ error: 'Missing jobId' }, { status: 400 });
  }
  if (![1, 2, 3, 4].includes(Number(sceneNumber))) {
    return Response.json({ error: 'sceneNumber must be 1, 2, 3, or 4' }, { status: 400 });
  }
  const sceneIdx = Number(sceneNumber) - 1;

  // Load the existing job. Pull everything so we can detect whether the
  // regenerations_used column exists (it's optional — see migration file).
  const { data: job, error: loadError } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (loadError || !job) {
    return Response.json({ error: 'Job not found' }, { status: 404 });
  }
  if (job.status !== 'done') {
    return Response.json({
      error: `Job status is "${job.status}" — can only regenerate scenes of completed jobs`
    }, { status: 409 });
  }

  // Fall back to inputs persisted on the jobs row when the client didn't
  // supply them. Editor sessions restored from older saved_edits don't have
  // lastGenPayload in scope, so they POST { jobId, sceneNumber } only and
  // rely on this fallback. Brand-new jobs (since 20260425) always have
  // jobs.inputs populated; very old jobs may not — those degrade to using
  // only the previous-scene frame as the reference image.
  const persistedInputs = (job.inputs && typeof job.inputs === 'object') ? job.inputs : {};
  if (videoType == null) videoType = persistedInputs.videoType || 'ugc';
  if (avatarUrl == null) avatarUrl = persistedInputs.avatarUrl || null;
  if (productImageUrl == null) productImageUrl = persistedInputs.productImageUrl || null;
  if (!Array.isArray(businessPhotos)) {
    businessPhotos = Array.isArray(persistedInputs.businessPhotos) ? persistedInputs.businessPhotos : [];
  }
  const productName = persistedInputs.productName || persistedInputs.businessName || null;

  const result = job.result || {};
  const scenes = result.story?.scenes || [];
  if (!scenes[sceneIdx]) {
    return Response.json({ error: `Scene ${sceneNumber} data missing from job result` }, { status: 500 });
  }

  // Rate limit (graceful fallback if the column doesn't exist yet).
  const regenerations_used = (job.regenerations_used && typeof job.regenerations_used === 'object') ? job.regenerations_used : {};
  const currentCount = regenerations_used[String(sceneNumber)] || 0;
  if (currentCount >= MAX_REGENS_PER_SCENE) {
    return Response.json({
      error: `Scene ${sceneNumber} has reached the regeneration limit (${MAX_REGENS_PER_SCENE})`,
      regenerations_used,
    }, { status: 429 });
  }

  // customPrompt may override the default kling_prompt (UI offers per-scene
  // text edit). nb_prompt is no longer used in this route since the
  // NanoBanana fallback was removed alongside the fal.ai migration.
  const klingPrompt = (typeof customPrompt === 'string' && customPrompt.trim()) ? customPrompt.trim() : scenes[sceneIdx].kling_prompt;

  // Normalize image URLs to absolute form before handing them to BytePlus.
  // The Seedance API rejects anything that isn't http://, https://, or
  // data:, so a relative path like "/avatars/avatar-5.jpg" (what the studio
  // bundled avatars look like after the frontend picker) triggers a 422.
  // The main /api/agent route does this same conversion — mirror it here so
  // the regenerate flow accepts the same frontend payload.
  //
  // Order of preference for the base:
  //   1. NEXT_PUBLIC_BASE_URL env var (matches what the main route uses)
  //   2. The incoming request's own protocol + host (works for any deploy
  //      target, including local dev)
  //   3. The hardcoded Railway fallback used by the main route
  const envBase = process.env.NEXT_PUBLIC_BASE_URL;
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const host = req.headers.get('host');
  const requestBase = host ? `${proto}://${host}` : null;
  const baseUrl = envBase || requestBase || 'https://ugc-studi-production.up.railway.app';
  const prepareUrl = (u) => {
    if (!u || typeof u !== 'string') return null;
    if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('data:')) return u;
    // Relative path — prepend the base. Ensure exactly one slash at the join.
    return u.startsWith('/') ? `${baseUrl}${u}` : `${baseUrl}/${u}`;
  };

  const preparedAvatar = prepareUrl(avatarUrl);
  const preparedProduct = prepareUrl(productImageUrl);
  const preparedBusinessPhotos = Array.isArray(businessPhotos) ? businessPhotos.map(prepareUrl).filter(Boolean) : [];
  console.log(`[regenerate-scene] job=${jobId} scene=${sceneNumber} baseUrl=${baseUrl} avatar=${preparedAvatar?.slice(0, 80) || '(none)'} product=${preparedProduct?.slice(0, 80) || '(none)'}`);

  const isScene2 = sceneIdx === 1;
  const isScene4 = sceneIdx === 3;
  const productOnly = isScene2 && videoType !== 'business';
  const scene4Context = isScene4 && !productOnly;

  // 1) Run BytePlus Seedance — reference-to-video, same per-scene reference
  // list the main /api/agent flow uses.
  const [seedanceAvatar, seedanceProduct, seedanceBusiness] = await Promise.all([
    preparedAvatar ? uploadToByteplusFiles(preparedAvatar) : null,
    preparedProduct ? uploadToByteplusFiles(preparedProduct) : null,
    Promise.all(preparedBusinessPhotos.map(u => uploadToByteplusFiles(u))).then(arr => arr.filter(Boolean))
  ]);

  const referenceImages = (() => {
    if (videoType === 'business') {
      if (isScene2) return seedanceBusiness.slice(0, 3);
      if (sceneIdx === 0) return [seedanceAvatar].filter(Boolean);
      return [seedanceAvatar, seedanceBusiness[0]].filter(Boolean);
    }
    switch (sceneNumber) {
      case 1: return [seedanceAvatar].filter(Boolean);
      case 2: return [seedanceProduct].filter(Boolean);
      case 3:
      case 4: return [seedanceAvatar, seedanceProduct].filter(Boolean);
      default: return [];
    }
  })();

  const wrappedKlingPrompt = buildKlingPrompt(klingPrompt, sceneNumber, productName, {
    isBusinessCraft: videoType === 'business',
    scene4Context,
    productOnly,
  });

  let newFrameUrl = null;
  let newVideoUrl = null;

  const byteplusReady = isByteplusConfigured();
  const rawVideoUrl = byteplusReady
    ? await runByteplusForScene(wrappedKlingPrompt, referenceImages, sceneNumber)
    : null;

  if (rawVideoUrl) {
    // BytePlus succeeded — ship it as-is (no color grading).
    newVideoUrl = rawVideoUrl;
  } else {
    // 2) BytePlus failed (or not configured) → build a 5-sec static MP4 from
    // the scene-relevant reference image. No NanoBanana, no fal.
    if (!byteplusReady) {
      console.error(`[regenerate-scene] BytePlus not configured — using static fallback`);
    } else {
      console.warn(`[regenerate-scene] BytePlus failed for scene ${sceneNumber} — using static fallback`);
    }
    let fallbackImage;
    if (productOnly) {
      fallbackImage = preparedProduct;
    } else if (videoType === 'business' && isScene2) {
      fallbackImage = preparedBusinessPhotos[0] || preparedAvatar;
    } else {
      fallbackImage = preparedAvatar;
    }
    if (!fallbackImage) {
      return Response.json({
        error: `BytePlus failed and no fallback image available for scene ${sceneNumber}`
      }, { status: 502 });
    }
    try {
      newVideoUrl = await buildStaticFallbackVideo(fallbackImage, 5);
    } catch (e) {
      console.error(`[regenerate-scene] static fallback for scene ${sceneNumber} crashed:`, e.message);
      return Response.json({ error: `BytePlus failed and static fallback crashed: ${e.message}` }, { status: 502 });
    }
    if (!newVideoUrl) {
      return Response.json({ error: 'BytePlus failed and static fallback returned no video' }, { status: 502 });
    }
    newFrameUrl = fallbackImage;
  }

  // 3) Write the new video into the job result. When BytePlus succeeded the
  // frame stays untouched; on static fallback we record the source image as
  // the frame so the editor can display it.
  const framesCopy = Array.isArray(result.frames) ? [...result.frames] : [null, null, null, null];
  const videosCopy = Array.isArray(result.videos) ? [...result.videos] : [null, null, null, null];
  if (newFrameUrl) framesCopy[sceneIdx] = newFrameUrl;
  videosCopy[sceneIdx] = newVideoUrl;
  const newResult = { ...result, frames: framesCopy, videos: videosCopy };
  const newRegenCount = { ...regenerations_used, [String(sceneNumber)]: currentCount + 1 };

  // Primary update: both result and the regenerations_used counter.
  // If the column doesn't exist yet (migration not yet applied), fall
  // back to updating result only — the feature still works, just
  // without rate-limit tracking.
  let { error: updateError } = await supabase
    .from('jobs')
    .update({ result: newResult, regenerations_used: newRegenCount })
    .eq('id', jobId);

  if (updateError && /regenerations_used/i.test(updateError.message || '')) {
    console.warn('[regenerate-scene] regenerations_used column missing — updating result only. Run the migration in supabase/migrations/ to enable rate limiting.');
    const retry = await supabase.from('jobs').update({ result: newResult }).eq('id', jobId);
    updateError = retry.error;
  }

  if (updateError) {
    console.error(`[regenerate-scene] supabase update failed: ${updateError.message}`);
    return Response.json({
      success: false,
      error: `Failed to save regenerated scene to database: ${updateError.message}`,
      newFrameUrl,
      newVideoUrl,
    }, { status: 500 });
  }

  return Response.json({
    success: true,
    sceneNumber,
    newFrameUrl,
    newVideoUrl,
    regenerations_used: newRegenCount,
    result: newResult,
  });
}
