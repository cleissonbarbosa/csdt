import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['samples/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
);
