import Link from 'next/link'
import {requireAdmin} from '../lib/auth'
import {signOut} from '../auth/actions'
import {ThemePicker} from '../../components/theme-picker'
export default async function StudioLayout({children}:{children:React.ReactNode}){
 const {user}=await requireAdmin()
 return <div className="shell"><aside className="sidebar"><Link href="/" className="brand">melon<span>STUDIO</span></Link><p className="sidebar-note">A good caption starts<br/>with a little curiosity.</p><nav aria-label="Studio navigation"><Link href="/">▱ <span>Prompt chains</span><span>↗</span></Link><Link href="/runs">◷ <span>Generation gallery</span><span>↗</span></Link><Link href="/chains/new">＋ <span>New chain</span><span>↗</span></Link></nav><div className="sidebar-bottom"><span className="dot"/>Connected to Melon<p>Shared workflows.<br/>Private experiments.</p></div></aside><div className="workspace"><header className="topbar"><span>THE PROMPT WORKSHOP</span><div className="account"><ThemePicker/><span className="badge">SUPERADMIN</span><span className="account-email">{user.email}</span><form action={signOut}><button className="text-button">Sign out ↗</button></form></div></header><main className="main">{children}</main></div></div>
}
