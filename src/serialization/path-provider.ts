import path from "node:path";
import crypto from "node:crypto";
import { createScaiError } from "@/shared/errors";
import { FilesystemTreeSpec, FilesystemTreeSpecRule } from "./tree-spec";
import { ItemPath } from "./item-path";

type PathAliasDefinition = {
  aliasRulePath: ItemPath;
  aliasPath: ItemPath;
};

const invalidFileNameCharacters = new Set<string>(
  [
    '"',
    "<",
    ">",
    "|",
    "\0",
    ...Array.from({ length: 31 }, (_, idx) => String.fromCharCode(idx + 1)),
    ":",
    "*",
    "?",
    "\\",
    "/",
    "$",
  ].map((c) => c)
);

const invalidFileNames = new Set(
  [
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9",
  ].map((name) => name.toLowerCase())
);

type PathIndexTreeNode<T> = {
  value: T[];
  children: Map<string, PathIndexTreeNode<T>>;
};

class PathIndexTree<T> {
  private readonly root: PathIndexTreeNode<T> = {
    value: [],
    children: new Map(),
  };
  valueCount = 0;

  addPathData(pathValue: ItemPath, data: T): void {
    let current: PathIndexTreeNode<T> = this.root;
    for (const segment of pathValue.toPathString().split("/").filter(Boolean)) {
      const key = segment.toLowerCase();
      if (!current.children.has(key)) {
        current.children.set(key, { value: [], children: new Map() });
      }
      current = current.children.get(key)!;
    }

    current.value.push(data);
    this.valueCount += 1;
  }

  *getAncestorAndSelfPathData(pathValue: ItemPath): Iterable<T> {
    let current: PathIndexTreeNode<T> = this.root;
    const segments = pathValue.toPathString().split("/").filter(Boolean);
    for (const segment of segments) {
      const child = current.children.get(segment.toLowerCase());
      if (!child) {
        return;
      }
      for (const value of child.value) {
        yield value;
      }
      current = child;
    }
  }
}

class SubtreeFilesystemPathProvider {
  private readonly spec: FilesystemTreeSpec;
  private readonly validPathSegmentsCache = new Map<string, string>();
  private readonly aliases: PathAliasDefinition[];

  constructor(spec: FilesystemTreeSpec) {
    this.spec = spec;
    this.aliases = this.createPathAliases(spec.rules);
  }

  getPhysicalPathForItemPath(itemPath: ItemPath, extension: string): string | null {
    if (!extension.startsWith(".")) {
      throw createScaiError("Extension must start with a period.", "INPUT_INVALID");
    }

    const childPath = this.getChildrenPathForItemPath(itemPath);
    if (!childPath) {
      return null;
    }

    return childPath + extension;
  }

  getChildrenPathsForItemPath(itemPath: ItemPath): string[] | null {
    const primary = this.getChildrenPathForItemPath(itemPath);
    if (!primary) {
      return null;
    }
    const shortened = this.getShortenedChildrenPathForItemPath(itemPath);
    if (primary.toLowerCase() === shortened.toLowerCase()) {
      return [primary];
    }

    return [primary, shortened];
  }

  toString(): string {
    return this.spec.physicalPath;
  }

  private getChildrenPathForItemPath(itemPath: ItemPath): string | null {
    const relativePath = this.processItemPathToPhysicalRelativePath(itemPath);
    if (!relativePath) {
      return null;
    }
    const hashedPath = this.applyPathLengthHashes(relativePath);
    return this.convertSubtreeRelativeItemPathToPhysicalPath(hashedPath);
  }

  private getShortenedChildrenPathForItemPath(itemPath: ItemPath): string {
    const relativePath = this.processItemPathToPhysicalRelativePath(itemPath);
    if (!relativePath) {
      return "";
    }

    const stripped = ItemPath.fromSegments(
      relativePath.toPathString().split("/").filter(Boolean).slice(1)
    );
    const hashed = this.computePathHash(stripped);
    return this.convertSubtreeRelativeItemPathToPhysicalPath(hashed);
  }

  private processItemPathToPhysicalRelativePath(itemPath: ItemPath): ItemPath | null {
    if (!this.spec.includesPath(itemPath)) {
      return null;
    }

    const subtreeRelativePath = itemPath.createRelativePathFrom(this.spec.path);
    if (!subtreeRelativePath) {
      return null;
    }

    const aliasApplied = this.tryApplyPathAliases(subtreeRelativePath);
    if (aliasApplied) {
      return aliasApplied;
    }

    const baseSegmentIndex = Math.max(itemPath.count - subtreeRelativePath.count - 1, 0);
    return subtreeRelativePath.prepend(
      itemPath.toPathString().split("/").filter(Boolean)[baseSegmentIndex]
    );
  }

  private convertSubtreeRelativeItemPathToPhysicalPath(relativePath: ItemPath): string {
    const parts = relativePath.toPathString().split("/").filter(Boolean);
    const normalized = parts.map((segment) =>
      this.convertItemPathSegmentToValidFilesystemPathSegment(segment)
    );
    return path.join(this.spec.physicalPath, ...normalized);
  }

  private convertItemPathSegmentToValidFilesystemPathSegment(segment: string): string {
    if (this.validPathSegmentsCache.has(segment)) {
      return this.validPathSegmentsCache.get(segment)!;
    }

    const trimmed = segment.trim();
    const chars = trimmed
      .split("")
      .map((char) => (invalidFileNameCharacters.has(char) ? "#" : char));
    let finalName = chars.join("");
    if (invalidFileNames.has(finalName.toLowerCase())) {
      finalName = "#" + finalName;
    }

    this.validPathSegmentsCache.set(segment, finalName);
    return finalName;
  }

  private createPathAliases(rules: FilesystemTreeSpecRule[]): PathAliasDefinition[] {
    const results: PathAliasDefinition[] = [];
    for (const rule of rules) {
      if (!rule.alias || !(rule.path instanceof ItemPath)) {
        continue;
      }
      results.push({
        aliasRulePath: rule.path,
        aliasPath: ItemPath.fromPathString("/" + rule.alias),
      });
    }
    return results;
  }

  private tryApplyPathAliases(relativePath: ItemPath): ItemPath | null {
    if (!this.aliases.length) {
      return null;
    }

    let currentPath: ItemPath | null = relativePath;
    while (currentPath) {
      const found = this.aliases.find((alias) => alias.aliasRulePath.equals(currentPath));
      if (found) {
        const aliasRelative = relativePath.createRelativePathFrom(found.aliasRulePath);
        if (!aliasRelative) {
          return null;
        }
        const baseSegmentIndex = Math.max(relativePath.count - aliasRelative.count - 1, 0);
        const aliasRelativeWithRoot = aliasRelative.prepend(
          relativePath.toPathString().split("/").filter(Boolean)[baseSegmentIndex]
        );
        return found.aliasPath.concatenate(aliasRelativeWithRoot);
      }

      currentPath = currentPath.createParentPath();
    }

    return null;
  }

  private computePathHash(relativePath: ItemPath): ItemPath {
    const hash = crypto
      .createHash("sha256")
      .update(relativePath.toPathString(), "utf8")
      .digest("hex")
      .substring(0, 16);
    return ItemPath.fromSegments([hash]);
  }

  private applyPathLengthHashes(relativePath: ItemPath): ItemPath {
    const maxLength = this.spec.maxRelativePathLength ?? 120;
    const relativeItemPath = ItemPath.fromSegments(
      relativePath.toPathString().split("/").filter(Boolean).slice(1)
    );

    if (relativeItemPath.pathLength <= maxLength) {
      return relativePath;
    }

    if (maxLength < 16) {
      throw createScaiError(
        `MaxRelativePathLength ${maxLength} is below minimum value of 16.`,
        "CONFIG_INVALID"
      );
    }

    let currentPath: ItemPath | null = relativeItemPath;
    const targetMultiple = Math.floor(relativeItemPath.pathLength / maxLength);
    let currentMultiple = currentPath.pathLength / maxLength;

    while (currentPath && currentMultiple > targetMultiple) {
      currentPath = currentPath.createParentPath();
      if (currentPath) {
        currentMultiple = currentPath.pathLength / maxLength;
      }
    }

    if (!currentPath || currentPath.count === 0) {
      throw createScaiError(
        `The path ${relativeItemPath} could not be stored because its length could not be reduced below the maximum path length ${maxLength}.`,
        "INPUT_INVALID"
      );
    }

    const relative = relativeItemPath.createRelativePathFrom(currentPath);
    if (!relative) {
      return relativePath;
    }
    const hashed = this.computePathHash(currentPath);
    return hashed.concatenate(relative);
  }
}

export class FilesystemPathProvider {
  private readonly subtrees = new PathIndexTree<SubtreeFilesystemPathProvider>();
  private examplePath = "";

  constructor(subtreeSpecs: FilesystemTreeSpec[]) {
    for (const spec of subtreeSpecs) {
      const subtree = new SubtreeFilesystemPathProvider(spec);
      this.subtrees.addPathData(spec.path, subtree);
      this.examplePath = spec.physicalPath;
    }
  }

  getPhysicalPathForItemPath(itemPath: ItemPath, extension: string): string | null {
    return this.invokeUnique(itemPath, (subtree) =>
      subtree.getPhysicalPathForItemPath(itemPath, extension)
    );
  }

  getChildrenPathsForItemPath(itemPath: ItemPath): string[] | null {
    return this.invokeUnique(itemPath, (subtree) => subtree.getChildrenPathsForItemPath(itemPath));
  }

  toString(): string {
    return `${this.subtrees.valueCount} subtrees, e.g. ${this.examplePath}`;
  }

  private invokeUnique<TResult>(
    itemPath: ItemPath,
    fn: (subtree: SubtreeFilesystemPathProvider) => TResult | null
  ): TResult | null {
    let result: TResult | null = null;
    let resultFoundOn: SubtreeFilesystemPathProvider | null = null;

    for (const subtree of this.subtrees.getAncestorAndSelfPathData(itemPath)) {
      const subtreeResult = fn(subtree);
      if (subtreeResult != null && result != null) {
        throw createScaiError(
          `The item path ${itemPath} was included in multiple places. Found valid file paths within these modules: ${resultFoundOn} and ${subtree}`,
          "CONFIG_INVALID"
        );
      }
      if (subtreeResult != null) {
        resultFoundOn = subtree;
        result = subtreeResult;
      }
    }

    return result;
  }
}
