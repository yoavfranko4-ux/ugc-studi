import crypto from 'crypto'
import { checkRateLimit } from '../middleware/rateLimit.js'
import { validateFileUpload } from '../middleware/validate.js'

export async function POST(req) {
  // Rate limiting
  const rateLimitRes = await checkRateLimit(req, 'general')
  if (rateLimitRes) return rateLimitRes

  try {
    const formData = await req.formData()
    const file = formData.get('file')

    // Server-side API key only
    const falKey = process.env.FAL_API_KEY
    if (!falKey) {
      return Response.json({ error: 'Server configuration error' }, { status: 500 })
    }

    // Validate file type and size
    const fileValidation = validateFileUpload(file)
    if (!fileValidation.valid) {
      return Response.json({ error: fileValidation.error }, { status: 400 })
    }

    // Generate random filename to prevent path traversal / info leakage
    const ext = file.type === 'image/jpeg' ? '.jpg' : file.type === 'image/png' ? '.png' : '.webp'
    const randomName = crypto.randomUUID() + ext
    const renamedFile = new File([file], randomName, { type: file.type })

    const uploadForm = new FormData()
    uploadForm.append('file', renamedFile)

    const res = await fetch('https://fal.run/fal-ai/storage/upload', {
      method: 'POST',
      headers: { 'Authorization': `Key ${falKey}` },
      body: uploadForm
    })

    const data = await res.json()
    return Response.json(data)
  } catch (e) {
    return Response.json({ error: 'Upload failed' }, { status: 500 })
  }
}
