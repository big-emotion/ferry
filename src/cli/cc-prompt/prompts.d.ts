/** Ambient declaration for bundled direct-action prompt files. */
declare module '*.claude-code.md' {
  const content: string;
  export default content;
}

declare module '*.codex-cli.md' {
  const content: string;
  export default content;
}
