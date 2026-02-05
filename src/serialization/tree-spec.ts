import { ItemPath, ItemPathMatch, ItemPathMatchLike } from "./item-path";
import { isWildcard } from "./wildcard";

export enum TreeScope {
  SingleItem = "SingleItem",
  ItemAndChildren = "ItemAndChildren",
  ItemAndDescendants = "ItemAndDescendants",
  DescendantsOnly = "DescendantsOnly",
}

export enum TreeRuleScope {
  Ignored = "Ignored",
  SingleItem = "SingleItem",
  ItemAndChildren = "ItemAndChildren",
  ItemAndDescendants = "ItemAndDescendants",
}

export enum AllowedPushOperations {
  CreateUpdateAndDelete = "CreateUpdateAndDelete",
  CreateAndUpdate = "CreateAndUpdate",
  CreateOnly = "CreateOnly",
}

export class TreeSpecRule {
  path!: ItemPathMatchLike;
  scope?: TreeRuleScope;
  allowedPushOperations?: AllowedPushOperations | null;

  validate(parent: TreeSpec): void {
    this.validateInternal(parent, true);
  }

  protected validateInternal(parent: TreeSpec, validateScopes: boolean): void {
    if (!parent) {
      throw new Error("TreeSpecRule parent is required.");
    }

    if (validateScopes) {
      this.validateScopes(parent);
    }

    if (this.path instanceof ItemPath) {
      this.validateItemPath(parent, this.path);
      return;
    }

    if (this.path instanceof ItemPathMatch) {
      this.validateItemPathMatch(parent, this.path);
      return;
    }

    throw new Error(`Subtree ${parent.path} has a rule with no path.`);
  }

  private validateScopes(parent: TreeSpec): void {
    if (!this.scope) {
      throw new Error(`${parent.path} has rule ${this.path?.toPathString()} without scope.`);
    }

    if (parent.scope === TreeScope.SingleItem) {
      throw new Error(`${parent.path} has scope ${TreeScope.SingleItem} and rules are defined.`);
    }

    if (
      parent.scope === TreeScope.ItemAndChildren &&
      (this.scope === TreeRuleScope.ItemAndDescendants ||
        this.scope === TreeRuleScope.ItemAndChildren)
    ) {
      throw new Error(
        `${parent.path} has scope ${TreeScope.ItemAndChildren} and rule ${this.path.toPathString()} has scope ${this.scope}.`
      );
    }
  }

  private validateItemPath(parent: TreeSpec, itemPath: ItemPath): void {
    if (itemPath.isDescendantOrSelfOf(parent.path)) {
      throw new Error(
        `Subtree path ${parent.path} contained rule for ${this.path.toPathString()}, which is absolute.`
      );
    }

    if (itemPath.count === 0) {
      throw new Error(`Subtree path ${parent.path} contained rule for /, which is the root item.`);
    }

    const parentRelative = itemPath.createParentPath();
    if (!parentRelative) {
      return;
    }

    let currentParentPath = parent.path.concatenate(parentRelative);
    while (!currentParentPath.equals(parent.path) && currentParentPath.count > 0) {
      if (!parent.includesPath(currentParentPath)) {
        throw new Error(
          `Subtree path ${parent.path} contained rule for ${this.path.toPathString()}, but ancestor path ${currentParentPath} was not included.`
        );
      }

      const nextParent = currentParentPath.createParentPath();
      if (!nextParent) {
        break;
      }
      currentParentPath = nextParent;
    }
  }

  private validateItemPathMatch(parent: TreeSpec, itemPathMatch: ItemPathMatch): void {
    const matchValue = itemPathMatch.toPathString();
    if (!matchValue.endsWith("*")) {
      throw new Error(
        `Subtree ${parent.path} contained path match rule ${matchValue} without trailing '*'.`
      );
    }

    if (this.scope === TreeRuleScope.SingleItem || this.scope === TreeRuleScope.ItemAndChildren) {
      throw new Error(
        `Subtree ${parent.path} contained wildcard rule ${matchValue} with invalid scope ${this.scope}.`
      );
    }
  }
}

export class FilesystemTreeSpecRule extends TreeSpecRule {
  alias?: string;

  override validate(parent: TreeSpec): void {
    if (!parent) {
      throw new Error("FilesystemTreeSpecRule parent is required.");
    }

    if (!this.alias) {
      super.validate(parent);
      return;
    }

    this.validateInternal(parent, false);

    if (this.scope) {
      throw new Error(
        `Subtree ${parent.path} contained rule for ${this.path.toPathString()} with alias and scope.`
      );
    }

    if (this.path instanceof ItemPathMatch) {
      throw new Error(
        `Subtree ${parent.path} contained match rule ${this.path.toPathString()} that also had an alias.`
      );
    }

    if (!/^[A-Za-z0-9 \-_]+$/.test(this.alias)) {
      throw new Error(
        `Subtree ${parent.path} rule for ${this.path.toPathString()} has invalid alias '${this.alias}'.`
      );
    }
  }
}

export class TreeSpec {
  path!: ItemPath;
  scope: TreeScope = TreeScope.ItemAndDescendants;
  allowedPushOperations: AllowedPushOperations = AllowedPushOperations.CreateUpdateAndDelete;
  rules: FilesystemTreeSpecRule[] = [];

  validate(): void {
    if (!this.path || this.path.count === 0) {
      throw new Error("TreeSpec path is null or empty.");
    }

    for (const rule of this.rules) {
      if (!rule.path) {
        throw new Error("TreeSpec rule path is null or empty.");
      }

      rule.validate(this);
    }
  }

  includesPath(path: ItemPath, logger?: (message: string) => void): boolean {
    const relativePath = path.createRelativePathFrom(this.path);

    if (!relativePath) {
      logger?.("Path was not relative to subtree");
      return false;
    }

    if (this.scope === TreeScope.SingleItem && relativePath.count > 0) {
      logger?.("Tree scope is SingleItem, and item is a descendant");
      return false;
    }

    if (this.scope === TreeScope.ItemAndChildren && relativePath.count > 1) {
      logger?.("Tree scope is ItemAndChildren, and item is a grandchild or deeper");
      return false;
    }

    if (this.scope === TreeScope.DescendantsOnly && relativePath.count === 0) {
      logger?.("Tree scope is DescendantsOnly and item is the root item");
      return false;
    }

    for (const rule of this.getRulesThatApplyTo(relativePath)) {
      switch (rule.scope) {
        case TreeRuleScope.Ignored:
          logger?.(`Rule ${rule.path.toPathString()} excluded item`);
          return false;
        case TreeRuleScope.ItemAndDescendants:
          logger?.(`Rule ${rule.path.toPathString()} included item`);
          return true;
        case TreeRuleScope.SingleItem:
        case TreeRuleScope.ItemAndChildren: {
          if (!(rule.path instanceof ItemPath)) {
            throw new Error("Cannot determine relative path to wildcard.");
          }
          const ruleRelativePath = relativePath.createRelativePathFrom(rule.path);
          if (!ruleRelativePath) {
            return false;
          }
          if (rule.scope === TreeRuleScope.SingleItem && ruleRelativePath.count > 0) {
            logger?.("Rule scope SingleItem and item is a descendant");
            return false;
          }
          if (rule.scope === TreeRuleScope.ItemAndChildren && ruleRelativePath.count > 1) {
            logger?.("Rule scope ItemAndChildren and item is a grandchild or deeper");
            return false;
          }
          return true;
        }
        default:
          break;
      }
    }

    logger?.(`Item path matches subtree scope ${this.scope}.`);
    return true;
  }

  getAllowedPushOperationsForItem(path: ItemPath): AllowedPushOperations {
    const relativePath = path.createRelativePathFrom(this.path);
    if (!relativePath) {
      return AllowedPushOperations.CreateOnly;
    }

    for (const rule of this.getRulesThatApplyTo(relativePath)) {
      if (rule.allowedPushOperations) {
        return rule.allowedPushOperations;
      }
    }

    return this.allowedPushOperations;
  }

  protected getRulesThatApplyTo(relativePath: ItemPath): FilesystemTreeSpecRule[] {
    if (this.rules.length === 0 || relativePath.count === 0) {
      return [];
    }

    return this.rules.filter((rule) => relativePath.isDescendantOrSelfOf(rule.path));
  }
}

export class FilesystemTreeSpec extends TreeSpec {
  name!: string;
  database: string = "master";
  physicalPath!: string;
  maxRelativePathLength?: number;

  override validate(): void {
    super.validate();

    if (!this.name) {
      throw new Error(`Subtree name was null or empty for path ${this.path}.`);
    }

    if (!this.database) {
      throw new Error(`Subtree ${this.name} database was null or empty.`);
    }

    if (!this.physicalPath) {
      throw new Error(`Subtree ${this.name} physicalPath was null or empty.`);
    }

    const aliasSet = new Set<string>();
    for (const rule of this.rules) {
      if (!rule.alias) {
        continue;
      }
      if (aliasSet.has(rule.alias.toLowerCase())) {
        throw new Error(`Duplicate path alias '${rule.alias}' in subtree ${this.name}.`);
      }
      aliasSet.add(rule.alias.toLowerCase());
    }
  }
}

export const parseItemPathMatch = (value: string): ItemPathMatchLike => {
  if (isWildcard(value)) {
    return ItemPathMatch.fromPathMatch(value);
  }

  return ItemPath.fromPathString(value);
};
