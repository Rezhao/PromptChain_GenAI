import type {Plan,PlanStep} from './types'
export type RpcClient={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{message?:string}|null}>}
export function renderPrompt(template:string,prompt:string,previous:string) {return template.replace(/\{\{(prompt|previous_response)\}\}/g,(_match,key:string)=>key==='prompt'?prompt:previous)}
export async function executePlan(client:RpcClient,plan:Plan,input:{prompt:string;image?:{base64:string;mime:string};apiKey:string},deps:{fetch?:typeof fetch;now?:()=>number;sleep?:(ms:number)=>Promise<void>}={}) {
 const request=deps.fetch??fetch,now=deps.now??Date.now,sleep=deps.sleep??(ms=>new Promise(resolve=>setTimeout(resolve,ms))),deadline=now()+90000
 let previous=''
 if(plan.steps.length<1||plan.steps.length>5)throw Error('A workflow needs one to five steps.')
 for(const step of plan.steps) {
  validateStep(step)
  if(step.input_type==='image_and_text'&&!input.image)throw Error('This step requires a source image.')
  const prompt=renderPrompt(step.user_prompt,input.prompt,previous)
  const parts:({text:string}|{inline_data:{mime_type:string;data:string}})[]=[{text:prompt}]
  if(step.input_type==='image_and_text'&&input.image)parts.push({inline_data:{mime_type:input.image.mime,data:input.image.base64}})
  const body=JSON.stringify({contents:[{role:'user',parts}],...(step.system_prompt?{systemInstruction:{parts:[{text:step.system_prompt}]}}:{}),generationConfig:{maxOutputTokens:step.max_tokens,...(step.temperature_supported===false?{}:{temperature:Number(step.temperature)}),...(step.output_type==='json'?{responseMimeType:'application/json'}:{})}})
  const started=now();let response:Response|undefined
  for(let attempt=0;attempt<2;attempt++) {
   const remaining=deadline-now();if(remaining<=0)throw Error('The workflow exceeded its 90-second limit. Reduce the number of steps or output limits.')
   response=await request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(step.model_key)}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':input.apiKey},body,signal:AbortSignal.timeout(Math.min(30000,remaining))})
   if(response.ok||![429,500,503].includes(response.status)||attempt===1)break
   await response.body?.cancel();await sleep(500)
  }
  if(!response?.ok)throw Error(`Step ${step.order}: Gemini could not complete the request. Try again shortly.`)
  const data=await response.json() as {candidates?:{content?:{parts?:{text?:string;thought?:boolean}[]};finishReason?:string}[];usageMetadata?:{promptTokenCount?:number;candidatesTokenCount?:number}}
  const candidate=data.candidates?.[0]
  const output=candidate?.content?.parts?.filter(part=>!part.thought).map(part=>part.text??'').join('').trim()??''
  if(!output)throw Error(`Step ${step.order}: no visible response was returned.`)
  if(output.length>20000)throw Error(`Step ${step.order}: response is too long. Lower the output token limit.`)
  const {error}=await client.rpc('studio_record_response',{target_request:plan.request_id,target_step:step.id,output_text:output,input_token_count:data.usageMetadata?.promptTokenCount??null,output_token_count:data.usageMetadata?.candidatesTokenCount??null,elapsed_ms:Math.min(3600000,Math.max(0,Math.round(now()-started))),sent_prompt:prompt})
  if(error)throw Error('The response could not be saved. Check your admin access and try again.')
  if(step.output_type==='json') {try{JSON.parse(output)}catch{throw Error(`Step ${step.order} returned invalid JSON. Its response was saved for inspection.`)}}
  if(candidate?.finishReason==='MAX_TOKENS')throw Error(`Step ${step.order} reached its output limit. Its partial response was saved; increase the output limit before retrying.`)
  previous=output
 }
 const {error}=await client.rpc('studio_complete_run',{target_request:plan.request_id})
 if(error)throw Error('The final save could not be confirmed. Check this run before retrying.')
 return previous
}
function validateStep(step:PlanStep) {
 if(!/^[a-zA-Z0-9._-]+$/.test(step.model_key)||!Number.isFinite(Number(step.temperature))||Number(step.temperature)<0||Number(step.temperature)>2||!Number.isInteger(step.max_tokens)||step.max_tokens<64||step.max_tokens>2048||!['text','image_and_text'].includes(step.input_type)||!['text','json'].includes(step.output_type))throw Error('Invalid workflow configuration.')
}
