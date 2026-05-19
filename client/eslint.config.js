import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import importPlugin from 'eslint-plugin-import'
import n from 'eslint-plugin-n'
import promise from 'eslint-plugin-promise'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

const tsconfigRootDir = dirname(fileURLToPath(import.meta.url))

const standardStylisticRules = {
  '@stylistic/array-bracket-spacing': ['error', 'never'],
  '@stylistic/arrow-parens': ['error', 'always'],
  '@stylistic/block-spacing': ['error', 'always'],
  '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
  '@stylistic/comma-dangle': ['error', 'never'],
  '@stylistic/comma-spacing': ['error', { before: false, after: true }],
  '@stylistic/eol-last': ['error', 'always'],
  '@stylistic/indent': ['error', 2, { SwitchCase: 1 }],
  '@stylistic/key-spacing': ['error', { beforeColon: false, afterColon: true }],
  '@stylistic/keyword-spacing': ['error', { before: true, after: true }],
  '@stylistic/member-delimiter-style': [
    'error',
    {
      multiline: { delimiter: 'none', requireLast: false },
      singleline: { delimiter: 'comma', requireLast: false }
    }
  ],
  '@stylistic/no-multiple-empty-lines': ['error', { max: 1, maxEOF: 0 }],
  '@stylistic/no-trailing-spaces': 'error',
  '@stylistic/object-curly-spacing': ['error', 'always'],
  '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
  '@stylistic/semi': ['error', 'never'],
  '@stylistic/space-before-blocks': ['error', 'always'],
  '@stylistic/space-infix-ops': 'error'
}

const standardRules = {
  ...standardStylisticRules,
  '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
  '@typescript-eslint/no-unused-vars': [
    'error',
    {
      argsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
      destructuredArrayIgnorePattern: '^_',
      varsIgnorePattern: '^_'
    }
  ],
  'func-style': ['error', 'expression', { allowArrowFunctions: true }],
  'no-unused-vars': 'off',
  'no-var': 'error',
  'object-shorthand': 'error',
  'prefer-arrow-callback': ['error', { allowNamedFunctions: false, allowUnboundThis: true }],
  'prefer-const': 'error'
}

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src/**/*.d.ts',
      '*.tsbuildinfo'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: {
        ...globals.browser,
        ...globals.node
      },
      parserOptions: {
        tsconfigRootDir
      },
      parser: tseslint.parser,
      sourceType: 'module'
    }
  },
  {
    files: ['src/**/*.vue'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.browser,
      parser: vueParser,
      parserOptions: {
        ecmaVersion: 'latest',
        extraFileExtensions: ['.vue'],
        parser: tseslint.parser,
        tsconfigRootDir,
        sourceType: 'module'
      },
      sourceType: 'module'
    },
    rules: {
      'vue/one-component-per-file': 'off',
      'vue/multi-word-component-names': 'off'
    }
  },
  {
    files: ['src/**/*.{ts,vue}', 'tests/**/*.ts'],
    plugins: {
      '@stylistic': stylistic,
      import: importPlugin,
      n,
      promise
    },
    rules: standardRules,
    settings: {
      'import/resolver': {
        typescript: {
          project: './tsconfig.json'
        }
      }
    }
  }
)
