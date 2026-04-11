import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

console.log('SUPABASE URL:', supabaseUrl)
console.log('SUPABASE KEY exists:', !!supabaseAnonKey)

export const supabase = supabaseUrl
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null
