'use client'
/* eslint-disable @next/next/no-img-element -- Private signed URLs must bypass the public image optimizer cache. */
import {useState} from 'react'
export function SourceImage({src,className}:{src:string;className:string}){
 const [failed,setFailed]=useState(false)
 return failed?<div className="no-image">The private preview expired or is unavailable. Refresh this page to try again.</div>:<img className={className} src={src} alt="Source image used by this workflow" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>
}
