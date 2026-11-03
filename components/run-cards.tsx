import Link from 'next/link'
import type {Run} from '../app/lib/types'
import {date} from '../app/lib/data'
import {Output} from './output'
import {SourceImage} from './source-image'
export function RunCards({runs}:{runs:Run[]}) {return <div className="run-grid">{runs.map(run=><article className="panel run-card" key={run.id}>{run.image_url&&<SourceImage className="run-thumbnail" src={run.image_url}/>}<div className="card-meta"><span className={`badge status-${run.status}`}>{run.status}</span><span>{date(run.created_at)}</span></div><h3><Link href={`/runs/${run.id}`}>{run.chain_name}</Link></h3><p className="muted run-direction">{run.prompt}</p><div className="card-output"><Output value={run.final_output}/></div><Link className="text-link" href={`/runs/${run.id}`}>Inspect run <span>↗</span></Link></article>)}</div>}
