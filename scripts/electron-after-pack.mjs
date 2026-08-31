import { existsSync, rmSync } from "node:fs";
import path from "node:path";

function remove(target) {
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
}

export default async function pruneOnnxRuntimePlatforms(context) {
  const resources = context.electronPlatformName === "darwin"
    ? path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      "Contents",
      "Resources",
    )
    : path.join(context.appOutDir, "resources");
  const runtimeRoot = path.join(
    resources,
    "app.asar.unpacked",
    "node_modules",
    "onnxruntime-node",
    "bin",
    "napi-v6",
  );
  if (!existsSync(runtimeRoot)) return;

  if (context.electronPlatformName === "darwin") {
    remove(path.join(runtimeRoot, "linux"));
    remove(path.join(runtimeRoot, "win32"));
    remove(path.join(runtimeRoot, "darwin", "x64"));
    // The native binding links to libonnxruntime.1.dylib; the full-version duplicate is not needed.
    remove(path.join(runtimeRoot, "darwin", "arm64", "libonnxruntime.1.29.0.dylib"));
  } else if (context.electronPlatformName === "win32") {
    remove(path.join(runtimeRoot, "linux"));
    remove(path.join(runtimeRoot, "darwin"));
    remove(path.join(runtimeRoot, "win32", "arm64"));
  } else if (context.electronPlatformName === "linux") {
    remove(path.join(runtimeRoot, "darwin"));
    remove(path.join(runtimeRoot, "win32"));
  }
}
