/**
 * Ambient declaration for the bundled claude-code prompt files.
 *
 * `ferry-cc-prompt` imports the four `prompts/*.claude-code.md` defaults so
 * esbuild's `text` loader inlines them into the published bundle (the npm
 * package ships only `dist/cli/`, never `prompts/`). `tsc` resolves these
 * imports to this declaration and never reads the `.md` files themselves.
 */
declare module '*.claude-code.md' {
  const content: string;
  export default content;
}
