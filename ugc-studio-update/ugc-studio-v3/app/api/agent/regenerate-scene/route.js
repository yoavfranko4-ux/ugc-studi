// POST /api/agent/regenerate-scene
//
// Regenerates a single scene (1-4) of an existing completed job without
// remaking the other three scenes, the voiceover, or the final composite.
// Re-uses the same per-scene audio_url from the original job for Seedance
// lipsync (speaking scenes 1 + 4) so the regenerated clip stays in sync
// with the existing voiceover track.

import { fal } from '@fal-ai/client'
import { supabase } from '../../../../lib/supabase'
import { generateNBFrame } from '../../../../lib/agent-pipeline.js'
import { mapAvatarToActorId } from '../../../../lib/script-pipeline.js'
import {
  buildSeedancePrompt,
  generateSeedanceVideo,
} from '../../../../lib/seedance-pipeline.js'

export const maxDuration = 300
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FAL_KEY = process.env.FAL_API_KEY
fal.config({ credentials: FAL_KEY })

const MAX_REGENS_PER_SCENE = 3

export async function POST(req) {
  if (!supabase) {
    return Response.json({ error: 'Supabase not configured' }, { status: 500 })
  }

  let body
  try { body = await req.json() }
  catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  let {
    jobId,
    sceneNumber,
    customPrompt,
    videoType,
    avatarUrl,
    productImageUrl,
    businessPhotos,
  } = body || {}

  if (!jobId || typeof jobId !== 'string') {
    return Response.json({ error: 'Missing jobId' }, { status: 400 })
  }
  if (![1, 2, 3, 4].includes(Number(sceneNumber))) {
    return Response.json({ error: 'sceneNumber must be 1, 2, 3, or 4' }, { status: 400 })
  }
  const sceneIdx = Number(sceneNumber) - 1

  const { data: job, error: loadError } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .single()
  if (loadError || !job) {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }
  if (job.status !== 'done') {
    return Response.json({
      error: `Job status is "${job.status}" — can only regenerate scenes of completed jobs`,
    }, { status: 409 })
  }

  const persistedInputs = (job.inputs && typeof job.inputs === 'object') ? job.inputs : {}
  if (videoType == null) videoType = persistedInputs.videoType || 'ugc'
  if (avatarUrl == null) avatarUrl = persistedInputs.avatarUrl || null
  if (productImageUrl == null) productImageUrl = persistedInputs.productImageUrl || null
  if (!Array.isArray(businessPhotos)) {
    businessPhotos = Array.isArray(persistedInputs.businessPhotos) ? persistedInputs.businessPhotos : []
  }
  const productName = persistedInputs.productName || ''
  const businessName = persistedInputs.businessName || ''

  const result = job.result || {}
  const scenes = result.story?.scenes || []
  if (!scenes[sceneIdx]) {
    return Response.json({ error: `Scene ${sceneNumber} data missing from job result` }, { status: 500 })
  }

  const regenerations_used = (job.regenerations_used && typeof job.regenerations_used === 'object') ? job.regenerations_used : {}
  const currentCount = regenerations_used[String(sceneNumber)] || 0
  if (currentCount >= MAX_REGENS_PER_SCENE) {
    return Response.json({
      error: `Scene ${sceneNumber} has reached the regeneration limit (${MAX_REGENS_PER_SCENE})`,
      regenerations_used,
    }, { status: 429 })
  }

  const nbPrompt = (typeof customPrompt === 'string' && customPrompt.trim())
    ? customPrompt.trim()
    : scenes[sceneIdx].nb_prompt

  const envBase = process.env.NEXT_PUBLIC_BASE_URL
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  const host = req.headers.get('host')
  const requestBase = host ? `${proto}://${host}` : null
  const baseUrl = envBase || requestBase || 'https://ugc-studi-production.up.railway.app'
  const prepareUrl = (u) => {
    if (!u || typeof u !== 'string') return null
    if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('data:')) return u
    return u.startsWith('/') ? `${baseUrl}${u}` : `${baseUrl}/${u}`
  }

  const preparedAvatar = prepareUrl(avatarUrl)
  const preparedProduct = prepareUrl(productImageUrl)
  const preparedBusinessPhotos = Array.isArray(businessPhotos) ? businessPhotos.map(prepareUrl).filter(Boolean) : []
  const preparedPrevFrame = prepareUrl(result.frames?.[sceneIdx - 1])

  const isScene2 = sceneIdx === 1
  const isScene4 = sceneIdx === 3
  const productOnly = isScene2 && videoType !== 'business'
  const scene4Context = isScene4 && !productOnly

  const imageUrls = []
  if (videoType === 'business') {
    if (isScene2) preparedBusinessPhotos.slice(0, 3).forEach(u => imageUrls.push(u))
    else {
      if (preparedAvatar) imageUrls.push(preparedAvatar)
      if (preparedPrevFrame) imageUrls.push(preparedPrevFrame)
      if (preparedBusinessPhotos[0] && (sceneIdx === 2 || sceneIdx === 3)) imageUrls.push(preparedBusinessPhotos[0])
    }
  } else {
    if (isScene2) {
      if (preparedProduct) imageUrls.push(preparedProduct)
    } else {
      if (preparedAvatar) imageUrls.push(preparedAvatar)
      if (preparedPrevFrame) imageUrls.push(preparedPrevFrame)
      if (preparedProduct && (sceneIdx === 2 || sceneIdx === 3)) imageUrls.push(preparedProduct)
    }
  }

  // 1) Re-run NanoBanana for this scene only
  let newFrameUrl
  try {
    newFrameUrl = await generateNBFrame(nbPrompt, imageUrls, 3, { productOnly, scene4Context })
  } catch (e) {
    console.error(`[regenerate-scene] NB frame failed for job ${jobId} scene ${sceneNumber}:`, e.message)
    return Response.json({ error: `NanoBanana frame generation failed: ${e.message}` }, { status: 502 })
  }
  if (!newFrameUrl) {
    return Response.json({ error: 'NanoBanana frame generation returned no URL' }, { status: 502 })
  }

  // 2) Re-run Seedance for this scene with the original audio_url for
  //    speaking scenes (so the lipsync still aligns with the existing
  //    voiceover track on the editor).
  const actorId = mapAvatarToActorId(avatarUrl)
  const isSpeakingScene = sceneIdx === 0 || sceneIdx === 3
  const audioUrl = isSpeakingScene ? (result.sceneAudioUrls?.[sceneIdx] || null) : null
  const hebrewLine = scenes[sceneIdx]?.subtitle || ''

  const seedancePrompt = buildSeedancePrompt({
    sceneIdx,
    actorId,
    productName,
    hebrewLine,
    videoType,
    businessName,
  })

  const { videoUrl: newVideoUrl, source } = await generateSeedanceVideo({
    sceneIdx,
    prompt: seedancePrompt,
    imageUrl: newFrameUrl,
    audioUrl,
    label: `regenerate-scene job ${jobId} scene ${sceneNumber}`,
  })

  if (!newVideoUrl) {
    const framesCopy = Array.isArray(result.frames) ? [...result.frames] : [null, null, null, null]
    framesCopy[sceneIdx] = newFrameUrl
    await supabase.from('jobs').update({ result: { ...result, frames: framesCopy } }).eq('id', jobId)
    return Response.json({
      success: false,
      error: 'Frame regenerated but Seedance video generation failed — try again',
      newFrameUrl,
      newVideoUrl: null,
    }, { status: 502 })
  }

  // 3) Persist
  const framesCopy = Array.isArray(result.frames) ? [...result.frames] : [null, null, null, null]
  const videosCopy = Array.isArray(result.videos) ? [...result.videos] : [null, null, null, null]
  const scenesCopy = Array.isArray(result.story?.scenes) ? [...result.story.scenes] : []
  framesCopy[sceneIdx] = newFrameUrl
  videosCopy[sceneIdx] = newVideoUrl
  if (scenesCopy[sceneIdx]) {
    scenesCopy[sceneIdx] = { ...scenesCopy[sceneIdx], seedance_prompt: seedancePrompt, video_source: source }
  }
  const newResult = {
    ...result,
    frames: framesCopy,
    videos: videosCopy,
    story: { ...(result.story || {}), scenes: scenesCopy },
  }
  const newRegenCount = { ...regenerations_used, [String(sceneNumber)]: currentCount + 1 }

  let { error: updateError } = await supabase
    .from('jobs')
    .update({ result: newResult, regenerations_used: newRegenCount })
    .eq('id', jobId)

  if (updateError && /regenerations_used/i.test(updateError.message || '')) {
    const retry = await supabase.from('jobs').update({ result: newResult }).eq('id', jobId)
    updateError = retry.error
  }

  if (updateError) {
    console.error(`[regenerate-scene] supabase update failed: ${updateError.message}`)
    return Response.json({
      success: false,
      error: `Failed to save regenerated scene: ${updateError.message}`,
      newFrameUrl,
      newVideoUrl,
    }, { status: 500 })
  }

  return Response.json({
    success: true,
    sceneNumber,
    newFrameUrl,
    newVideoUrl,
    regenerations_used: newRegenCount,
    result: newResult,
  })
}
