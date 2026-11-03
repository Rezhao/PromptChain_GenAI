import Link from 'next/link'
export function Pagination({path,page,total,size,query,chainId}:{path:string;page:number;total:number;size:number;query?:string;chainId?:string}){
 const pages=Math.max(1,Math.ceil(total/size))
 function href(value:number){const params=new URLSearchParams({page:String(value)});if(query)params.set('q',query);if(chainId)params.set('chain',chainId);return `${path}?${params}`}
 return <nav aria-label="Pagination" className="pagination"><span>{total} {total===1?'record':'records'} · Page {page} of {pages}</span><div>{page>1&&<Link className="text-link" href={href(page-1)}>← Previous</Link>}{page<pages&&<Link className="text-link" href={href(page+1)}>Next →</Link>}</div></nav>
}
