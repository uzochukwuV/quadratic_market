// Polyfills must come first — @solana/* packages need Buffer and global
import "@/polyfills";

import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Force dark mode — this is a dark-only Telegram Mini App
document.documentElement.classList.add("dark");

createRoot(document.getElementById("root")!).render(<App />);
