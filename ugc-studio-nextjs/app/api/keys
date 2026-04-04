export async function GET() {
  // Serve API keys from environment variables
  // These are set in Vercel dashboard and never exposed in code
  return Response.json({
    fal: process.env.FAL_API_KEY || '',
    eleven: process.env.ELEVENLABS_API_KEY || '',
    voiceId: process.env.ELEVENLABS_VOICE_ID || '73z5yvUD5zgBgz92lJMW'
  })
}
