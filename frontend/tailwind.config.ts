import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "rich-black": "#0a0a0a",
        "graphite": "#27272a",
        "ash-gray": "#3b3b3b",
        "silver-text": "#9d9d9d",
        "off-white": "#cecece",
        "frost-white": "#ffffff",
        "true-black": "#000000",
        "dark-granite": "#18181b",
        "cadmium-green": "#faff00",
        // Legacy names
        "midnight-canvas": "#0a0a0a",
        "deep-shadow": "#18181b",
        "whisper-gray": "#9d9d9d",
      },
      fontFamily: {
        outfit: ["Outfit", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        // Legacy names
        roobert: ["Outfit", "ui-sans-serif", "system-ui", "sans-serif"],
        raleway: ["Outfit", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      fontSize: {
        caption: ["10px", { lineHeight: "1.43" }],
        body: ["14px", { lineHeight: "1.43" }],
        subheading: ["18px", { lineHeight: "1.29" }],
        heading: ["24px", { lineHeight: "1.17" }],
        display: ["28px", { lineHeight: "1.33" }],
      },
      spacing: {
        "8": "8px",
        "16": "16px",
        "24": "24px",
        "32": "32px",
        "40": "40px",
        "48": "48px",
      },
      borderRadius: {
        "md": "6px",
        "xl": "12px",
        "full": "9999px",
        "pill": "9999px",
        "card": "12px",
      },
      maxWidth: {
        content: "1200px",
      },
      boxShadow: {
        subtle: "rgba(0, 0, 0, 0.05) 0px 1px 2px 0px",
        "subtle-2": "rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, rgba(0, 0, 0, 0.1) 0px 1px 2px -1px",
        glow: "0 0 20px rgba(250, 255, 0, 0.15)",
      },
    },
  },
  plugins: [],
};

export default config;
