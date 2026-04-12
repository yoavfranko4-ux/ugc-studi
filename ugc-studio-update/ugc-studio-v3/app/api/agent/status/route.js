import { supabase } from '../../../../lib/supabase'

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const jobId = searchParams.get('jobId')

  if (!jobId) {
    return Response.json({ error: 'Missing jobId' }, { status: 400 })
  }

  if (!supabase) {
    return Response.json({ error: 'Supabase not configured' }, { status: 500 })
  }

  const { data, error } = await supabase
    .from('jobs')
    .select('status, result, error')
    .eq('id', jobId)
    .single()

  if (error) {
    return Response.json({ error: 'Job not found' }, { status: 404 })
  }

  return Response.json({
    status: data.status,
    result: data.result,
    error: data.error,
  })
}
