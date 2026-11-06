import sonarjs from 'eslint-plugin-sonarjs';

export default [{
  files: ['src/**/*.mjs', 'bin/**/*.mjs', '.claude/hooks/*.mjs'],
  plugins: { sonarjs },
  rules: { 'sonarjs/cognitive-complexity': ['error', 15] },
}];
