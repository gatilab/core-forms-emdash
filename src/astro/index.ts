/**
 * Astro components. EmDash loads `blockComponents` (the descriptor's
 * `componentsEntry`) to render "Form" blocks in Portable Text.
 */
import CoreForm from "./CoreForm.astro";
import FormAssets from "./FormAssets.astro";

export { CoreForm, FormAssets };
export { loadForm, renderFormsInHtml, type RenderedForm } from "./load.js";

export const blockComponents = {
	form: CoreForm,
};
