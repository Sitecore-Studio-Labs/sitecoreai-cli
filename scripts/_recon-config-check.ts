import { readRootConfigurationFile } from "@/config/root-config";
try { readRootConfigurationFile(process.cwd()); console.log("CONFIG VALID"); }
catch (e) { const x = e as { message?: string; details?: unknown }; console.log("ERR:", x.message); console.log("DETAILS:", JSON.stringify(x.details, null, 2)); }
