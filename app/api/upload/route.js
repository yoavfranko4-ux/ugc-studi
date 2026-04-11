import { checkRateLimit } from '../middleware/rateLimit.js'
import { validateFileUpload } from '../middleware/validate.js'

export async function POST(req) {
  // Rate limiting
  const rateLimitRes = await checkRateLimit(req, 'general')
  if (rateLimitRes) return rateLimitRes

  try {
    const formData = await req.formData()
    const file = formData.get('file')

    // Validate file type and size
    const fileValidation = validateFileUpload(file)
    if (!fileValidation.valid) {
      return Response.json({ error: fileValidation.error }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const base64 = buffer.toString('base64')
    const mimeType = file.type || 'image/jpeg'
    const dataUrl = `data:${mimeType};base64,${base64}`

    return Response.json({ url: dataUrl })
  } catch (e) {
    console.error('Upload route error:', e.message)
    return Response.json({ error: 'Upload failed' }, { status: 500 })
  }
}
