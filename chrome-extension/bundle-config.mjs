// @ts-check
import { readFileSync } from "fs";
import { join } from "path";
import { rm, rmdir } from "fs/promises";
import * as esbuild from "esbuild";
import { copy } from "esbuild-plugin-copy";
import { parse } from "dotenv";

const isWatching = process.argv.includes("--watch");
if (isWatching) {
	console.log("--watch is provided. Files will be watched.");
}

/**
 * @type {{[key: string]: string}}
 */
let definedValues = {};

try {
	const envFile = readFileSync("./.env");
	definedValues = Object.fromEntries(
		Object.entries(parse(envFile)).map(([key, value]) => {
			return ["process.env.".concat(key), `"${value}"`];
		})
	);
} catch (_e) {}

/**
 * @type {import("esbuild").BuildOptions}
 */
const esbuildOptions = {
	entryPoints: ["src/index.tsx", "src/background.js"],
	minify: false,
	outdir: "build",
	bundle: true,
	loader: { ".svg": "dataurl" },
	platform: "browser",
	define: definedValues,
	plugins: [
		copy({
			resolveFrom: "cwd",
			assets: {
				from: "./public/**/*",
				to: ["./build"],
			},
			watch: isWatching,
		}),
	],
};

const prebuildScript = "./src/prebuild.tsx";

/**
 * @type {import("esbuild").BuildOptions}
 */
const prebuildOptions = {
	entryPoints: [prebuildScript],
	entryNames: "[dir]/[name]-[hash]",
	outdir: "build",
	bundle: true,
	jsx: "transform",
	jsxFactory: "React.createElement",
	platform: "node",
	sourcemap: "inline",
	minify: false,
	metafile: true,
	define: definedValues,
	plugins: [
		{
			name: "run-prebuild-script",
			setup(build) {
				build.onStart(async () => {
					console.log("Building", prebuildScript);
					try {
						await rm("./build/static", {
							recursive: true,
						});
					} catch (_e) {
						console.log(_e);
					}
				});
				build.onEnd(async (result) => {
					if (result.metafile == undefined) {
						throw new Error("`metafile` option is set to false.");
					}

					const prebuildOutputScript = "./"
						.concat(
							Object.keys(result.metafile.outputs).find((key) => {
								return key.includes("prebuild") && key.includes(".js");
							}) || ""
						)
						.replace("\\", "/");
					console.log(prebuildOutputScript);

					if (prebuildOutputScript == "./") {
						throw new Error("Prebuild script is not found");
					}

					console.log("Building", prebuildScript, "done");
					if (result.warnings.length > 0) {
						result.warnings.forEach((warning) => {
							console.warn(warning);
						});
					}
					if (result.errors.length > 0) {
						result.errors.forEach((error) => {
							console.error(error);
						});
					}

					console.log("Generating prebuilt html");

					try {
						const mod = await import(prebuildOutputScript);
						await mod.run();
					} catch (err) {
						console.error(err);
					}
					console.log("Generating prebuilt html done");
				});
			},
		},
	],
};

(async () => {
	if (isWatching) {
		const ctx = await esbuild.context(esbuildOptions);
		const prebuildCtx = await esbuild.context(prebuildOptions);

		await ctx.watch();
		await prebuildCtx.watch();
		console.log("Watching...");

		process.on("SIGKILL", () => {
			ctx.dispose();
			prebuildCtx.dispose();
			console.log("Stopped watching");
		});
	} else {
		await esbuild.build(esbuildOptions);
		await esbuild.build(prebuildOptions);
	}
})();