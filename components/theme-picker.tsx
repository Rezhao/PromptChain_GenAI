
'use client'
import {useSyncExternalStore} from 'react'
function subscribe(callback:()=>void){window.addEventListener('melon-theme-change',callback);window.addEventListener('storage',callback);return ()=>{window.removeEventListener('melon-theme-change',callback);window.removeEventListener('storage',callback)}}
function snapshot(){return document.documentElement.dataset.theme??'system'}
export function ThemePicker(){
 const theme=useSyncExternalStore(subscribe,snapshot,()=> 'system')
 function change(value:string){document.documentElement.dataset.theme=value;try{localStorage.setItem('melon-studio-theme',value)}catch{};window.dispatchEvent(new Event('melon-theme-change'))}
 return <label className="theme-picker"><span className="sr-only">Color theme</span><select aria-label="Color theme" value={theme} onChange={event=>change(event.target.value)}><option value="light">☀ Light</option><option value="dark">☾ Dark</option><option value="system">◐ System</option></select></label>
}
