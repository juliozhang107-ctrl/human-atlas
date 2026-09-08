/** Where the site's own files live.
 *
 *  A build served from a domain root and one served from a project path such as /human-atlas/ are
 *  otherwise the same build, so paths are written site-absolute and resolved against the base Vite
 *  was given. Without this every asset request would go to the domain root and miss. */
export function asset(path:string){
 const base=(import.meta.env?.BASE_URL ?? '/').replace(/\/$/,'');
 return `${base}${path.startsWith('/')?path:`/${path}`}`;
}
