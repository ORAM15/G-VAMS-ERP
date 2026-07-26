/**
 * Repository structure, entry points, monorepo detection, and architectural pattern detection.
 *
 * All directory-pattern detectors here (Clean/Hexagonal, MVC, feature-based, monorepo conventions) work off
 * one cheap, derived Set<string> of every directory path implied by the files this analyzer already walked
 * (no extra filesystem traversal) -- generic, works at any depth, not hardcoded to any particular repository
 * layout.
 */

import type { WalkedFile } from "./walk";
import { readFileSafe } from "./walk";
import type { Detection, RepositoryStructureEntry } from "./types";

function basename(relPath: string): string {
  return relPath.split("/").pop() ?? relPath;
}

function classifyRole(name: string): RepositoryStructureEntry["role"] {
  const lower = name.toLowerCase();
  if (["src", "lib", "app", "source", "cmd", "internal", "pkg"].includes(lower)) return "source";
  if (["test", "tests", "__tests__", "spec", "specs", "e2e"].includes(lower)) return "tests";
  if (["docs", "doc", "documentation"].includes(lower)) return "docs";
  if (["scripts", "tools"].includes(lower)) return "scripts";
  if ([".github", ".circleci", ".gitlab"].includes(lower)) return "ci";
  if (["infra", "infrastructure", "terraform", "k8s", "kubernetes", "helm", "deploy", "deployment", "ansible"].includes(lower)) return "infrastructure";
  if (["config", "configs", "conf"].includes(lower)) return "config";
  if (["packages", "apps", "services", "modules"].includes(lower)) return "package";
  return "unknown";
}

/** Top-level directories plus one level deeper -- generic, not tied to any fixed set of expected directory names. */
export function detectRepositoryStructure(root: string, dirs: ReadonlySet<string>): RepositoryStructureEntry[] {
  const entries: RepositoryStructureEntry[] = [];
  for (const dir of dirs) {
    if (dir.split("/").length > 2) continue; // top-level + one level deep only
    entries.push({ path: dir, role: classifyRole(basename(dir)) });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

/** Derives every directory path implied by a walked file list -- no extra filesystem access. */
export function deriveDirectorySet(files: ReadonlyArray<WalkedFile>): Set<string> {
  const dirs = new Set<string>();
  for (const file of files) {
    const parts = file.relPath.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }
  return dirs;
}

const CONVENTIONAL_ENTRY_POINTS = [
  "index.ts",
  "index.js",
  "src/index.ts",
  "src/index.js",
  "main.py",
  "manage.py",
  "app.py",
  "wsgi.py",
  "asgi.py",
  "main.go",
];

export function detectEntryPoints(files: ReadonlyArray<WalkedFile>): Detection<string>[] {
  const detections: Detection<string>[] = [];

  for (const file of files) {
    if (basename(file.relPath) !== "package.json" || file.relPath.includes("node_modules/")) continue;
    const content = readFileSafe(file.absPath);
    if (content === null) continue;
    let pkg: { main?: string; module?: string; bin?: string | Record<string, string> };
    try {
      pkg = JSON.parse(content);
    } catch {
      continue;
    }
    if (typeof pkg.main === "string") {
      detections.push({ value: pkg.main, confidence: "High", evidence: [`"main" field in ${file.relPath}`], sourceFiles: [file.relPath] });
    }
    if (typeof pkg.module === "string") {
      detections.push({ value: pkg.module, confidence: "High", evidence: [`"module" field in ${file.relPath}`], sourceFiles: [file.relPath] });
    }
    if (typeof pkg.bin === "string") {
      detections.push({ value: pkg.bin, confidence: "High", evidence: [`"bin" field in ${file.relPath}`], sourceFiles: [file.relPath] });
    } else if (pkg.bin && typeof pkg.bin === "object") {
      for (const value of Object.values(pkg.bin)) {
        detections.push({ value, confidence: "High", evidence: [`"bin" field in ${file.relPath}`], sourceFiles: [file.relPath] });
      }
    }
  }

  const relPaths = new Set(files.map((f) => f.relPath));
  for (const candidate of CONVENTIONAL_ENTRY_POINTS) {
    if (relPaths.has(candidate)) {
      detections.push({ value: candidate, confidence: "Medium", evidence: ["conventional entry point filename"], sourceFiles: [candidate] });
    }
  }

  return detections;
}

export function detectMonorepo(files: ReadonlyArray<WalkedFile>): Detection<boolean> {
  const evidence: string[] = [];
  const sourceFiles: string[] = [];
  let hasWorkspacesField = false;

  const rootPkg = files.find((f) => f.relPath === "package.json");
  if (rootPkg) {
    const content = readFileSafe(rootPkg.absPath);
    if (content !== null) {
      try {
        const pkg = JSON.parse(content) as { workspaces?: unknown };
        if (pkg.workspaces) {
          hasWorkspacesField = true;
          evidence.push('root package.json "workspaces" field');
          sourceFiles.push("package.json");
        }
      } catch {
        // Malformed package.json -- no evidence from it, not a guess.
      }
    }
  }

  const toolConfigs: ReadonlyArray<[string, string]> = [
    ["pnpm-workspace.yaml", "pnpm-workspace.yaml present"],
    ["lerna.json", "lerna.json present"],
    ["nx.json", "Nx (nx.json) present"],
    ["turbo.json", "Turborepo (turbo.json) present"],
  ];
  let hasToolConfig = false;
  for (const [fileName, description] of toolConfigs) {
    if (files.some((f) => f.relPath === fileName)) {
      hasToolConfig = true;
      evidence.push(description);
      sourceFiles.push(fileName);
    }
  }

  const additionalPackageJsonCount = files.filter((f) => f.relPath.endsWith("package.json") && f.relPath !== "package.json").length;
  if (additionalPackageJsonCount > 0) {
    evidence.push(`${additionalPackageJsonCount} additional package.json file(s) found under the repository`);
  }

  const isMonorepo = (hasWorkspacesField || hasToolConfig) && additionalPackageJsonCount >= 1;
  if (!isMonorepo) {
    return { value: false, confidence: "Low", evidence: [], sourceFiles: [] };
  }
  return {
    value: true,
    confidence: hasWorkspacesField && additionalPackageJsonCount >= 2 ? "High" : "Medium",
    evidence,
    sourceFiles,
  };
}

function siblingGroup(dirs: ReadonlySet<string>, anchorSuffix: string, siblingNames: string[], minMatches: number): { matched: string[]; parent: string } | null {
  for (const dir of dirs) {
    const dirBase = basename(dir);
    if (dirBase !== anchorSuffix) continue;
    const parent = dir.includes("/") ? dir.slice(0, dir.length - dirBase.length - 1) : "";
    const prefix = parent ? `${parent}/` : "";
    const matched = [dir];
    for (const sibling of siblingNames) {
      const candidate = `${prefix}${sibling}`;
      if (dirs.has(candidate)) matched.push(candidate);
    }
    if (matched.length >= minMatches) return { matched, parent };
  }
  return null;
}

export function detectArchitecturalPatterns(dirs: ReadonlySet<string>): Detection<string>[] {
  const patterns: Detection<string>[] = [];

  const clean = siblingGroup(dirs, "domain", ["application", "infrastructure"], 2);
  if (clean) {
    patterns.push({
      value: "Likely Clean/Hexagonal Architecture",
      confidence: clean.matched.length === 3 ? "High" : "Medium",
      evidence: clean.matched.map((dir) => `${dir}/ directory present`),
      sourceFiles: clean.matched,
    });
  }

  const mvc = siblingGroup(dirs, "controllers", ["models", "views"], 2);
  if (mvc) {
    patterns.push({
      value: "Likely MVC (Model-View-Controller)",
      confidence: mvc.matched.length === 3 ? "High" : "Medium",
      evidence: mvc.matched.map((dir) => `${dir}/ directory present`),
      sourceFiles: mvc.matched,
    });
  }

  for (const dir of dirs) {
    if (basename(dir) !== "features") continue;
    const featureModules = [...dirs].filter((d) => d.startsWith(`${dir}/`) && d.slice(dir.length + 1).split("/").length === 1);
    if (featureModules.length >= 2) {
      patterns.push({
        value: "Likely Feature-based/Modular structure",
        confidence: "Medium",
        evidence: [`${dir}/ contains ${featureModules.length} feature module(s)`],
        sourceFiles: [dir, ...featureModules.slice(0, 10)],
      });
      break;
    }
  }

  const hasApps = dirs.has("apps");
  const hasPackages = dirs.has("packages");
  if (hasApps && hasPackages) {
    patterns.push({
      value: "Monorepo (apps/packages convention)",
      confidence: "High",
      evidence: ["apps/ and packages/ both present at repository root"],
      sourceFiles: ["apps", "packages"],
    });
  } else if (hasPackages) {
    patterns.push({
      value: "Monorepo (packages/* convention)",
      confidence: "Medium",
      evidence: ["packages/ present at repository root"],
      sourceFiles: ["packages"],
    });
  }

  if (patterns.length === 0) {
    return [{ value: "Unknown", confidence: "Low", evidence: [], sourceFiles: [] }];
  }
  return patterns;
}
