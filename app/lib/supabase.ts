import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const store = await cookies()
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Configure the Melon Supabase URL and anon key before starting the prompt studio.')
  return createServerClient(url, key, {
    cookieOptions: { name: 'melon-studio-auth' },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        try { values.forEach(({ name, value, options }) => store.set(name, value, options)) }
        catch { /* Server Component writes are handled by proxy session refresh. */ }
      },
    },
  })
}

export function appOrigin(requestOrigin?: string | null) {
  const allowed = [process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL, process.env.VERCEL_BRANCH_URL]
    .filter((value): value is string => Boolean(value)).map((host) => `https://${host}`)
  if (process.env.APP_URL) allowed.push(new URL(process.env.APP_URL).origin)
  if (process.env.NODE_ENV !== 'production') allowed.push('http://localhost:3004')
  // Keep the PKCE verifier and callback on the same trusted host, including when
  // signing in through the production alias rather than the immutable URL.
  if (requestOrigin && allowed.includes(requestOrigin)) return requestOrigin
  if (allowed[0]) return allowed[0]
  if (process.env.NODE_ENV !== 'production') return 'http://localhost:3004'
  throw new Error('APP_URL must be configured for production OAuth.')
}
