import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";

const findEnvPath = (filename: string): string | undefined => {
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, filename);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
};

const envFiles = [".env.test.local", ".env.local", ".env"];
for (const file of envFiles) {
  const resolved = findEnvPath(file);
  if (resolved) {
    config({ path: resolved });
    break;
  }
}
