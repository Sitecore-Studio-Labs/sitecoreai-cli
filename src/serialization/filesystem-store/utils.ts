import fs from "node:fs/promises";

export const exists = async (value: string): Promise<boolean> => {
  try {
    await fs.access(value);
    return true;
  } catch {
    return false;
  }
};
