const FAL_KEY = process.env.FAL_API_KEY;

export async function POST(req) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 });

    const arrayBuffer = await file.arrayBuffer();
    // Node.js fetch requires a Buffer (not ArrayBuffer) for binary body
    const body = Buffer.from(arrayBuffer);
    const contentType = file.type || 'application/octet-stream';

    console.log(`Uploading to fal.ai storage: ${body.length} bytes, type=${contentType}`);

    const res = await fetch('https://storage.fal.run/', {
      method: 'POST',
      headers: {
        Authorization: `Key ${FAL_KEY}`,
        'Content-Type': contentType,
        'Content-Length': String(body.length),
      },
      body,
    });

    const rawText = await res.text();
    console.log(`fal storage response (${res.status}):`, rawText.slice(0, 200));

    if (!res.ok) {
      return Response.json({ error: `Fal storage ${res.status}: ${rawText}` }, { status: 500 });
    }

    let data;
    try { data = JSON.parse(rawText); }
    catch { return Response.json({ error: `Non-JSON from fal storage: ${rawText}` }, { status: 500 }); }

    const url = data.url || data.access_url;
    if (!url) return Response.json({ error: 'No URL in fal storage response: ' + rawText }, { status: 500 });

    return Response.json({ url });
  } catch (e) {
    console.error('Upload route error:', e.message);
    return Response.json({ error: e.message }, { status: 500 });
  }
}
