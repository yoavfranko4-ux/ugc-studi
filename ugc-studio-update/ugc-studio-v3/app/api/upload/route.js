const FAL_KEY = process.env.FAL_API_KEY;

export async function POST(req) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 });

    const buffer = await file.arrayBuffer();
    const contentType = file.type || 'application/octet-stream';

    // Upload to fal.ai storage — returns a publicly accessible CDN URL
    const res = await fetch('https://storage.fal.run/', {
      method: 'POST',
      headers: {
        Authorization: `Key ${FAL_KEY}`,
        'Content-Type': contentType,
      },
      body: buffer,
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('Fal storage upload failed:', text);
      return Response.json({ error: `Fal storage error: ${text}` }, { status: 500 });
    }

    const data = await res.json();
    const url = data.url || data.access_url;
    if (!url) return Response.json({ error: 'No URL in fal storage response: ' + JSON.stringify(data) }, { status: 500 });

    return Response.json({ url });
  } catch (e) {
    console.error('Upload route error:', e.message);
    return Response.json({ error: e.message }, { status: 500 });
  }
}
