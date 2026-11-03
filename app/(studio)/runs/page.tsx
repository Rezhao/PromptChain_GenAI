import Link from 'next/link'
import {listRuns,getChain} from '../../lib/data'
import {pageNumber,validId} from '../../lib/validation'
import {RunCards} from '../../../components/run-cards'
import {Pagination} from '../../../components/pagination'
export default async function RunsPage({searchParams}:{searchParams:Promise<{chain?:string;page?:string}>}){
 const search=await searchParams,chainId=search.chain?validId(search.chain):null,page=pageNumber(search.page)
 const [result,chain]=await Promise.all([listRuns(chainId,page),chainId?getChain(chainId):null])
 return <><section className="page-heading"><div><p className="eyebrow">IDEAS, MADE REAL</p><h1>{chain?chain.name:'The generation gallery.'}</h1><p className="muted intro">{chain?'Every recorded generation produced by this workflow.':'Private Studio experiments and recorded Melon chain runs, all in one place.'}</p></div>{chain&&<Link href={`/chains/${chain.id}`} className="button secondary">Edit chain ↗</Link>}</section>{chain&&<p className="filter-note">Filtered to one chain · <Link className="text-link" href="/runs">View all workflows</Link></p>}{result.items.length?<RunCards runs={result.items}/>:<section className="panel empty"><h2>No runs to show yet.</h2><p className="muted">Choose a workflow and give it a test run.</p><Link href="/" className="button">Explore chains</Link></section>}<Pagination path="/runs" page={page} total={result.total} size={12} chainId={chainId??undefined}/></>
}
