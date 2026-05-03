import { createCliError } from "@/shared/errors";
import { isWildcardMatch } from "./wildcard";

export interface ItemPathMatchLike {
  isMatch: (path: ItemPath) => boolean;
  toPathString: () => string;
}

export class ItemPath implements ItemPathMatchLike {
  private readonly segments: string[];
  private baseString: string | null;

  private constructor(segments: string[], baseString?: string | null) {
    this.segments = segments.map((segment) => segment);
    this.baseString = baseString ?? null;
  }

  static fromPathString(pathString: string): ItemPath {
    if (!pathString || !pathString.startsWith("/")) {
      throw createCliError(`Item path '${pathString}' did not start with /.`, "INPUT_INVALID");
    }

    const segments = pathString.split("/").filter(Boolean);
    return new ItemPath(segments, pathString.replace(/\/+$/, ""));
  }

  static fromSegments(segments: string[]): ItemPath {
    return new ItemPath([...segments]);
  }

  get count(): number {
    return this.segments.length;
  }

  get itemName(): string | null {
    return this.segments.length > 0 ? this.segments[this.segments.length - 1] : null;
  }

  get pathLength(): number {
    return this.segments.reduce((sum, segment) => sum + segment.length, 0) + this.segments.length;
  }

  toPathString(): string {
    if (!this.baseString) {
      this.baseString = "/" + this.segments.join("/");
    }

    return this.baseString;
  }

  toString(): string {
    return this.toPathString();
  }

  equals(other: ItemPath | null): boolean {
    if (!other || other.count !== this.count) {
      return false;
    }

    for (let i = 0; i < this.segments.length; i += 1) {
      if (this.segments[i].toLowerCase() !== other.segments[i].toLowerCase()) {
        return false;
      }
    }

    return true;
  }

  createParentPath(): ItemPath | null {
    if (this.segments.length < 1) {
      return null;
    }

    return new ItemPath(this.segments.slice(0, -1));
  }

  prepend(segment: string): ItemPath {
    if (!segment || segment.includes("/")) {
      throw createCliError("Cannot prepend multiple segments.", "INPUT_INVALID");
    }

    return new ItemPath([segment, ...this.segments]);
  }

  concatenate(segment: string | ItemPath): ItemPath {
    if (typeof segment === "string") {
      if (!segment || segment.includes("/")) {
        throw createCliError("Cannot concatenate multiple segments using string.", "INPUT_INVALID");
      }

      return new ItemPath([...this.segments, segment]);
    }

    return new ItemPath([...this.segments, ...segment.segments]);
  }

  createRelativePathFrom(root: ItemPath): ItemPath | null {
    if (root.count > this.count) {
      return null;
    }

    const result: string[] = [];
    for (let i = 0; i < this.segments.length; i += 1) {
      const isWithinRoot = i < root.count;
      if (isWithinRoot && this.segments[i].toLowerCase() !== root.segments[i].toLowerCase()) {
        return null;
      }

      if (!isWithinRoot) {
        result.push(this.segments[i]);
      }
    }

    return new ItemPath(result);
  }

  isDescendantOrSelfOf(basePath: ItemPath | ItemPathMatchLike): boolean {
    if (basePath instanceof ItemPath) {
      if (basePath.count > this.count) {
        return false;
      }

      for (let i = 0; i < basePath.count; i += 1) {
        if (this.segments[i].toLowerCase() !== basePath.segments[i].toLowerCase()) {
          return false;
        }
      }

      return true;
    }

    return basePath.isMatch(this);
  }

  isMatch(path: ItemPath): boolean {
    return path.isDescendantOrSelfOf(this);
  }
}

export class ItemPathMatch implements ItemPathMatchLike {
  private readonly pathMatch: string;

  private constructor(pathMatch: string) {
    this.pathMatch = pathMatch;
  }

  static fromPathMatch(pathWildcard: string): ItemPathMatch {
    return new ItemPathMatch(pathWildcard);
  }

  isMatch(path: ItemPath): boolean {
    return isWildcardMatch(path.toPathString(), this.pathMatch, false);
  }

  toPathString(): string {
    return this.pathMatch;
  }

  toString(): string {
    return this.toPathString();
  }
}
