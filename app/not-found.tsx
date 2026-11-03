import Link from 'next/link'
export default function NotFound(){return <main className="standalone"><p className="eyebrow">NOT FOUND</p><h1>This record is no longer here.</h1><p className="muted">It may have been deleted by another admin.</p><Link className="button" href="/">Back to workflows</Link></main>}
