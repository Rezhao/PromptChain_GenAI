'use client'

import Link from 'next/link'
import {usePathname} from 'next/navigation'

export function StudioNav(){
 const pathname=usePathname()
 const items=[
  {href:'/',icon:'▱',label:'Prompt chains',active:pathname==='/'||(pathname.startsWith('/chains/')&&pathname!=='/chains/new')},
  {href:'/runs',icon:'◷',label:'Generation gallery',active:pathname==='/runs'||pathname.startsWith('/runs/')},
  {href:'/chains/new',icon:'＋',label:'New chain',active:pathname==='/chains/new'},
 ]
 return <nav aria-label="Studio navigation">{items.map(item=><Link key={item.href} href={item.href} aria-current={item.active?'page':undefined}><span aria-hidden="true">{item.icon}</span><span>{item.label}</span><span aria-hidden="true">↗</span></Link>)}</nav>
}
