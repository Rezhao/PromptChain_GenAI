import 'server-only'
import {notFound} from 'next/navigation'
import {requireAdmin} from './auth'
import {validId} from './validation'
import type {Chain,Model,Run,PageResult} from './types'
export async function studioRpc(name:string,args?:Record<string,unknown>) {
 const {supabase}=await requireAdmin();const {data,error}=await supabase.rpc(name,args)
 if(error?.code==='PGRST202')throw Error('Database setup is needed. Apply PromptChain_GenAI/supabase/001-prompt-studio.sql in Melon’s Supabase project.')
 if(error)throw Error(error.message||'The database operation failed. Try again.')
 return data
}
export async function listChains(query='',page=1) {return await studioRpc('studio_list_chains',{search_text:query.slice(0,200),page_number:page}) as PageResult<Chain>}
export async function getChain(id:string) {validId(id);const chain=await studioRpc('studio_get_chain',{target:id}) as Chain|null;if(!chain)notFound();return chain}
export async function getModels() {return await studioRpc('studio_models') as Model[]}
async function signImage(run:Run) {
 if(run.image_path&&['prompt-studio-assets','generated-media','admin-images'].includes(run.image_bucket??'')) {
  const {supabase}=await requireAdmin();const {data}=await supabase.storage.from(run.image_bucket!).createSignedUrl(run.image_path,300);run.image_url=data?.signedUrl
 }
 return run
}
export async function listRuns(chainId:string|null=null,page=1) {if(chainId)validId(chainId);const result=await studioRpc('studio_list_runs',{target_chain:chainId,page_number:page}) as PageResult<Run>;await Promise.all(result.items.map(signImage));return result}
export async function getRun(id:string) {validId(id);const run=await studioRpc('studio_get_run',{target:id}) as Run|null;if(!run)notFound();return signImage(run)}
export function date(value?:string) {return value?new Date(value).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'})+' UTC':'Not recorded'}
