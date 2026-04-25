// POST /api/agent/script-only
//
// Phase 1 of the new approval flow:
//   1. Generate the 4 voiceover beats (UGC) or 4 narration lines (business).
//   2. Persist the draft job with status 'awaiting_approval' and the generation
//      inputs the client passed in.
//   3. Return the 4 scripts so the client can show the approval modal.
//
// The client edits the 4 scripts in the modal (or hits "regenerate"),
// then calls /api/agent/approve-and-generate with the approved texts.

import { supabase } from '../../../../lib/supabase'
import { remainingVideos } from '../../../../lib/subscription-limits.js'
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
} from '../../../../lib/script-pipeline.js'

export const maxDuration = 60
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req) {
  try {
    const body = await req.json()

    if (!supabase) {
      return Response.json({ error: 'Supabase not configured' }, { status: 500 })
    }

    // Soft subscription quota gate (same logic as the legacy /api/agent route)
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
        console.warn('[script-only] quota check skipped:', err?.message || err)
      }
    }

    const videoType = body?.videoType || 'ugc'
    const voiceId = body?.voiceId || null
    const voiceGender = voiceId === 'nBiC8Jexp2XGyIxATg9S' ? 'male' : 'female'

    let hook, script, scenes
    if (videoType === 'business') {
      const businessName = body?.businessName || ''
      const businessDescription = body?.businessDescription || ''
      hook = getBusinessHook(businessDescription, businessName, voiceGender)
      script = await generateBusinessScript(businessName, businessDescription, hook, voiceGender)
      scenes = script?.scenes || getBusinessDefaultScenes(businessName, businessDescription)
      if (script) {
        script.voiceover_scene1 = hook
        if (script.scenes && script.scenes[0]) script.scenes[0].subtitle = hook
        script.voiceover = joinVoiceoverChunks([
          hook,
          script.voiceover_scene2,
          script.voiceover_scene3,
          script.voiceover_scene4,
        ])
      }
      if (scenes[0]) scenes[0].subtitle = hook
    } else {
      const productName = body?.productName || body?.product || ''
      const productDesc = body?.productDesc || body?.product || ''
      const applicationArea = body?.applicationArea || ''
      hook = getHook(productName, productDesc, voiceGender)
      script = await generateScript(productName, productDesc, applicationArea, hook, voiceGender)
      scenes = script?.scenes || getDefaultScenes(productName, applicationArea, productDesc, voiceGender)
      if (script) {
        script.voiceover_scene1 = hook
        if (script.scenes && script.scenes[0]) script.scenes[0].subtitle = hook
        script.voiceover = joinVoiceoverChunks([
          hook,
          script.voiceover_scene2,
          script.voiceover_scene3,
          script.voiceover_scene4,
        ])
      }
      if (scenes[0]) scenes[0].subtitle = hook
    }

    const fallbackVoiceover = videoType === 'business'
      ? getBusinessDefaultVoiceover(body?.businessName || '', body?.businessDescription || '', hook)
      : getDefaultVoiceover(body?.productName || body?.product || '', body?.applicationArea || '', hook, voiceGender)

    const v1 = scenes[0]?.subtitle || hook
    const v2 = scenes[1]?.subtitle || ''
    const v3 = scenes[2]?.subtitle || ''
    const v4 = scenes[3]?.subtitle || ''
    const scripts = [v1, v2, v3, v4]

    // Persist the draft job. The full body (avatar, product image, business
    // photos, voice id) is stored under `inputs` so approve-and-generate can
    // pick the job back up without re-collecting it from the client.
    const jobInputs = {
      videoType,
      avatarUrl: body?.avatarUrl || null,
      productImageUrl: body?.productImageUrl || null,
      productName: body?.productName || body?.product || null,
      productDesc: body?.productDesc || body?.product || null,
      applicationArea: body?.applicationArea || null,
      storyDescription: body?.storyDescription || null,
      businessName: body?.businessName || null,
      businessDescription: body?.businessDescription || null,
      businessPhotos: Array.isArray(body?.businessPhotos) ? body.businessPhotos : [],
      voiceId,
      hook,
    }

    const draftResult = {
      story: { scenes, hebrew_voice: script?.voiceover || fallbackVoiceover },
      scripts,
      hook,
    }

    let { data: job, error: insertError } = await supabase
      .from('jobs')
      .insert({ status: 'awaiting_approval', inputs: jobInputs, result: draftResult })
      .select('id')
      .single()
    if (insertError && /inputs|result/i.test(insertError.message || '')) {
      console.warn('[script-only] inputs/result column missing — inserting bare job:', insertError.message)
      const retry = await supabase.from('jobs').insert({ status: 'awaiting_approval' }).select('id').single()
      job = retry.data
      insertError = retry.error
    }

    if (insertError || !job) {
      console.error('[script-only] job insert error:', insertError?.message)
      return Response.json({ error: 'Failed to create draft job' }, { status: 500 })
    }

    return Response.json({
      jobId: job.id,
      scripts,
      hook,
    })
  } catch (e) {
    console.error('[script-only] error:', e.message)
    return Response.json({ error: e.message }, { status: 500 })
  }
}
