/** Unfold — Tailwind preset. Colours read the CSS variables in tokens.css, so the dark theme
 *  ([data-theme="dark"]) works without dark: variants. Usage: presets: [require('./design-system/tailwind.preset.js')] */
module.exports = {
  theme: {
    extend: {
      colors: {
        surface: { DEFAULT: 'var(--surface)', raised: 'var(--surface-raised)', sunken: 'var(--surface-sunken)' },
        line: 'var(--line)',
        ink: { DEFAULT: 'var(--ink)', muted: 'var(--ink-muted)' },
        fold: { DEFAULT: 'var(--fold)', ink: 'var(--fold-ink)', on: 'var(--on-fold)' },
        laser: 'var(--laser)',
        depth: 'var(--depth)',
        focus: 'var(--focus-ring)',
      },
      fontFamily: { sans: ['Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'], mono: ['Geist Mono', 'ui-monospace', 'Menlo', 'monospace'] },
      fontSize: {
        'display-xl': ['clamp(56px, 7.4vw, 112px)', { lineHeight: '0.92', letterSpacing: '-0.045em', fontWeight: '600' }],
        display: ['clamp(36px, 4vw, 56px)', { lineHeight: '1.02', letterSpacing: '-0.035em', fontWeight: '600' }],
        title: ['22px', { lineHeight: '28px', letterSpacing: '-0.01em', fontWeight: '600' }],
        lead: ['20px', { lineHeight: '30px' }],
        body: ['16px', { lineHeight: '24px' }],
        small: ['14px', { lineHeight: '20px' }],
        label: ['12px', { lineHeight: '16px' }],
        data: ['13px', { lineHeight: '20px' }],
      },
      borderRadius: { sm: '4px', md: '8px', lg: '12px' },
      spacing: { joint: '8px' },
    },
  },
};
