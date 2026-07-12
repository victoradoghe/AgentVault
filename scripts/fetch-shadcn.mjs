import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const COMPONENTS = [
  "button",
  "input",
  "card",
  "dialog",
  "dropdown-menu",
  "sonner",
  "badge",
  "table",
  "tabs",
  "textarea",
  "label",
  "select",
  "skeleton",
];

const BASE = "https://ui.shadcn.com/r/styles/default";
const ROOT = process.cwd();
const deps = new Set();

for (const name of COMPONENTS) {
  const url = `${BASE}/${name}.json`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`FAILED ${name}: ${res.status}`);
    process.exit(1);
  }
  const json = await res.json();
  (json.dependencies ?? []).forEach((d) => deps.add(d));
  for (const file of json.files) {
    // file.path looks like "ui/button.tsx" -> write to src/components/ui/button.tsx
    const dest = join(ROOT, "src", "components", file.path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, file.content, "utf8");
    console.log(`wrote src/components/${file.path}`);
  }
}

console.log("\nNPM_DEPS " + [...deps].sort().join(" "));
