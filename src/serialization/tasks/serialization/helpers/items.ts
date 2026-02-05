import { ItemData } from "../../../types";

export const buildItemDataMap = (items: ItemData[]): Map<string, ItemData> =>
  new Map(items.map((item) => [item.id, item]));
