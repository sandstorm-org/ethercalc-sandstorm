#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");
const LiveScript = require("livescript");

const root = path.resolve(__dirname, "..");

function livescriptPlugin() {
  return {
    name: "livescript",
    setup(build) {
      build.onLoad({ filter: /\.ls$/ }, async (args) => {
        try {
          const source = await fs.promises.readFile(args.path, "utf8");
          const contents = LiveScript.compile(source, {
            bare: true,
            filename: path.relative(root, args.path),
          });

          return {
            contents,
            loader: "js",
            resolveDir: path.dirname(args.path),
          };
        } catch (err) {
          return {
            errors: [{
              text: err.message,
              location: err.location && {
                file: args.path,
                line: err.location.first_line + 1,
                column: err.location.first_column,
              },
            }],
          };
        }
      });
    },
  };
}

esbuild.build({
  entryPoints: [path.join(root, "src", "app.ls")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: path.join(root, "dist", "app.js"),
  sourcemap: true,
  external: ["hiredis"],
  resolveExtensions: [".js", ".ls", ".json"],
  plugins: [livescriptPlugin()],
  logLevel: "warning",
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
