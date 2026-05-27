/**
 * scai doctor — local diagnostics.
 *
 * SDK entry: import `runDoctor` directly. The CLI parser lives in
 * `src/commands/doctor.ts`.
 */
export {
  runDoctor,
  type DoctorCheck,
  type DoctorResult,
  type DoctorStatus,
  type RunDoctorOptions,
} from "./run";
