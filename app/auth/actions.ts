'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { appOrigin, createClient } from '../lib/supabase'

export async function signIn() {
  const supabase = await createClient()
  const origin = appOrigin((await headers()).get('origin'))
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: {
    redirectTo: `${origin}/auth/callback`, queryParams: { prompt: 'select_account' },
  } })
  if (error || !data.url) redirect('/sign-in?reason=oauth')
  redirect(data.url)
}
export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut({ scope: 'local' })
  redirect('/sign-in')
}
