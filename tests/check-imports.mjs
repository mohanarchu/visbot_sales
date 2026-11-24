// Every named import in the admin panel's modules must exist in the module it
// comes from. The panel has no build step, so a typo would only show up as a
// blank page in the browser; this catches it in a second from the terminal.
//
//   node tests/check-imports.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "admin-app", "js");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return name.endsWith(".js") ? [full] : [];
  });
}

// What a module sends out: named exports, including `export const a, b`.
function exportsOf(file) {
  const src = readFileSync(file, "utf8");
  const names = new Set();
  const add = (s) => s.split(",").forEach((part) => {
    const name = part.trim().split(/\s+as\s+/).pop().trim();
    if (name) names.add(name);
  });

  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm)) add(m[1]);
  for (const m of src.matchAll(/^export\s+class\s+([A-Za-z0-9_$]+)/gm)) add(m[1]);
  for (const m of src.matchAll(/^export\s+(?:const|let|var)\s+([^=;]+)=/gm)) {
    // `export const a = 1` and `export const { a, b } = x`
    add(m[1].replace(/[{}]/g, ""));
  }
  for (const m of src.matchAll(/^export\s*\{([^}]+)\}/gm)) add(m[1]);
  return names;
}

const files = walk(ROOT);
const exportCache = new Map();
const exportsFor = (file) => {
  if (!exportCache.has(file)) exportCache.set(file, exportsOf(file));
  return exportCache.get(file);
};

let imports = 0;
const problems = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/^import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/gm)) {
    const target = resolve(dirname(file), m[2]);
    let available;
    try {
      available = exportsFor(target);
    } catch {
      problems.push(`${file}: cannot read ${m[2]}`);
      continue;
    }
    for (const raw of m[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (!name) continue;
      imports++;
      if (!available.has(name)) {
        problems.push(`${file.replace(ROOT, "admin-app/js")}: "${name}" is not exported by ${m[2]}`);
      }
    }
  }
}

for (const p of problems) console.log("  " + p);
console.log(`${files.length} modules, ${imports} named imports, ${problems.length} problems`);
process.exit(problems.length ? 1 : 0);
