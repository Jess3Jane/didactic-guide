import { defineConfig } from "vite";

// Project-pages hosting serves from the repo subpath (https://<user>.github.io/didactic-guide/).
// Allow an override via BASE_PATH for flexibility in other environments.
const base = process.env.BASE_PATH ?? "/didactic-guide/";

export default defineConfig({
  base,
  test: {
    globals: true,
    environment: "node",
  },
});
