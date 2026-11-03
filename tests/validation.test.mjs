import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {stripTypeScriptTypes} from 'node:module'
const source=stripTypeScriptTypes(await readFile(new URL('../app/lib/validation.ts',import.meta.url),'utf8'),{mode:'transform',disableExperimentalWarning:true})
const {validId,revision,stepInput,reordered,imageType,displayOutput}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
function form(values){const result=new FormData();for(const [key,value]of Object.entries(values))result.set(key,value);return result}
const base={name:'Observe',user_prompt:'{{prompt}}',llm_model_id:'d6200000-0000-4000-8000-000000000001',temperature:'0.7',studio_input_type:'image_and_text',studio_output_type:'text',studio_max_tokens:'512'}
test('step settings enforce bounded temperature, integer limits, and references',()=>{
 assert.equal(stepInput(form(base)).studio_max_tokens,512)
 for(const patch of [{temperature:'3'},{temperature:'NaN'},{studio_max_tokens:'64.5'},{studio_max_tokens:'2049'},{llm_model_id:'invalid'},{studio_output_type:'html'},{name:' '},{user_prompt:''}])assert.throws(()=>stepInput(form({...base,...patch})))
})
test('move operations preserve the exact step set and reject invalid boundaries',()=>{
 assert.deepEqual(reordered(['a','b','c'],'b','up'),['b','a','c'])
 assert.deepEqual(reordered(['a','b','c'],'b','down'),['a','c','b'])
 for(const [id,direction]of [['a','up'],['c','down'],['missing','up'],['b','sideways']])assert.throws(()=>reordered(['a','b','c'],id,direction))
})
test('malformed IDs and missing optimistic-concurrency revisions are rejected',()=>{
 assert.throws(()=>validId('../../bad'));assert.throws(()=>revision(form({})));assert.throws(()=>revision(form({revision:'-1'})))
 assert.equal(revision(form({revision:'0'})),0)
})
test('image formats use actual signatures and reject arbitrary content',()=>{
 assert.equal(imageType(new Uint8Array([137,80,78,71,13,10,26,10])).mime,'image/png')
 assert.throws(()=>imageType(new TextEncoder().encode('<svg>not accepted</svg>')))
})
test('caption lists render only arrays of strings, keeping arbitrary JSON as text',()=>{
 assert.deepEqual(displayOutput('["One","Two"]'),['One','Two']);assert.equal(displayOutput('{"html":"<script>bad</script>"}'),null);assert.equal(displayOutput('[1,2]'),null)
})
