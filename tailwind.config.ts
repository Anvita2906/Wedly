import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
    "./store/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: "#FAF7F2",
        ink: "#1C1A17",
        "ink-soft": "#3D3A34",
        "ink-muted": "#7A7568",
        "ink-faint": "#B8B2A7",
        gold: "#C9A84C",
        "gold-light": "#F5EDDA",
        "gold-pale": "#FBF7ED",
        rose: "#C27C6E",
        "rose-light": "#F7EAE7",
        teal: "#3D8B7A",
        "teal-light": "#E8F4F1",
        border: "#E8E2D9",
        "border-soft": "#F0EBE3",
        sidebar: "#1C1A17",
        "sidebar-hover": "#2A2721",
        "sidebar-active": "#2E2922",
        danger: "#C0392B",
        "danger-light": "#FCEAE8",
        warn: "#B8860B",
        "warn-light": "#FEF9EC",
        success: "#2E7D52",
        "success-light": "#E8F5EE",
      },
      fontFamily: {
        display: ["Cormorant Garamond", "serif"],
        sans: ["DM Sans", "sans-serif"],
      },
    },
  },
};

export default config;
