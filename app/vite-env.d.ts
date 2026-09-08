/** Vite replaces import.meta.env.BASE_URL at build time with the base the site is served from.
 *  This project's tsconfig does not pull in vite/client, so the one field used is declared here. */
interface ImportMeta {
 readonly env?: {readonly BASE_URL?: string};
}
