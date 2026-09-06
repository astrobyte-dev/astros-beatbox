import { createRoot } from "react-dom/client";
import "@fontsource/outfit/latin-500.css";
import "@fontsource/outfit/latin-600.css";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "./style.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
