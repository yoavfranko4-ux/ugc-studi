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

import { fal } from '@fal-ai/client'
import { supabase } from '../../../../lib/supabase'
import { generateNBFrame, buildKlingPrompt, mapAvatarToActorId, mapAvatarToActorInfo, applyFlatColorGrading } from '../../../../lib/agent-pipeline.js'

export const maxDuration = 300;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FAL_KEY = process.env.FAL_API_KEY;
if (!FAL_KEY) console.warn('[regenerate-scene] FAL_API_KEY is not set');
fal.config({ credentials: FAL_KEY });

// v1: hard-coded per-scene cap. Upgrade to tier-based limits once the
// regenerations_used column is live and we want tier gating.
const MAX_REGENS_PER_SCENE = 3;

// Mirror of route.js — reference-to-video needs http(s) URLs in image_urls,
// so any user-uploaded data: payload has to round-trip through fal.storage.
async function ensureFalUrl(u) {
  if (!u || typeof u !== 'string') return null;
  if (u.startsWith('http://') || u.startsWith('https://')) return u;
  if (!u.startsWith('data:')) return u;
  try {
    const m = u.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) throw new Error('malformed data url');
    const buf = Buffer.from(m[2], 'base64');
    const blob = new Blob([buf], { type: m[1] || 'image/png' });
    const uploaded = await fal.storage.upload(blob);
    if (!uploaded) throw new Error('fal.storage.upload returned empty');
    console.log('[regenerate-scene][ensureFalUrl] uploaded data URL:', uploaded.slice(0, 80));
    return uploaded;
  } catch (e) {
    console.warn('[regenerate-scene][ensureFalUrl] failed:', e.message);
    return u;
  }
}

// Minimal Seedance call — 3 attempts, basic "is it a URL" check. We do NOT
// run ffprobe validation here (unlike the main /api/agent flow) because
// the user can just click regenerate again if Seedance returns garbage,
// which is cheaper than carrying the ffprobe dependency into this route.
async function runKlingForScene(klingPrompt, referenceImages, sceneNumber) {
  console.log(`[Kling regenerate-scene] FINAL prompt length: ${klingPrompt?.length ?? 0}`);
  if ((klingPrompt?.length ?? 0) > 2500) {
    console.error(`[Kling regenerate-scene] ⚠️ STILL TOO LONG: ${klingPrompt.length}`);
  }
  console.log(`[Seedance regenerate-scene Scene ${sceneNumber}] sending ${referenceImages.length} reference images`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[regenerate-scene] Seedance attempt ${attempt}/3`);
      const result = await fal.subscribe('bytedance/seedance-2.0/fast/reference-to-video', {
        input: {
          prompt: klingPrompt,
          image_urls: referenceImages,
          duration: '5',
          resolution: '720p',
          aspect_ratio: '9:16',
          generate_audio: false
        },
        pollInterval: 5000
      });
      const videoUrl = result.data.video?.url || null;
      const videoMeta = result.data.video || null;
      console.log(`[Seedance regenerate-scene] attempt ${attempt} response:`, JSON.stringify({
        url: videoUrl ? videoUrl.slice(0, 100) : null,
        content_type: videoMeta?.content_type,
        duration: videoMeta?.duration,
        width: videoMeta?.width,
        height: videoMeta?.height,
        seed: result.data?.seed,
      }));
      if (videoUrl) return videoUrl;
    } catch (e) {
      const status = e.status || e.statusCode || 'unknown';
      console.error(`[regenerate-scene] Seedance attempt ${attempt} failed — status: ${status}, body:`, JSON.stringify(e.body || e.message || String(e)).slice(0, 500));
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

  const nbPrompt = (typeof customPrompt === 'string' && customPrompt.trim()) ? customPrompt.trim() : scenes[sceneIdx].nb_prompt;
  const klingPrompt = scenes[sceneIdx].kling_prompt;

  // Normalize image URLs to absolute form before handing them to fal.ai.
  // fal rejects anything that isn't http://, https://, or data:, so a
  // relative path like "/avatars/avatar-5.jpg" (what the studio bundled
  // avatars look like after the frontend picker) triggers a 422. The main
  // /api/agent route does this same conversion — mirror it here so the
  // regenerate flow accepts the same frontend payload.
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
  // result.frames entries come from fal.ai already (absolute https URLs),
  // but normalize defensively in case an older job stored a relative path.
  const preparedPrevFrame = prepareUrl(result.frames?.[sceneIdx - 1]);
  console.log(`[regenerate-scene] job=${jobId} scene=${sceneNumber} baseUrl=${baseUrl} avatar=${preparedAvatar?.slice(0, 80) || '(none)'} product=${preparedProduct?.slice(0, 80) || '(none)'} prevFrame=${preparedPrevFrame?.slice(0, 80) || '(none)'}`);

  // Build reference-image list for this scene — mirrors the main /api/agent
  // loop so the regenerated frame uses the same style/identity anchors.
  const isScene2 = sceneIdx === 1;
  const isScene4 = sceneIdx === 3;
  const productOnly = isScene2 && videoType !== 'business';
  const scene4Context = isScene4 && !productOnly;

  const imageUrls = [];
  if (videoType === 'business') {
    if (isScene2) {
      preparedBusinessPhotos.slice(0, 3).forEach(u => imageUrls.push(u));
    } else {
      if (preparedAvatar) imageUrls.push(preparedAvatar);
      if (preparedPrevFrame) imageUrls.push(preparedPrevFrame);
      if (preparedBusinessPhotos[0] && (sceneIdx === 2 || sceneIdx === 3)) {
        imageUrls.push(preparedBusinessPhotos[0]);
      }
    }
  } else {
    if (isScene2) {
      if (preparedProduct) imageUrls.push(preparedProduct);
    } else {
      if (preparedAvatar) imageUrls.push(preparedAvatar);
      if (preparedPrevFrame) imageUrls.push(preparedPrevFrame);
      if (preparedProduct && (sceneIdx === 2 || sceneIdx === 3)) imageUrls.push(preparedProduct);
    }
  }

  // Mirror of /api/agent: Seedance-first flow. Skip the NanoBanana frame
  // upfront — only generate one if Seedance fails its 3 attempts. Saves an
  // NB call per regenerate when Seedance lands on the first or second try.
  const actorInfo = mapAvatarToActorInfo(avatarUrl);
  const actorId = actorInfo?.actorId || null;
  const isFallbackActor = actorInfo?.isFallbackActor === true;
  const isBusinessCraft = videoType === 'business';

  // 1) Run Seedance — reference-to-video, same per-scene reference list the
  // main /api/agent flow uses. Resolve any data: URLs to fal.storage first.
  const [seedanceAvatar, seedanceProduct, seedanceBusiness] = await Promise.all([
    ensureFalUrl(preparedAvatar),
    ensureFalUrl(preparedProduct),
    Promise.all(preparedBusinessPhotos.map(ensureFalUrl)).then(arr => arr.filter(Boolean))
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
  const rawVideoUrl = await runKlingForScene(wrappedKlingPrompt, referenceImages, sceneNumber);

  let newFrameUrl = null;
  let newVideoUrl = null;

  if (rawVideoUrl) {
    // Seedance worked — apply flat color grading and skip NB entirely.
    console.log(`[regenerate-scene] Scene ${sceneNumber}: applying flat color grading...`);
    newVideoUrl = await applyFlatColorGrading(rawVideoUrl, `regen scene ${sceneNumber}`);
    console.log(`[regenerate-scene] Scene ${sceneNumber}: post-process complete`);
  } else {
    // 2) Seedance failed 3x → spend an NB call now as a frame fallback.
    console.warn(`[regenerate-scene] Seedance failed for scene ${sceneNumber} — falling back to NanoBanana frame`);
    if (!productOnly && !actorId) {
      return Response.json({
        error: `avatarUrl '${avatarUrl}' did not map to a known actorId (daniel|noa|maya). Seedance failed and NB fallback also requires a recognized avatar.`
      }, { status: 400 });
    }
    try {
      newFrameUrl = await generateNBFrame(nbPrompt, imageUrls, 3, {
        productOnly,
        scene4Context,
        actorId,
        isFallbackActor,
        beat: sceneNumber,
        productName,
        isBusinessCraft
      });
    } catch (e) {
      console.error(`[regenerate-scene] NB fallback frame failed for job ${jobId} scene ${sceneNumber}:`, e.message);
      return Response.json({ error: `Seedance failed 3x and NanoBanana fallback also failed: ${e.message}` }, { status: 502 });
    }
    if (!newFrameUrl) {
      return Response.json({ error: 'Seedance failed 3x and NanoBanana fallback returned no URL' }, { status: 502 });
    }
    // NB frame succeeded but no Seedance video — persist the new frame so the
    // client can show it while the user decides whether to retry. We don't
    // build a static MP4 here (the heavy frameToStaticVideo helper lives in
    // /api/agent only); the client treats a missing video as a retry signal.
    const framesCopy = Array.isArray(result.frames) ? [...result.frames] : [null, null, null, null];
    framesCopy[sceneIdx] = newFrameUrl;
    await supabase.from('jobs').update({ result: { ...result, frames: framesCopy } }).eq('id', jobId);
    return Response.json({
      success: false,
      error: 'Seedance video generation failed 3x — frame regenerated, please try again',
      newFrameUrl,
      newVideoUrl: null,
    }, { status: 502 });
  }

  // 3) Write the new video into the job result. Frame stays untouched when
  // Seedance succeeded — no NB call was made, so result.frames[sceneIdx]
  // keeps whatever it had before.
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
