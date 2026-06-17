import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 8020,
    strictPort: true,
    watch: {
      ignored: ["**/.tumblr-runner-profile/**", "**/tmp-runner-inspect-profile/**", "**/tumblr-runner-plan.json"],
    },
  },
});
