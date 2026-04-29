import { NextResponse } from 'next/server';
export async function GET() {
  return NextResponse.json({
    byteplus: process.env.ARK_API_KEY ? '✅' : '❌',
    eleven: process.env.ELEVENLABS_API_KEY ? '✅' : '❌',
    anthropic: process.env.ANTHROPIC_API_KEY ? '✅' : '❌',
    voiceId: process.env.ELEVENLABS_VOICE_ID || 'not set'
  });
}
