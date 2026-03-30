import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#0f1117",
        panel: "#1a1d27",
        border: "#2a2d3a",
        accent: "#6366f1",
        "accent-hover": "#818cf8",
        anomaly: "#ef4444",
        warn: "#f97316",
        success: "#22c55e",
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
