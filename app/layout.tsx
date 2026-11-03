import type {Metadata} from 'next'
import './globals.css'
export const metadata:Metadata={title:{default:'Melon Prompt Studio',template:'%s · Melon Prompt Studio'},description:'Build, test, and refine Melon’s caption workflows.',robots:{index:false,follow:false}}
const themeScript=`try{var t=localStorage.getItem('melon-studio-theme');document.documentElement.dataset.theme=['light','dark','system'].includes(t)?t:'system'}catch(e){}`
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="en" data-theme="system" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:themeScript}}/></head><body>{children}</body></html>}
