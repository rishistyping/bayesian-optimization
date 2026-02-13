import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const publicDir = path.join(rootDir, "public");

const errors = [];

function fail(message) {
  errors.push(message);
}

function isExternalRef(ref) {
  return (
    ref.startsWith("http://") ||
    ref.startsWith("https://") ||
    ref.startsWith("//") ||
    ref.startsWith("data:") ||
    ref.startsWith("mailto:") ||
    ref.startsWith("#")
  );
}

function normalizeRef(ref) {
  return ref.trim();
}

function resolveRef(ref, baseFilePath) {
  if (ref.startsWith("/")) {
    return path.resolve(publicDir, ref.slice(1));
  }
  return path.resolve(path.dirname(baseFilePath), ref);
}

function withinPublic(absPath) {
  const normalizedPublic = path.resolve(publicDir);
  const normalizedPath = path.resolve(absPath);
  return (
    normalizedPath === normalizedPublic || normalizedPath.startsWith(normalizedPublic + path.sep)
  );
}

function stripTags(input) {
  return input
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function checkRuntimeRefs(html, htmlPath) {
  const refs = [];
  const scriptRe = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  const linkRe = /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;

  let match;
  while ((match = scriptRe.exec(html)) !== null) {
    refs.push({ kind: "script", ref: normalizeRef(match[1]) });
  }
  while ((match = linkRe.exec(html)) !== null) {
    refs.push({ kind: "link", ref: normalizeRef(match[1]) });
  }

  refs.forEach(({ kind, ref }) => {
    if (!ref || isExternalRef(ref)) {
      return;
    }

    if (/^(?:\.\/)?(references|prompts|notes|tools)\//.test(ref)) {
      fail(`[runtime-ref] ${kind} points to internal artifact path: ${ref}`);
      return;
    }

    const target = resolveRef(ref, htmlPath);
    if (!withinPublic(target)) {
      fail(`[runtime-ref] ${kind} resolves outside public/: ${ref}`);
      return;
    }

    if (!fs.existsSync(target)) {
      fail(`[runtime-ref] missing ${kind} target: ${ref}`);
    }
  });
}

function checkDuplicateIds(html) {
  const idRe = /\bid\s*=\s*["']([^"']+)["']/gi;
  const counts = new Map();
  let match;
  while ((match = idRe.exec(html)) !== null) {
    const id = match[1];
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  for (const [id, count] of counts.entries()) {
    if (count > 1) {
      fail(`[a11y] duplicate id="${id}" (${count}x)`);
    }
  }
}

function extractButtonById(html, id) {
  const re = new RegExp(`<button\\b([^>]*)\\bid=["']${id}["']([^>]*)>([\\s\\S]*?)<\\/button>`, "i");
  const match = html.match(re);
  if (!match) {
    return null;
  }
  return {
    attrs: `${match[1]} ${match[2]}`,
    inner: match[3],
  };
}

function checkKeyControls(html) {
  const requiredButtonIds = [
    "replay-play",
    "replay-prev",
    "replay-next",
    "theme-toggle",
    "cp-sim-start",
    "cp-sim-stop",
  ];

  requiredButtonIds.forEach((id) => {
    const button = extractButtonById(html, id);
    if (!button) {
      fail(`[a11y] missing key button id="${id}"`);
      return;
    }
    const hasAriaLabel = /\baria-label\s*=\s*["'][^"']+\S[^"']*["']/i.test(button.attrs);
    const text = stripTags(button.inner);
    if (!hasAriaLabel && !text) {
      fail(`[a11y] button "${id}" lacks both aria-label and visible text`);
    }
  });
}

function checkTabIndex(html) {
  const tabindexRe = /\btabindex\s*=\s*["']\s*([+-]?\d+)\s*["']/gi;
  let match;
  while ((match = tabindexRe.exec(html)) !== null) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) {
      fail(`[a11y] positive tabindex found (${value}); use natural flow or 0/-1 only`);
    }
  }
}

function walk(dirPath, onFile) {
  for (const name of fs.readdirSync(dirPath)) {
    const full = path.join(dirPath, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walk(full, onFile);
    } else {
      onFile(full);
    }
  }
}

function checkPublicBoundary() {
  const forbiddenExtensions = new Set([
    ".zip",
    ".7z",
    ".rar",
    ".tar",
    ".tgz",
    ".gz",
    ".bz2",
    ".xz",
    ".har",
    ".heic",
    ".heif",
    ".psd",
    ".ai",
    ".sketch",
  ]);

  walk(publicDir, (filePath) => {
    const relative = path.relative(publicDir, filePath).replaceAll(path.sep, "/");
    const extension = path.extname(filePath).toLowerCase();
    const segments = relative.split("/");

    if (
      segments.includes("references") ||
      segments.includes("prompts") ||
      segments.includes("notes") ||
      segments.includes("tools")
    ) {
      fail(`[publish-boundary] internal folder found under public/: ${relative}`);
    }

    if (forbiddenExtensions.has(extension)) {
      fail(`[publish-boundary] forbidden artifact type in public/: ${relative}`);
    }
  });
}

function collectHtmlFiles(dirPath) {
  const htmlFiles = [];
  walk(dirPath, (filePath) => {
    if (path.extname(filePath).toLowerCase() === ".html") {
      htmlFiles.push(filePath);
    }
  });
  return htmlFiles;
}

function main() {
  if (!fs.existsSync(publicDir)) {
    fail("[sanity] missing public/ directory");
  }

  if (fs.existsSync(publicDir)) {
    const htmlFiles = collectHtmlFiles(publicDir);
    if (!htmlFiles.length) {
      fail("[sanity] no HTML files found under public/");
    }
    htmlFiles.forEach((htmlPath) => {
      const html = fs.readFileSync(htmlPath, "utf8");
      checkRuntimeRefs(html, htmlPath);
      checkDuplicateIds(html);
      checkTabIndex(html);
      if (path.basename(htmlPath) === "index.html") {
        checkKeyControls(html);
      }
    });
  }

  if (fs.existsSync(publicDir)) {
    checkPublicBoundary();
  }

  if (errors.length) {
    console.error(`Sanity check failed with ${errors.length} issue(s):`);
    errors.forEach((message) => {
      console.error(`- ${message}`);
    });
    process.exit(1);
  }

  console.log("Sanity check passed.");
}

main();
