/**
 * Optional presentation hook for the Deploy API transport.
 *
 * `deployRequest` is part of the public `./deploy` SDK surface, so it
 * must not own a spinner, global signal handlers, or a logger. It
 * reports request lifecycle to an optional listener instead. The CLI
 * installs one (`installDeployTransportSpinner`); SDK consumers leave it
 * unset and the transport runs silently — no `ora`, no `consola`, no
 * `process.on` handlers in their dependency graph.
 *
 * Pure: no CLI dependencies.
 */

/** A settled-once handle for one in-flight request. */
export interface DeployRequestSpan {
  succeed(): void;
  fail(): void;
}

/** Receives Deploy transport lifecycle events for CLI presentation. */
export interface DeployTransportListener {
  /**
   * A request started. May return a span to settle when the request
   * completes, or `null` to show nothing (e.g. non-TTY, quiet mode).
   */
  onRequestStart?(
    method: string,
    path: string,
    silent: boolean
  ): Promise<DeployRequestSpan | null> | DeployRequestSpan | null;
  /** An HTTP trace line, emitted only when `SITECOREAI_TRACE_HTTP` is set. */
  onTrace?(message: string): void;
}

let listener: DeployTransportListener | null = null;

/** Install (or clear, with `null`) the Deploy transport listener. */
export const setDeployTransportListener = (next: DeployTransportListener | null): void => {
  listener = next;
};

/** The current Deploy transport listener, or `null` when none is set. */
export const getDeployTransportListener = (): DeployTransportListener | null => listener;
