import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [
    {
      name: "web-native-boundary",
      moduleParsed(module) {
        const path = module.id.replaceAll("\\", "/");
        if (
          /\/node_modules\/(?:react-native(?:\/|$)|@react-native\/|expo(?:[-/]|$))/.test(
            path,
          ) ||
          path.includes("/modules/better-google-auth/")
        ) {
          this.error(
            "Native runtime modules must not enter the web app. Use a browser adapter.",
          );
        }
      },
    },
  ],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        redirect: fileURLToPath(new URL("./redirect.html", import.meta.url)),
      },
    },
  },
});
