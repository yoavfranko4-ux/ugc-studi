// POST /api/agent — legacy one-shot endpoint.
//
// The new client flow uses /api/agent/script-only + /api/agent/approve-and-
// generate so the user can review the Hebrew script before media generation.
// This legacy endpoint is kept for backwards compatibility with any external
// caller / automation that POSTed the old single-shot body. It auto-approves
// Claude's output (no user gate) and chains the same media pipeline.

import { fal } from '@fal-ai/client'
import { supabase } from '../../../lib/supabase'
import { remainingVideos } from '../../../lib/subscription-limits.js'
import { prewarmVideos } from '../../../lib/video-cache.js'
import { generateNBFrame } from '../../../lib/agent-pipeline.js'
import {
  generateScript,
  generateBusinessScript,
  getHook,
  getBusinessHook,
  getDefaultScenes,
  getBusinessDefaultScenes,
  getDefaultVoiceover,
  getBusinessDefaultVoiceover,
  joinVoiceoverChunks,
  mapAvatarToActorId,
} from '../../../lib/script-pipeline.js'
import {
  generateScenesVoice,
  stitchSceneVoices,
} from '../../../lib/voice-pipeline.js'
import {
  buildSeedancePrompt,
  generateSeedanceVideo,
} from '../../../lib/seedance-pipeline.js'

export const maxDuration = 300
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FAL_KEY = process.env.FAL_API_KEY
fal.config({ credentials: FAL_KEY })
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID || '73z5yvUD5zgBgz92lJMW'

export async function POST(req) {
  console.log('[Memory:agent-legacy]', JSON.stringify(process.memoryUsage()))
  try {
    const body = await req.json()
    if (!supabase) return Response.json({ error: 'Supabase not configured' }, { status: 500 })

    if (body?.userId) {
      try {
        const { data: u } = await supabase
          .from('users')
          .select('subscription_tier, videos_used_this_period')
          .eq('id', body.userId)
          .maybeSingle()
        if (u?.subscription_tier) {
          const left = remainingVideos(u)
          if (left <= 0) {
            return Response.json(
              { error: 'נגמרו לך הסרטונים החודש. שדרג לפרו לעוד 8 סרטונים.' },
              { status: 403 },
            )
          }
        }
      } catch (err) {
        console.warn('[Agent] quota check skipped:', err?.message || err)
      }
    }

    const jobInputs = {
      videoType: body?.videoType || 'ugc',
      avatarUrl: body?.avatarUrl || null,
      productImageUrl: body?.productImageUrl || null,
      productName: body?.productName || body?.product || null,
      productDesc: body?.productDesc || body?.product || null,
      applicationArea: body?.applicationArea || null,
      businessName: body?.businessName || null,
      businessDescription: body?.businessDescription || null,
      businessPhotos: Array.isArray(body?.businessPhotos) ? body.businessPhotos : [],
      voiceId: body?.voiceId || null,
    }

    let { data: job, error: insertError } = await supabase
      .from('jobs')
      .insert({ status: 'pending', inputs: jobInputs })
      .select('id')
      .single()
    if (insertError && /inputs/i.test(insertError.message || '')) {
      const retry = await supabase.from('jobs').insert({ status: 'pending' }).select('id').single()
      job = retry.data
      insertError = retry.error
    }
    if (insertError) {
      console.error('[Agent] job insert error:', insertError.message)
      return Response.json({ error: 'Failed to create job' }, { status: 500 })
    }

    runLegacyJob(job.id, body).catch(err => {
      console.error(`[Job ${job.id}] crashed:`, err.message)
      supabase.from('jobs').update({ status: 'error', error: err.message }).eq('id', job.id)
        .then(() => {}, () => {})
    })

    return Response.json({ jobId: job.id })
  } catch (e) {
    console.error('[Agent] error:', e.message)
    return Response.json({ error: e.message }, { status: 500 })
  }
}

async function runLegacyJob(jobId, body) {
  const {
    videoType = 'ugc',
    productName, productDesc, applicationArea,
    avatarUrl, productImageUrl, voiceId,
    businessName, businessDescription, businessPhotos,
  } = body

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://ugc-studi-production.up.railway.app'
  const prepareUrl = (u) => u
    ? (u.startsWith('http') || u.startsWith('data:') ? u : `${baseUrl}${u}`)
    : null
  const preparedAvatar = prepareUrl(avatarUrl)
  const preparedProduct = prepareUrl(productImageUrl)
  const preparedBusinessPhotos = Array.isArray(businessPhotos)
    ? businessPhotos.map(prepareUrl).filter(Boolean)
    : []

  const voiceGender = voiceId === 'nBiC8Jexp2XGyIxATg9S' ? 'male' : 'female'

  // Script
  let script, scenes, voiceover, hook
  if (videoType === 'business') {
    hook = getBusinessHook(businessDescription || '', businessName || '', voiceGender)
    script = await generateBusinessScript(businessName || '', businessDescription || '', hook, voiceGender)
    scenes = script?.scenes || getBusinessDefaultScenes(businessName || '', businessDescription || '')
    if (script) {
      script.voiceover_scene1 = hook
      if (script.scenes && script.scenes[0]) script.scenes[0].subtitle = hook
      script.voiceover = joinVoiceoverChunks([hook, script.voiceover_scene2, script.voiceover_scene3, script.voiceover_scene4])
    }
    if (scenes[0]) scenes[0].subtitle = hook
    voiceover = script?.voiceover || getBusinessDefaultVoiceover(businessName || '', businessDescription || '', hook)
  } else {
    hook = getHook(productName, productDesc, voiceGender)
    script = await generateScript(productName, productDesc, applicationArea, hook, voiceGender)
    scenes = script?.scenes || getDefaultScenes(productName, applicationArea, productDesc, voiceGender)
    if (script) {
      script.voiceover_scene1 = hook
      if (script.scenes && script.scenes[0]) script.scenes[0].subtitle = hook
      script.voiceover = joinVoiceoverChunks([hook, script.voiceover_scene2, script.voiceover_scene3, script.voiceover_scene4])
    }
    if (scenes[0]) scenes[0].subtitle = hook
    voiceover = script?.voiceover || getDefaultVoiceover(productName, applicationArea, hook, voiceGender)
  }

  const approvedScripts = scenes.map(s => s.subtitle || '')

  // Per-scene voice (upload scenes 1 & 4 for Seedance lipsync)
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
        const useSkill = Boolean(actorId && !productOnly)
        let frameUrl = null
        if (useSkill) {
          try {
            frameUrl = await generateNBFrame(scenes[i].nb_prompt, imageUrls, 3, {
              ...baseOpts, actorId, beat, productName, isBusinessCraft,
            })
          } catch (err) {
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

  const [sceneVoices, frames] = await Promise.all([
    generateScenesVoice(approvedScripts, voiceId || ELEVEN_VOICE, { uploadFor: [0, 3] }),
    generateAllFrames(),
  ])
  const stitched = stitchSceneVoices(sceneVoices)
  const audioBase64 = stitched.base64
  const wordTimestamps = stitched.wordTimestamps

  // Seedance — 4 scenes parallel
  const actorId = mapAvatarToActorId(avatarUrl)
  const videos = await Promise.all(frames.map(async (frameUrl, i) => {
    const isSpeakingScene = i === 0 || i === 3
    const audioUrl = isSpeakingScene ? sceneVoices[i]?.audioUrl : null
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
    scenes[i] = { ...scenes[i], seedance_prompt: seedancePrompt, video_source: source }
    return videoUrl
  }))

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
  console.log(`[Job ${jobId}] (legacy) completed successfully`)

  try { prewarmVideos(videos.filter(Boolean)) } catch (e) {
    console.warn(`[Job ${jobId}] prewarm failed:`, e.message)
  }
}
