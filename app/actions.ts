'use server'
import {redirect,unstable_rethrow} from 'next/navigation'
import {revalidatePath} from 'next/cache'
import {requireAdmin} from './lib/auth'
import {getChain,studioRpc} from './lib/data'
import {validId,revision,text,stepInput,reordered,imageType} from './lib/validation'
import {executePlan} from './lib/pipeline'
import type {Plan} from './lib/types'
export type ActionState={error:string;runId?:string}
function message(error:unknown) {return error instanceof Error?error.message:'The operation failed. Please try again.'}
function refresh(id:string) {revalidatePath('/');revalidatePath(`/chains/${id}`);revalidatePath('/runs')}
export async function saveChain(_state:ActionState,form:FormData):Promise<ActionState> {
 await requireAdmin();let id:string
 try {const target=form.get('id')?validId(form.get('id')):null;id=await studioRpc('studio_save_chain',{target,expected_revision:target?revision(form):null,chain_name:text(form,'name',1,200),chain_description:text(form,'description',0,10000),starter:!target&&form.get('starter')==='on'}) as string;refresh(id)}catch(error){unstable_rethrow(error);return {error:message(error)}}
 redirect(`/chains/${id}?saved=1`)
}
export async function saveStep(_state:ActionState,form:FormData):Promise<ActionState> {
 await requireAdmin();try {const chain=validId(form.get('chain_id'));await studioRpc('studio_save_step',{target_chain:chain,expected_revision:revision(form),target_step:form.get('step_id')?validId(form.get('step_id')):null,step_data:stepInput(form)});refresh(chain);return {error:''}}catch(error){unstable_rethrow(error);return {error:message(error)}}
}
export async function moveStep(_state:ActionState,form:FormData):Promise<ActionState> {
 await requireAdmin();try {const id=validId(form.get('chain_id'));const chain=await getChain(id);const ids=reordered(chain.steps.map(step=>step.id),validId(form.get('step_id')),String(form.get('direction')));await studioRpc('studio_reorder_steps',{target_chain:id,expected_revision:revision(form),ordered_steps:ids});refresh(id);return {error:''}}catch(error){unstable_rethrow(error);return {error:message(error)}}
}
export async function deleteStep(_state:ActionState,form:FormData):Promise<ActionState> {
 await requireAdmin();try {const id=validId(form.get('chain_id'));if(form.get('confirmation')!=='DELETE')throw Error('Type DELETE to confirm.');await studioRpc('studio_delete_step',{target_chain:id,expected_revision:revision(form),target_step:validId(form.get('step_id'))});refresh(id);return {error:''}}catch(error){unstable_rethrow(error);return {error:message(error)}}
}
export async function deleteChain(_state:ActionState,form:FormData):Promise<ActionState> {
 await requireAdmin();try {const id=validId(form.get('id'));if(form.get('confirmation')!=='DELETE')throw Error('Type DELETE to confirm.');await studioRpc('studio_delete_chain',{target:id,expected_revision:revision(form)});refresh(id)}catch(error){unstable_rethrow(error);return {error:message(error)}}
 redirect('/?deleted=1')
}
export async function generate(_state:ActionState,form:FormData):Promise<ActionState> {
 const {supabase}=await requireAdmin();let requestId:string|undefined;let path:string|undefined
 try {
  const apiKey=process.env.GEMINI_API_KEY;if(!apiKey)throw Error('Configure GEMINI_API_KEY in the Vercel project before generating.')
  const chainId=validId(form.get('chain_id')),expected=revision(form),prompt=text(form,'prompt',5,2000)
  const file=form.get('image');let image:{base64:string;mime:string}|undefined
  if(file instanceof File&&file.size>0) {
   if(file.size>3*1024*1024)throw Error('Images must be 3 MB or smaller.')
   const bytes=Buffer.from(await file.arrayBuffer()),type=imageType(bytes)
   const {user}=await requireAdmin();path=`${user.id}/${crypto.randomUUID()}.${type.extension}`
   const {error}=await supabase.storage.from('prompt-studio-assets').upload(path,bytes,{contentType:type.mime,upsert:false});if(error)throw Error('The source image could not be uploaded. Check the database migration and retry.')
   image={base64:bytes.toString('base64'),mime:type.mime}
  }
  const plan=await studioRpc('studio_begin_run',{target_chain:chainId,expected_revision:expected,caption_prompt:prompt,image_path:path??null}) as Plan
  requestId=plan.request_id
  await executePlan(supabase,plan,{prompt,image,apiKey});refresh(chainId)
 }catch(error){
  unstable_rethrow(error)
  if(requestId) {
   // A lost completion response can follow a commit. Inspect before marking failure.
   try {const run=await studioRpc('studio_get_run',{target:requestId});if(run?.status==='completed')redirect(`/runs/${requestId}`)}catch(recovery){unstable_rethrow(recovery)}
   await supabase.rpc('fail_caption_request',{target_request:requestId,failure_message:message(error).slice(0,2000)})
   revalidatePath('/runs')
  }else if(path){await supabase.storage.from('prompt-studio-assets').remove([path])}
  return {error:message(error),runId:requestId}
 }
 redirect(`/runs/${requestId}`)
}
