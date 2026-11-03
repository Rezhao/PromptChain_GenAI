import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {stripTypeScriptTypes} from 'node:module'
const source=stripTypeScriptTypes(await readFile(new URL('../app/lib/pipeline.ts',import.meta.url),'utf8'),{mode:'transform',disableExperimentalWarning:true})
const {executePlan,renderPrompt}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const step={id:'step-1',order:1,name:'Observe',model_key:'gemini-flash-lite-latest',system_prompt:'Only facts.',user_prompt:'{{prompt}}',temperature:0.7,temperature_supported:true,input_type:'image_and_text',output_type:'text',max_tokens:512}
const input={prompt:'A campus caption',image:{base64:'fixture',mime:'image/png'},apiKey:'test-secret'}
const success=text=>new Response(JSON.stringify({candidates:[{content:{parts:[{text}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:20,candidatesTokenCount:10}}))
test('image → text → JSON passes previous output and sends image only to the configured step',async()=>{
 const bodies=[],records=[];let count=0
 const steps=[step,{...step,id:'step-2',order:2,input_type:'text',user_prompt:'Angle: {{previous_response}}'},{...step,id:'step-3',order:3,input_type:'text',output_type:'json',user_prompt:'Captions: {{previous_response}}'}]
 const client={rpc:async(name,args)=>{records.push({name,args});return {data:null,error:null}}}
 const output=await executePlan(client,{request_id:'run',steps},input,{fetch:async(url,options)=>{assert.ok(url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/'));bodies.push(JSON.parse(options.body));return success(['Visible facts.','Funny angle.','["Caption one.","Caption two."]'][count++])}})
 assert.equal(output,'["Caption one.","Caption two."]')
 assert.equal(bodies[0].contents[0].parts.length,2);assert.equal(bodies[1].contents[0].parts.length,1)
 assert.equal(bodies[1].contents[0].parts[0].text,'Angle: Visible facts.')
 assert.equal(bodies[2].generationConfig.responseMimeType,'application/json')
 assert.equal(bodies[0].systemInstruction.parts[0].text,'Only facts.')
 assert.deepEqual(records.map(record=>record.name),['studio_record_response','studio_record_response','studio_record_response','studio_complete_run'])
 assert.equal(records[0].args.input_token_count,20)
 assert.equal(records[1].args.sent_prompt,'Angle: Visible facts.')
})
test('hidden thought parts are excluded, unknown usage stays null, unsupported temperature is omitted',async()=>{
 let saved,body
 await executePlan({rpc:async(name,args)=>{if(name==='studio_record_response')saved=args;return {data:null,error:null}}},{request_id:'run',steps:[{...step,temperature_supported:false}]},input,{fetch:async(_url,options)=>{body=JSON.parse(options.body);return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'Hidden',thought:true},{text:'Visible caption.'}]}}]}))}})
 assert.equal(saved.output_text,'Visible caption.');assert.equal(saved.input_token_count,null);assert.equal(body.generationConfig.temperature,undefined)
})
test('invalid JSON is logged for inspection and never finalized',async()=>{
 const calls=[]
 await assert.rejects(executePlan({rpc:async(name)=>{calls.push(name);return {data:null,error:null}}},{request_id:'run',steps:[{...step,output_type:'json'}]},input,{fetch:async()=>success('not JSON')}),/invalid JSON/)
 assert.deepEqual(calls,['studio_record_response'])
})
test('truncated provider responses are saved but cannot complete the workflow',async()=>{
 const calls=[]
 await assert.rejects(executePlan({rpc:async name=>{calls.push(name);return {data:null,error:null}}},{request_id:'run',steps:[step]},input,{fetch:async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:'Cut off'}]},finishReason:'MAX_TOKENS'}]}))}),/output limit/)
 assert.deepEqual(calls,['studio_record_response'])
})
test('invalid provider configuration and missing images fail before any API request',async()=>{
 const deps={fetch:async()=>{throw Error('Should not fetch')}}
 const client={rpc:async()=>({data:null,error:null})}
 await assert.rejects(executePlan(client,{request_id:'run',steps:[{...step,model_key:'https://other.example'}]},input,deps),/Invalid workflow/)
 await assert.rejects(executePlan(client,{request_id:'run',steps:[step]},{...input,image:undefined},deps),/requires a source image/)
})
test('transient provider errors retry once; authorization errors never retry',async()=>{
 let requests=0;const sleeps=[];const client={rpc:async()=>({data:null,error:null})}
 await executePlan(client,{request_id:'run',steps:[step]},input,{fetch:async()=>++requests===1?new Response('',{status:503}):success('Caption.'),sleep:async ms=>sleeps.push(ms)})
 assert.equal(requests,2);assert.deepEqual(sleeps,[500]);requests=0
 await assert.rejects(executePlan(client,{request_id:'run',steps:[step]},input,{fetch:async()=>{requests++;return new Response('',{status:403})}}),/could not complete/)
 assert.equal(requests,1)
})
test('placeholders are substituted once; user input cannot expand another placeholder',()=>{
 assert.equal(renderPrompt('{{prompt}} / {{previous_response}}','{{previous_response}}','{{prompt}}'),'{{previous_response}} / {{prompt}}')
})
