export async function POST(req) {
  try {
    const formData = await req.formData()
    const file = formData.get('file')
    const falKey = formData.get('falKey')

    if (!file || !falKey) {
      return Response.json({ error: 'Missing file or falKey' }, { status: 400 })
    }

    const uploadForm = new FormData()
    uploadForm.append('file', file)

    const res = await fetch('https://fal.run/fal-ai/storage/upload', {
      method: 'POST',
      headers: { 'Authorization': `Key ${falKey}` },
      body: uploadForm
    })

    const data = await res.json()
    return Response.json(data)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
