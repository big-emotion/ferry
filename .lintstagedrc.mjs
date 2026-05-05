export default {
  'src/**/*.ts': ['prettier --write', 'eslint --max-warnings=0'],
  'prompts/**/*.md': ['prettier --write'],
  'docs/**/*.md': ['prettier --write'],
  '*.{md,json,yml,yaml}': (files) => {
    const filtered = files.filter((f) => !f.includes('/.ferry/'));
    if (filtered.length === 0) return [];
    return [`prettier --write ${filtered.map((f) => `"${f}"`).join(' ')}`];
  },
};
