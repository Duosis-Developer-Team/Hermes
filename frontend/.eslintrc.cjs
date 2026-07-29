/**
 * =============================================================================
 * HERMES - ESLint yapilandirmasi (Sprint 1, CTO paketi)
 * =============================================================================
 * Ilke (Sprint 1 §3): lint GERCEK kalite kapisidir — `npm run lint`
 * --max-warnings 0 ile kosar ve YESIL kalmak zorundadir. Bunu mumkun
 * kilmak icin kurallar iki sinifta ele alindi:
 *
 *   1. Aktif kurallar: bugunku kod tabaninin 0 ihlalle gectigi ya da
 *      Sprint 1'de temizlenen kurallar. Bunlar "error"dur.
 *   2. Borc kurallari (asagida "SPRINT DEBT" blogu): mevcut kodda yaygin
 *      ihlali olan, toplu-formatlama yapmadan kapatilamayacak kurallar.
 *      Kapali degil "off"; sayilari docs/frontend-premiumization/
 *      lint-debt.md'de kayitli ve her sprintte AZALMak zorunda —
 *      kural geri acilarak ratchet edilir.
 *
 * eslint-disable politikasi: satir-ici disable yalnizca yorumla
 * gerekcelendirilirse kabul edilir; sayisi lint-debt.md'de izlenir.
 * =============================================================================
 */
module.exports = {
    root: true,
    env: { browser: true, es2022: true, node: true },
    extends: [
        'eslint:recommended',
        'plugin:react/recommended',
        'plugin:react/jsx-runtime',
        'plugin:react-hooks/recommended',
    ],
    ignorePatterns: ['dist', 'coverage', 'node_modules', '.eslintrc.cjs'],
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    settings: { react: { version: '18.2' } },
    plugins: ['react-refresh'],
    rules: {
        // Gercek hatalar — aktif kapi.
        'no-unused-vars': ['error', {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            ignoreRestSiblings: true,
        }],
        'react-refresh/only-export-components': [
            'warn', { allowConstantExport: true },
        ],
        // ---------------------------------------------------------------------
        // SPRINT DEBT (lint-debt.md'de sayimli; her sprint ratchet edilir)
        // ---------------------------------------------------------------------
        // AntD + mevcut kod deseni: prop-types kullanilmiyor (TS'e gecis
        // ayri karar). Acilirsa ~yuzlerce ihlal — Sprint 2+ karari.
        'react/prop-types': 'off',
        // Mevcut kodda tirnak icinde apostrof kullanimi yaygin (Turkce
        // metinler). JSX metin kacisi toplu-format churn'u uretir.
        'react/no-unescaped-entities': 'off',
    },
    overrides: [
        {
            files: ['**/*.test.js', '**/*.test.jsx', 'src/test/**'],
            env: { node: true },
            globals: {
                describe: 'readonly', it: 'readonly', expect: 'readonly',
                beforeEach: 'readonly', afterEach: 'readonly',
                vi: 'readonly', beforeAll: 'readonly', afterAll: 'readonly',
            },
        },
        {
            files: ['scripts/**'],
            env: { node: true },
        },
    ],
}
