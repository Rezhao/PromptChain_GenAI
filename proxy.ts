import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  if (!url || !key) return response // DAL still fails closed.
  const supabase = createServerClient(url, key, {
    cookieOptions: { name: 'melon-studio-auth' },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => {
        values.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })
  await supabase.auth.getUser()
  return response
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'] }
