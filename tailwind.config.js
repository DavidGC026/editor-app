/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Forge palette
        'forge-bg': '#323643',          // Main background
        'forge-titlebar': '#2A2D38',    // Title bar (slightly darker)
        'forge-activitybar': '#2A2D38', // Activity bar
        'forge-sidebar': '#24282E',     // Sidebar
        'forge-tabbar': '#27272F',      // Tab bar (inactive tabs)
        'forge-tab-active': '#2D2F38',  // Active tab + editor bg
        'forge-editor': '#2D2F38',      // Editor bg
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
        'forge-accent':     '#4ADB94',  // Accent / highlight
      },
    },
  },
  plugins: [],
};
