import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', 'public/js/vendor/**', 'public/js/template.v2.js']
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.es2021,
        module: 'readonly'
      }
    },
    rules: {
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-redeclare': 'error'
    }
  },
  {
    files: ['tools/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-redeclare': 'error'
    }
  }
];
