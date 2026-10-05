// Development-only shim so `tsc --noEmit` can follow `.astro` imports.
// `astro check` type-checks the components themselves. Not published.
declare module "*.astro" {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const Component: (props: Record<string, any>) => any;
	export default Component;
}
