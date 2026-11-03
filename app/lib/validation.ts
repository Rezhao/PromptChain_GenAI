export function validId(value:unknown) {const text=String(value??'');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text))throw Error('Invalid record ID.');return text}
export function revision(form:FormData) {const raw=form.get('revision');const value=Number(raw);if(raw===null||raw===''||!Number.isInteger(value)||value<0)throw Error('Reload the workflow before saving.');return value}
export function pageNumber(value:unknown) {const n=Number(value);return Number.isInteger(n)&&n>=1&&n<=100000?n:1}
export function text(form:FormData,key:string,min:number,max:number) {const value=String(form.get(key)??'').trim();if(value.length<min||value.length>max)throw Error(`${key.replace(/_/g,' ')} must contain ${min}–${max} characters.`);return value}
export function stepInput(form:FormData) {
 const temperature=Number(form.get('temperature'));const tokens=Number(form.get('studio_max_tokens'))
 if(!Number.isFinite(temperature)||temperature<0||temperature>2)throw Error('Temperature must be between 0 and 2.')
 if(!Number.isInteger(tokens)||tokens<64||tokens>2048)throw Error('Output limit must be 64–2048 tokens.')
 const input=String(form.get('studio_input_type'));const output=String(form.get('studio_output_type'))
 if(!['text','image_and_text'].includes(input)||!['text','json'].includes(output))throw Error('Choose a valid input and output type.')
 return {name:text(form,'name',1,200),system_prompt:text(form,'system_prompt',0,10000),user_prompt:text(form,'user_prompt',1,10000),llm_model_id:validId(form.get('llm_model_id')),temperature,studio_input_type:input,studio_output_type:output,studio_max_tokens:tokens}
}
export function reordered(ids:string[],stepId:string,direction:string) {
 if(!['up','down'].includes(direction))throw Error('Invalid move direction.')
 const index=ids.indexOf(stepId),next=index+(direction==='up'?-1:1)
 if(index<0||next<0||next>=ids.length)throw Error('That step cannot move further.')
 const result=[...ids];[result[index],result[next]]=[result[next],result[index]];return result
}
export function imageType(bytes:Uint8Array) {
 if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value))return {mime:'image/png',extension:'png'}
 if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return {mime:'image/jpeg',extension:'jpg'}
 if(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return {mime:'image/webp',extension:'webp'}
 throw Error('Upload a PNG, JPEG, or WebP image.')
}
export function displayOutput(value:string):string[]|null {try{const parsed=JSON.parse(value);return Array.isArray(parsed)&&parsed.length>0&&parsed.every(item=>typeof item==='string')?parsed:null}catch{return null}}
