declare module "astro:actions" {
	type Actions = typeof import("/home/lralda/cci/universe/apps/landing/src/actions")["server"];

	export const actions: Actions;
}