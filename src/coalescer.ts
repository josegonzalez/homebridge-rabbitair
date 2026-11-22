import type { Update } from './sdk/index.js';

/**
 * Merges updates that arrive close together into a single device command.
 * HomeKit often sets several characteristics at once (for example Active and
 * RotationSpeed), and sliders send a burst of values while dragging; only the
 * last value of each field is sent.
 */
export class UpdateCoalescer {
  private pending?: { update: Update; waiters: { resolve: () => void; reject: (e: unknown) => void }[] };
  private timer?: NodeJS.Timeout;
  private inflight: Promise<void> = Promise.resolve();

  constructor(
    private readonly send: (update: Update) => Promise<void>,
    private readonly delayMs = 250,
  ) {}

  /** Queues an update. Resolves once the merged command has been sent. */
  queue(update: Update): Promise<void> {
    if (!this.pending) {
      this.pending = { update: {}, waiters: [] };
    }
    Object.assign(this.pending.update, update);
    const done = new Promise<void>((resolve, reject) => this.pending!.waiters.push({ resolve, reject }));
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delayMs);
    return done;
  }

  /** Cancels pending updates. */
  cancel(): void {
    clearTimeout(this.timer);
    const batch = this.pending;
    this.pending = undefined;
    batch?.waiters.forEach((w) => w.reject(new Error('cancelled')));
  }

  private flush(): void {
    const batch = this.pending;
    this.pending = undefined;
    if (!batch) {
      return;
    }
    this.inflight = this.inflight
      .then(() => this.send(batch.update))
      .then(
        () => batch.waiters.forEach((w) => w.resolve()),
        (err) => batch.waiters.forEach((w) => w.reject(err)),
      );
  }
}
