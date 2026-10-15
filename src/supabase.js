import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL || 'https://pntixrcmuhorvpcrhmim.supabase.co'
const key =
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_imt_ECRX2UEGTipRK9oWow_nhaLSRv8'

export const isConfigured = Boolean(url && key)

export const supabase = isConfigured ? createClient(url, key) : null
