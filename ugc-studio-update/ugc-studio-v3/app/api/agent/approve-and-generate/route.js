// POST /api/agent/approve-and-generate
//
// Phase 2 of the new approval flow. Body:
//   { jobId, approvedScripts: [scene1, scene2, scene3, scene4] }
//
// 1. Loads the awaiting_approval job (or treats a 'pending' / 'done' job as
//    an idempotent retry).
// 2. Overwrites scene voiceovers with the user's approved texts.
// 3. Marks the job 'pending' and fires the media pipeline in the background:
//      - Per-scene ElevenLabs (4 calls; scenes 1+4 get uploaded to fal.storage
//        for Seedance audio_url lipsync)
//      - 4 NanoBanana still frames (existing logic via lib/agent-pipeline.js)
//      - 4 Seedance image-to-video calls — scenes 1 and 4 lipsync against the
//        approved Hebrew speech; scenes 2 and 3 are silent (no audio_url).
// 4. Stitches the per-scene audio into the final voiceover track and writes
//    the result back to the job row with status 'done'.

import { fal } from '@fal-ai/client'
import { supabase } from '../../../../lib/supabase'
import { prewarmVideos } from '../../../../lib/video-cache.js'
import { generateNBFrame } from '../../../../lib/agent-pipeline.js'
import {
  joinVoiceoverChunks,
  mapAvatarToActorId,
} from '../../../../lib/script-pipeline.js'
import {
  generateScenesVoice,
  stitchSceneVoices,
} from '../../../../lib/voice-pipeline.js'
import {
  buildSeedancePrompt,
  generateSeedanceVideo,
  SCENE_DURATIONS,
} from '../../../../lib/seedance-pipeline.js'

export const maxDuration = 300
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FAL_KEY = process.env.FAL_API_KEY
fal.config({ credentials: FAL_KEY })

const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID || '73z5yvUD5zgBgz92lJMW'

export async function POST(req) {
  if (!supabase) {
    return Response.json({ error: 'Supabase not configured' }, { status: 500 })
  }

  let body
  try { body = await req.json() }
  catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const { jobId, approvedScripts } = body || {}
  if (!jobId || typeof jobId !== 'string') {
    return Response.json({ error: 'Missing jobId' }, { status: 400 })
  }
  if (!Array.isArray(approvedScripts) || approvedScripts.length !== 4) {
    return Response.json({ error: 'approvedScripts must be an array of 4 strings' }, { status: 400 })
  }

  const { data: job, error: loadError } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .single()
  if (loadError || !job) {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }

  // Allow approval on a fresh draft, or treat 'pending'/'done' as no-op
  // idempotent calls (the client may have retried after a network blip).
  if (job.status === 'pending') {
    return Response.json({ jobId: job.id, status: 'pending' })
  }
  if (job.status === 'done') {
    return Response.json({ jobId: job.id, status: 'done', result: job.result })
  }
  if (job.status !== 'awaiting_approval') {
    return Response.json({
      error: `Job status is "${job.status}" — expected awaiting_approval`,
    }, { status: 409 })
  }

  // Apply the approved scripts onto the existing draft scenes.
  const draft = job.result || {}
  const scenes = Array.isArray(draft.story?.scenes) ? [...draft.story.scenes] : []
  if (scenes.length !== 4) {
    return Response.json({ error: 'Draft job has no scenes — regenerate the script' }, { status: 500 })
  }
  for (let i = 0; i < 4; i++) {
    scenes[i] = { ...scenes[i], subtitle: (approvedScripts[i] || '').trim() }
  }
  const voiceover = joinVoiceoverChunks(approvedScripts)

  // Flip the job to pending so the client poll can pick up progress.
  await supabase
    .from('jobs')
    .update({ status: 'pending', result: { ...draft, story: { scenes, hebrew_voice: voiceover }, scripts: approvedScripts } })
    .eq('id', jobId)

  // Fire-and-forget background pipeline. Errors are caught and persisted
  // onto the job row so the client poll surfaces them.
  runMediaPipeline(jobId, job.inputs || {}, scenes, approvedScripts, voiceover)
    .catch(err => {
      console.error(`[approve-and-generate] Job ${jobId} crashed:`, err)
      supabase.from('jobs').update({ status: 'error', error: err.message || String(err) }).eq('id', jobId)
        .then(() => {}, () => {})
    })

  return Response.json({ jobId, status: 'pending' })
}

// =============================================================================
//                            Media pipeline
// =============================================================================

async function runMediaPipeline(jobId, inputs, scenes, approvedScripts, voiceover) {
  console.log(`[Job ${jobId}] approve-and-generate starting media pipeline`)
  console.log('[Memory:approve]', JSON.stringify(process.memoryUsage()))

  const {
    videoType = 'ugc',
    avatarUrl,
    productImageUrl,
    productName,
    businessName,
    businessPhotos,
    voiceId,
  } = inputs

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://ugc-studi-production.up.railway.app'
  const prepareUrl = (u) => u
    ? (u.startsWith('http') || u.startsWith('data:') ? u : `${baseUrl}${u}`)
    : null
  const preparedAvatar = prepareUrl(avatarUrl)
  const preparedProduct = prepareUrl(productImageUrl)
  const preparedBusinessPhotos = Array.isArray(businessPhotos)
    ? businessPhotos.map(prepareUrl).filter(Boolean)
    : []

  console.log(`[Job ${jobId}] videoType=${videoType} prepared`, {
    avatar: preparedAvatar?.slice(0, 80),
    product: preparedProduct?.slice(0, 80),
    businessPhotos: preparedBusinessPhotos.length,
  })

  // ----- Voice (per-scene) + Frames (sequential) in parallel ----------------
  // Per-scene voice gives us individual MP3s for Seedance lipsync. Scenes 1
  // and 4 also get uploaded to fal.storage (so we have an audio_url).
  const generateAllFrames = async () => {
    const frames = []
    let prevFrame = null
    for (let i = 0; i < 4; i++) {
      try {
        const isScene2 = i === 1
        const productOnly = isScene2 && videoType !== 'business'
        const imageUrls = []
        if (videoType === 'business') {
          if (isScene2) preparedBusinessPhotos.slice(0, 3).forEach(u => imageUrls.push(u))
          else {
            if (preparedAvatar) imageUrls.push(preparedAvatar)
            if (prevFrame) imageUrls.push(prevFrame)
            if (preparedBusinessPhotos.length > 0 && (i === 2 || i === 3)) imageUrls.push(preparedBusinessPhotos[0])
          }
        } else {
          if (isScene2) {
            if (preparedProduct) imageUrls.push(preparedProduct)
          } else {
            if (preparedAvatar) imageUrls.push(preparedAvatar)
            if (prevFrame) imageUrls.push(prevFrame)
            if (preparedProduct && (i === 2 || i === 3)) imageUrls.push(preparedProduct)
          }
        }

        const scene4Context = i === 3 && !productOnly
        const baseOpts = { productOnly, scene4Context }
        const actorId = mapAvatarToActorId(avatarUrl)
        const beat = i + 1
        const isBusinessCraft = videoType === 'business'

        let frameUrl = null
        const useSkill = Boolean(actorId && !productOnly)
        console.log(`[Job ${jobId}] NB scene ${i + 1}: path=${useSkill ? 'skill' : 'legacy'} actor=${actorId || '(none)'}`)
        if (useSkill) {
          try {
            frameUrl = await generateNBFrame(scenes[i].nb_prompt, imageUrls, 3, {
              ...baseOpts, actorId, beat, productName, isBusinessCraft,
            })
          } catch (err) {
            console.warn(`[Job ${jobId}] NB skill failed scene ${i + 1}, legacy fallback:`, err.message)
            frameUrl = await generateNBFrame(scenes[i].nb_prompt, imageUrls, 3, baseOpts)
          }
        } else {
          frameUrl = await generateNBFrame(scenes[i].nb_prompt, imageUrls, 3, baseOpts)
        }
        frames.push(frameUrl)
        if (frameUrl) prevFrame = frameUrl
      } catch (e) {
        console.error(`[Job ${jobId}] Frame ${i + 1} failed:`, e.message)
        frames.push(null)
      }
    }
    return frames
  }

  // Per-scene voice. uploadFor=[0,3] means Seedance gets lipsync audio for
  // scenes 1 & 4 only (the speaking scenes). Scenes 2 & 3 stay silent.
  const [sceneVoices, frames] = await Promise.all([
    generateScenesVoice(approvedScripts, voiceId || ELEVEN_VOICE, { uploadFor: [0, 3] }),
    generateAllFrames(),
  ])

  // Stitch per-scene audio into the joined timeline used by the final video
  // composition + word-level subtitle alignment.
  const stitched = stitchSceneVoices(sceneVoices)
  const audioBase64 = stitched.base64
  const wordTimestamps = stitched.wordTimestamps

  // ----- Seedance video generation (parallel, 4 scenes) ---------------------
  console.log(`[Job ${jobId}] Starting 4 Seedance videos in parallel...`)
  const actorId = mapAvatarToActorId(avatarUrl)

  const videoTasks = frames.map(async (frameUrl, i) => {
    const isSpeakingScene = i === 0 || i === 3
    const audioUrl = isSpeakingScene ? sceneVoices[i]?.audioUrl : null
    if (isSpeakingScene && !audioUrl) {
      console.warn(`[Job ${jobId}] Scene ${i + 1} is a speaking scene but audio_url is null — Seedance will not lipsync`)
    }

    const seedancePrompt = buildSeedancePrompt({
      sceneIdx: i,
      actorId,
      productName: productName || '',
      hebrewLine: approvedScripts[i] || '',
      videoType,
      businessName: businessName || '',
    })

    const { videoUrl, source } = await generateSeedanceVideo({
      sceneIdx: i,
      prompt: seedancePrompt,
      imageUrl: frameUrl,
      audioUrl,
      label: `Job ${jobId} scene ${i + 1}`,
    })

    // Persist the prompt onto the scene so the editor can show it for debug.
    scenes[i] = { ...scenes[i], seedance_prompt: seedancePrompt, video_source: source }
    return videoUrl
  })

  const videos = await Promise.all(videoTasks)
  console.log(`[Job ${jobId}] Video sources:`, scenes.map((s, i) => `scene${i + 1}=${s.video_source}`).join(', '))

  const result = {
    story: { scenes, hebrew_voice: voiceover },
    frames,
    videos,
    audioBase64,
    wordTimestamps,
    hebrewVoice: voiceover,
    voiceId: voiceId || ELEVEN_VOICE,
    sceneAudioUrls: sceneVoices.map(v => v?.audioUrl || null),
    sceneDurations: sceneVoices.map(v => v?.duration || 0),
    scripts: approvedScripts,
  }

  await supabase.from('jobs').update({ status: 'done', result }).eq('id', jobId)
  console.log(`[Job ${jobId}] approve-and-generate completed`)

  try {
    prewarmVideos(videos.filter(Boolean))
  } catch (e) {
    console.warn(`[Job ${jobId}] prewarm invocation failed:`, e.message)
  }
}
