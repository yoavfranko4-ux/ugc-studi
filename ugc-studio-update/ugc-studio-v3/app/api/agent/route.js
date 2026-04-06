const FAL_KEY = process.env.FAL_API_KEY;
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID || '73z5yvUD5zgBgz92lJMW';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// Free background music URLs (royalty-free)
const MUSIC_TRACKS = [
  { name: 'Upbeat Positive', url: 'https://www.soundjay.com/misc/sounds/bell-ringing-05.mp3' },
  { name: 'Chill Vibes', url: 'https://cdn.pixabay.com/download/audio/2022/01/18/audio_d0c6ff1bab.mp3' },
  { name: 'Energetic', url: 'https://cdn.pixabay.com/download/audio/2022/03/15/audio_8cb749e7d5.mp3' },
];

async function pollFal(requestId, maxWait = 300000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const res = await fetch(`https://queue.fal.run/fal-ai/nano-banana-2/requests/${requestId}/status`, {
      headers: { Authorization: `Key ${FAL_KEY}` }
    });
    const data = await res.json();
    if (data.status === 'COMPLETED') {
      const result = await fetch(`https://queue.fal.run/fal-ai/nano-banana-2/requests/${requestId}`, {
        headers: { Authorization: `Key ${FAL_KEY}` }
      });
      return await result.json();
    }
    if (data.status === 'FAILED') throw new Error('Fal job failed');
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Timeout');
}

async function generateNBFrame(prompt, imageUrls) {
  const validUrls = imageUrls.filter(Boolean);
  console.log(`NB: ${validUrls.length} images`);
  if (validUrls.length === 0) {
    const res = await fetch('https://queue.fal.run/fal-ai/nano-banana-2', {
      method: 'POST',
      headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, image_size: 'portrait_4_3' })
    });
    const json = await res.json();
    if (!json.request_id) throw new Error('No request_id: ' + JSON.stringify(json));
    const result = await pollFal(json.request_id);
    return result?.images?.[0]?.url || null;
  }
  const res = await fetch('https://queue.fal.run/fal-ai/nano-banana-2/edit', {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, image_urls: validUrls })
  });
  const json = await res.json();
  console.log('NB submit:', JSON.stringify(json).slice(0, 150));
  if (!json.request_id) throw new Error('No request_id: ' + JSON.stringify(json));
  const result = await pollFal(json.request_id);
  return result?.images?.[0]?.url || null;
}

async function generateScript(productName, productDesc, applicationArea, storyDescription) {
  if (!ANTHROPIC_KEY) return null;
  const storyContext = storyDescription ? `\nStory/events the client wants: ${storyDescription}` : '';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514', max_tokens: 2000,
      messages: [{ role: 'user', content: `You are a UGC ad expert. Create a viral 4-scene ad for: "${productName}".
Description: ${productDesc}
How to use: ${applicationArea}${storyContext}

CRITICAL RULES:
1. The voiceover MUST be EXACTLY 20 seconds when spoken at natural pace — roughly 55-65 Hebrew words total. Split it into 4 parts, one per scene (each ~5 seconds = ~14 Hebrew words). Write naturally, conversational, not too fast.
2. Each scene subtitle must be EXACTLY what the voiceover says in that scene (not a summary — the actual words).
3. Scene 3 nb_prompt: ONE single realistic photo, NOT a collage, NOT a grid, NOT split screen.
4. STORY INTEGRATION — CRITICAL: If "Story/events the client wants" is provided above, you MUST use it to change the setting and actions in ALL nb_prompts and kling_prompts. The story completely overrides any default setting. Example: if story says "clothing store, woman tries a dress" — all scenes must be in a clothing store with the person trying clothes, NOT in a bathroom. Adapt every single prompt to match the story.

Return ONLY valid JSON (no markdown, no explanation):
{
  "voiceover_scene1": "Hebrew text for scene 1, ~14 words, natural conversational tone",
  "voiceover_scene2": "Hebrew text for scene 2, ~14 words, mentioning ${productName}",
  "voiceover_scene3": "Hebrew text for scene 3, ~14 words, describing using the product",
  "voiceover_scene4": "Hebrew text for scene 4, ~14 words, CTA with urgency",
  "scenes": [
    {
      "type": "כאב",
      "nb_prompt": "woman frustrated overwhelmed in bathroom mirror stressed expression, morning natural light iPhone selfie vertical, single frame photo, do not change person appearance from reference",
      "kling_prompt": "Person sighs looks at mirror frustrated shakes head overwhelmed, slight camera shake handheld iPhone natural light then settles",
      "subtitle": "exact same text as voiceover_scene1"
    },
    {
      "type": "גילוי",
      "nb_prompt": "same person from reference photo discovers ${productName} holds it label facing camera curious smile, bathroom natural light iPhone vertical, single frame photo, maintain exact facial features",
      "kling_prompt": "Continuing from previous scene same person picks up product reads label eyes widen holds toward camera, handheld natural light",
      "subtitle": "exact same text as voiceover_scene2"
    },
    {
      "type": "שימוש",
      "nb_prompt": "same person from reference photo actively ${applicationArea}, close up showing the action clearly, single frame photo not collage not grid not split screen not multiple panels, genuine focused expression, natural light, maintain exact facial features from reference",
      "kling_prompt": "Continuing from previous scene same person performs ${applicationArea} step by step showing the full process, close up genuine reaction, hands clearly visible, handheld iPhone natural light",
      "subtitle": "exact same text as voiceover_scene3"
    },
    {
      "type": "CTA",
      "nb_prompt": "same person from reference photo holds ${productName} product confidently points at camera big smile satisfied result, bathroom natural light, single frame photo, maintain exact facial features",
      "kling_prompt": "Continuing from previous scene same person holds product points directly at camera thumbs up excited authentic energy then settles",
      "subtitle": "exact same text as voiceover_scene4"
    }
  ]
}` }]
    })
  });
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    // Build full voiceover from 4 parts and sync subtitles
    const v1 = parsed.voiceover_scene1 || '';
    const v2 = parsed.voiceover_scene2 || '';
    const v3 = parsed.voiceover_scene3 || '';
    const v4 = parsed.voiceover_scene4 || '';
    parsed.voiceover = `${v1} ${v2} ${v3} ${v4}`.trim();
    // Sync subtitles to voiceover parts
    if (parsed.scenes) {
      parsed.scenes[0].subtitle = v1;
      parsed.scenes[1].subtitle = v2;
      parsed.scenes[2].subtitle = v3;
      parsed.scenes[3].subtitle = v4;
    }
    return parsed;
  } catch { return null; }
}

export async function POST(req) {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const send = async (data) => {
    try { await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {}
  };

  const { productName, productDesc, applicationArea, storyDescription, avatarUrl, productImageUrl } = await req.json();
  console.log('Agent started:', { productName, hasAvatar: !!avatarUrl, hasProduct: !!productImageUrl });

  (async () => {
    try {
      await send({ step: 'upload', progress: 5, message: '📤 מכין תמונות...' });
      const preparedAvatar = avatarUrl || null;
      const preparedProduct = productImageUrl || null;
      await send({ step: 'upload_done', progress: 8, message: '✅ תמונות מוכנות!' });

      await send({ step: 'script', progress: 10, message: '✍️ Claude כותב סקריפט 20 שניות...' });
      const script = await generateScript(productName, productDesc, applicationArea, storyDescription);
      const scenes = script?.scenes || getDefaultScenes(productName, applicationArea);
      const voiceover = script?.voiceover || getDefaultVoiceover(productName, applicationArea);
      await send({ step: 'script_done', progress: 15, message: '✅ סקריפט מוכן!', scenes, voiceover });

      // ElevenLabs V3 - guaranteed
      await send({ step: 'voice', progress: 18, message: '🎙️ יוצר קריינות עברית V3...' });
      let audioBase64 = null;
      try {
        const voiceRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE}`, {
          method: 'POST',
          headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: voiceover,
            model_id: 'eleven_v3',
            voice_settings: {
              stability: 0.45,
              similarity_boost: 0.75,
              style: 0.3,
              use_speaker_boost: true
            }
          })
        });
        if (voiceRes.ok) {
          audioBase64 = Buffer.from(await voiceRes.arrayBuffer()).toString('base64');
          await send({ step: 'voice_done', progress: 22, message: '✅ קריינות V3 מוכנה!', audioBase64 });
          console.log('ElevenLabs V3: success');
        } else {
          const errText = await voiceRes.text();
          console.error('ElevenLabs V3 failed:', errText);
          await send({ step: 'voice_fail', progress: 22, message: `⚠️ קריינות נכשלה: ${errText.slice(0,100)}` });
        }
      } catch (e) {
        console.error('Voice error:', e.message);
        await send({ step: 'voice_fail', progress: 22, message: '⚠️ קריינות נכשלה' });
      }

      // NB frames
      const frameUrls = [];
      const frameProgresses = [25, 38, 51, 64];
      let prevFrame = null;
      for (let i = 0; i < 4; i++) {
        await send({ step: `nb_${i+1}`, progress: frameProgresses[i], message: `🎨 Nano Banana — סצנה ${i+1}/4 (${scenes[i].type})...` });
        try {
          const imageUrls = [];
          if (preparedAvatar) imageUrls.push(preparedAvatar);
          if (prevFrame) imageUrls.push(prevFrame);
          if (preparedProduct) imageUrls.push(preparedProduct);
          const frameUrl = await generateNBFrame(scenes[i].nb_prompt, imageUrls);
          frameUrls.push(frameUrl);
          if (frameUrl) prevFrame = frameUrl;
          await send({ step: `nb_${i+1}_done`, progress: frameProgresses[i]+5, message: `✅ פריים ${i+1} מוכן!`, frameUrl, frameIndex: i });
          console.log(`NB frame ${i+1}: ${frameUrl ? 'OK' : 'FAIL'}`);
        } catch (e) {
          console.error(`NB frame ${i+1} failed:`, e.message);
          frameUrls.push(null);
          await send({ step: `nb_${i+1}_fail`, progress: frameProgresses[i]+5, message: `❌ פריים ${i+1} נכשל: ${e.message}`, frameIndex: i });
        }
      }

      await send({
        step: 'frames_done', progress: 70,
        message: '🎬 פריימים מוכנים! מתחיל Kling...',
        frameUrls, scenes, voiceover, audioBase64,
        musicTracks: MUSIC_TRACKS,
        klingPrompts: scenes.map(s => s.kling_prompt)
      });

    } catch (e) {
      console.error('Agent error:', e.message);
      await send({ step: 'error', message: `שגיאה: ${e.message}` });
    } finally {
      try { await writer.close(); } catch {}
    }
  })();

  return new Response(stream.readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }
  });
}

function getDefaultVoiceover(productName, applicationArea) {
  const v1 = `ממש נמאס לי. ניסיתי כל כך הרבה דברים ושום דבר לא עבד.`;
  const v2 = `עד שמישהו המליץ לי על ${productName} ולא האמנתי שזה יעזור.`;
  const v3 = `התחלתי להשתמש, ${applicationArea}, והתוצאות הפתיעו אותי לגמרי.`;
  const v4 = `תנסו את ${productName} — יש אחריות מלאה, אין לכם מה להפסיד!`;
  return `${v1} ${v2} ${v3} ${v4}`;
}

function getDefaultScenes(productName, applicationArea) {
  const v1 = `ממש נמאס לי. ניסיתי כל כך הרבה דברים ושום דבר לא עבד.`;
  const v2 = `עד שמישהו המליץ לי על ${productName} ולא האמנתי שזה יעזור.`;
  const v3 = `התחלתי להשתמש, ${applicationArea}, והתוצאות הפתיעו אותי לגמרי.`;
  const v4 = `תנסו את ${productName} — יש אחריות מלאה, אין לכם מה להפסיד!`;
  return [
    { type: 'כאב', nb_prompt: 'woman frustrated overwhelmed in bathroom mirror stressed expression hand on forehead, morning natural light iPhone selfie vertical, single frame photo, do not change person appearance from reference', kling_prompt: 'Person sighs looks at mirror frustrated shakes head overwhelmed, slight camera shake handheld iPhone natural light then settles', subtitle: v1 },
    { type: 'גילוי', nb_prompt: `same person from reference photo discovers ${productName} holds it label facing camera curious smile, bathroom natural light iPhone vertical, single frame photo, maintain exact facial features`, kling_prompt: `Continuing from previous scene same person picks up ${productName} reads label eyes widen holds toward camera, handheld natural light`, subtitle: v2 },
    { type: 'שימוש', nb_prompt: `same person from reference photo actively ${applicationArea}, close up showing the action clearly, single frame photo not collage not grid not split screen not multiple panels, genuine focused expression, natural light, maintain exact facial features from reference`, kling_prompt: `Continuing from previous scene same person performs ${applicationArea} step by step showing full process, close up genuine reaction, hands clearly visible, handheld iPhone natural light`, subtitle: v3 },
    { type: 'CTA', nb_prompt: `same person from reference photo holds ${productName} product confidently points at camera big smile satisfied result, bathroom natural light, single frame photo, maintain exact facial features`, kling_prompt: 'Continuing from previous scene same person holds product points directly at camera thumbs up excited authentic energy then settles', subtitle: v4 }
  ];
}
