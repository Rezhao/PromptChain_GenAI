import { NextResponse } from 'next/server'
import { appOrigin, createClient } from '../../lib/supabase'

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get('code')
  const origin = appOrigin(new URL(request.url).origin)
  if (!code) return NextResponse.redirect(`${origin}/sign-in?reason=oauth`)
  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) return NextResponse.redirect(`${origin}/sign-in?reason=oauth`)
  const { data: allowed, error: accessError } = await supabase.rpc('admin_is_authorized')
  if (accessError || allowed !== true) {
    await supabase.auth.signOut({ scope: 'local' })
    return NextResponse.redirect(`${origin}/sign-in?reason=${accessError ? 'setup' : 'denied'}`)
  }
  return NextResponse.redirect(`${origin}/`)
}
