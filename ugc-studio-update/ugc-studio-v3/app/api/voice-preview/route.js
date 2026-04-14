const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;

const SAMPLE_TEXTS = {
  'cp6q5qJLs8rR7eAWOepf': 'היי, זו דוגמה לקול שלי. ניסיתי הכל ופשוט לא עבד לי.',
  'nBiC8Jexp2XGyIxATg9S': 'היי, זו דוגמה לקול שלי. ניסיתי הכל ופשוט לא עבד לי.',
};

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const voiceId = searchParams.get('voiceId');
    if (!voiceId) return Response.json({ error: 'voiceId required' }, { status: 400 });
    if (!ELEVEN_KEY) return Response.json({ error: 'ElevenLabs key missing' }, { status: 500 });

    const text = SAMPLE_TEXTS[voiceId] || 'היי, זו דוגמה לקול שלי.';
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_v3', voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.55, use_speaker_boost: true } })
    });
    if (!res.ok) {
      const err = await res.text();
      return Response.json({ error: err }, { status: 500 });
    }
    const audio = await res.arrayBuffer();
    return new Response(audio, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=86400' } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
