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
import { generateNBFrame, buildKlingPrompt, mapAvatarToActorId, mapAvatarToActorInfo } from '../../../../lib/agent-pipeline.js'

export const maxDuration = 300;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FAL_KEY = process.env.FAL_API_KEY;
if (!FAL_KEY) console.warn('[regenerate-scene] FAL_API_KEY is not set');
fal.config({ credentials: FAL_KEY });

// v1: hard-coded per-scene cap. Upgrade to tier-based limits once the
// regenerations_used column is live and we want tier gating.
const MAX_REGENS_PER_SCENE = 3;

// Minimal Kling call — 3 attempts, basic "is it a URL" check. We do NOT
// run ffprobe validation here (unlike the main /api/agent flow) because
// the user can just click regenerate again if Kling returns garbage,
// which is cheaper than carrying the ffprobe dependency into this route.
async function runKlingForScene(klingPrompt, frameUrl) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[regenerate-scene] Kling attempt ${attempt}/3`);
      const result = await fal.subscribe('fal-ai/kling-video/v3/pro/image-to-video', {
        input: {
          prompt: klingPrompt,
          image_url: frameUrl,
          duration: '5',
          aspect_ratio: '9:16',
          cfg_scale: 0.45,
          negative_prompt: 'cinematic camera, smooth stabilizer, studio lighting, professional production, advertisement look, CGI, drone shot, dolly zoom, commercial quality, artificial lighting, color grading, lens flare, rack focus'
        },
        pollInterval: 5000
      });
      const videoUrl = result.data.video?.url || null;
      console.log(`[regenerate-scene] Kling attempt ${attempt} returned:`, videoUrl?.slice(0, 80) || '(null)');
      if (videoUrl) return videoUrl;
    } catch (e) {
      const status = e.status || e.statusCode || 'unknown';
      console.error(`[regenerate-scene] Kling attempt ${attempt} failed — status: ${status}, body:`, JSON.stringify(e.body || e.message || String(e)).slice(0, 500));
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

  // 1) Re-run NanoBanana for this scene only — must go through the skill path
  // (mandatory realism anchors). The legacy fallback in generateNBFrame was
  // removed; non-productOnly calls require a valid actorId.
  const actorInfo = mapAvatarToActorInfo(avatarUrl);
  const actorId = actorInfo?.actorId || null;
  const isFallbackActor = actorInfo?.isFallbackActor === true;
  if (!productOnly && !actorId) {
    return Response.json({
      error: `avatarUrl '${avatarUrl}' did not map to a known actorId (daniel|noa|maya). The realism-anchors skill path requires a recognized avatar.`
    }, { status: 400 });
  }
  const isBusinessCraft = videoType === 'business';
  let newFrameUrl;
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
    console.error(`[regenerate-scene] NB frame failed for job ${jobId} scene ${sceneNumber}:`, e.message);
    return Response.json({ error: `NanoBanana frame generation failed: ${e.message}` }, { status: 502 });
  }
  if (!newFrameUrl) {
    return Response.json({ error: 'NanoBanana frame generation returned no URL' }, { status: 502 });
  }

  // 2) Re-run Kling on the new frame — wrap the raw kling_prompt with the
  // skill layers (PRODUCT_LOCK + realism + negatives) so the regenerated
  // scene matches the same vibe the main /api/agent flow now produces.
  const wrappedKlingPrompt = buildKlingPrompt(klingPrompt, sceneNumber, productName, {
    isBusinessCraft: videoType === 'business',
    scene4Context,
  });
  const newVideoUrl = await runKlingForScene(wrappedKlingPrompt, newFrameUrl);
  if (!newVideoUrl) {
    // NB frame succeeded but Kling failed 3x. Persist the new frame anyway
    // so the client can at least show the updated still while the user
    // decides whether to retry.
    const framesCopy = Array.isArray(result.frames) ? [...result.frames] : [null, null, null, null];
    framesCopy[sceneIdx] = newFrameUrl;
    await supabase.from('jobs').update({ result: { ...result, frames: framesCopy } }).eq('id', jobId);
    return Response.json({
      success: false,
      error: 'Frame regenerated but Kling video generation failed after 3 attempts — try again',
      newFrameUrl,
      newVideoUrl: null,
    }, { status: 502 });
  }

  // 3) Write both the new frame and new video into the job result
  const framesCopy = Array.isArray(result.frames) ? [...result.frames] : [null, null, null, null];
  const videosCopy = Array.isArray(result.videos) ? [...result.videos] : [null, null, null, null];
  framesCopy[sceneIdx] = newFrameUrl;
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
