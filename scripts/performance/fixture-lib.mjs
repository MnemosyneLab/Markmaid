import {
  createHash,
} from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readlinkSync,
  readdirSync,
} from "node:fs";
import { relative, sep } from "node:path";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashDirectory(root) {
  const records = [];
  walk(root, root, records);
  return sha256(records.join("\n"));
}

function walk(root, current, records) {
  for (const name of readdirSync(current).sort()) {
    const path = `${current}${sep}${name}`;
    const relativePath = relative(root, path).split(sep).join("/");
    const stat = lstatSync(path);
    if (stat.isDirectory()) {
      records.push(`d\0${relativePath}`);
      walk(root, path, records);
    } else if (stat.isSymbolicLink()) {
      records.push(`l\0${relativePath}\0${readlinkSync(path)}`);
    } else {
      records.push(
        `f\0${relativePath}\0${stat.size}\0${sha256(readFileSync(path))}`,
      );
    }
  }
}
