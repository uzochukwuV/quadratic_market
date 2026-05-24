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
        "midnight-canvas": "#000000",
        "frost-white": "#ffffff",
        "deep-shadow": "#181818",
        "whisper-gray": "#6d6d6d",
        "misty-gray": "#636363",
      },
      fontFamily: {
        roobert: ["'Roobert'", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
        raleway: ["'Raleway'", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        pill: "75.024px",
        card: "10px",
      },
      maxWidth: {
        content: "1078px",
      },
      backgroundImage: {
        "deep-ocean": "linear-gradient(90deg, rgb(160, 224, 171), rgb(255, 172, 46) 50%, rgb(165, 45, 37))",
        "deep-ocean-diagonal": "linear-gradient(135deg, rgb(160, 224, 171) 0%, rgb(255, 172, 46) 50%, rgb(165, 45, 37) 100%)",
      },
      animation: {
        "gradient-shift": "gradient-shift 8s ease-in-out infinite",
        "float": "float 6s ease-in-out infinite",
        "pulse-slow": "pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      keyframes: {
        "gradient-shift": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        "float": {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-20px)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
