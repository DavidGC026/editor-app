/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Forge palette
        'forge-bg': '#302F36',          // Main warm graphite background
        'forge-titlebar': '#282A32',    // Title bar (slightly darker)
        'forge-activitybar': '#282A32', // Activity bar
        'forge-sidebar': '#23262D',     // Sidebar
        'forge-tabbar': '#26272F',      // Tab bar (inactive tabs)
        'forge-tab-active': '#2B2D35',  // Active tab + editor bg
        'forge-editor': '#2B2D35',      // Editor bg
        'forge-statusbar': '#2F323F',   // Status bar
        'forge-terminal': '#1F2025',    // Terminal bg
        'forge-border': '#3A3F4B',      // Borders
        'forge-input': '#1F2025',       // Input bg

        // Text colors
        'forge-text':       '#D0D3DA',  // Inactive text/icons
        'forge-text-strong':'#FFFFFF',  // Hover/selected
        'forge-text-dim':   '#A1A3AF',  // Status bar text
        'forge-text-tab':   '#96969D',  // Inactive tab text
        'forge-text-term':  '#B1B4BC',  // Terminal text
        'forge-text-menu':  '#D3D5DE',  // Dropdown unselected
        'forge-accent':     '#E52E3D',  // Vibrant Red accent / highlight
      },
    },
  },
  plugins: [],
};
