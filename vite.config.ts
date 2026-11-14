// lets `npm run dev` answer /api/coach the same way vercel will
import { defineConfig, loadEnv } from "vite";
import handler from "./api/coach.ts";

export default defineConfig(({ mode }) => {
  // load .env.local (including GEMINI_API_KEY) into the server only
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  return {
    plugins: [
      {
        name: "api-coach",
        configureServer(server) {
          server.middlewares.use("/api/coach", (req, res) => handler(req, res));
        },
      },
    ],
  };
});