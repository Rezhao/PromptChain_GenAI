import 'server-only'
import { redirect } from 'next/navigation'
import { createClient } from './supabase'

// Call from every DAL function, page and mutation, not only the layout.
// The RPC independently verifies the signed session and live database flag.
export async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) redirect('/sign-in')
  const { data: allowed, error: accessError } = await supabase.rpc('admin_is_authorized')
  if (accessError || allowed !== true) redirect(`/sign-in?reason=${accessError ? 'setup' : 'denied'}`)
  return { supabase, user }
}
