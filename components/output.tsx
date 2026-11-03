import {displayOutput} from '../app/lib/validation'
export function Output({value}:{value?:string}){
 if(!value)return <p className="muted">No final output recorded.</p>
 const captions=displayOutput(value)
 if(captions)return <ol className="caption-list">{captions.map((caption,index)=><li key={index}><span>{String(index+1).padStart(2,'0')}</span><p>{caption}</p></li>)}</ol>
 let formatted=value;try{formatted=JSON.stringify(JSON.parse(value),null,2)}catch{}
 return <pre className="output-text">{formatted}</pre>
}
