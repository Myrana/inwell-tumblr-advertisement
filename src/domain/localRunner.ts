import { ApiError, LocalCompanionStatus } from "./api";

type CompanionRunOptions = {
  activeQueueName: string;
  companion: LocalCompanionStatus | null;
  headless: boolean;
  submit: boolean;
  testRun: boolean;
  refreshCompanionStatus: () => Promise<LocalCompanionStatus | null>;
  runCompanion: (queueName: string, options: { headless: boolean; submit: boolean }) => Promise<LocalCompanionStatus>;
};

export type CompanionRunOutcome =
  | {
      kind: "started";
      companion: LocalCompanionStatus;
      queueStatus: string;
    }
  | {
      kind: "companion-error";
      companion: LocalCompanionStatus;
      queueStatus: string;
    }
  | {
      kind: "fallback";
    };

export async function startLocalCompanionRun(options: CompanionRunOptions): Promise<CompanionRunOutcome> {
  const companion = options.companion ?? await options.refreshCompanionStatus().catch(() => null);
  if (!companion?.ok) {
    return { kind: "fallback" };
  }

  try {
    const run = await options.runCompanion(options.activeQueueName, {
      headless: options.headless,
      submit: options.submit,
    });
    return {
      kind: "started",
      companion: run,
      queueStatus: companionStartedMessage(run, options),
    };
  } catch (error) {
    if (error instanceof ApiError) {
      const refreshedCompanion = await options.refreshCompanionStatus().catch(() => null);
      return {
        kind: "companion-error",
        companion: refreshedCompanion?.ok ? refreshedCompanion : companion,
        queueStatus: `Local companion could not start the runner. ${error.message}`,
      };
    }

    const refreshedCompanion = await options.refreshCompanionStatus().catch(() => null);
    return {
      kind: "companion-error",
      companion: refreshedCompanion?.ok ? refreshedCompanion : companion,
      queueStatus: "Local companion could not start the runner. Local companion did not respond to the run request.",
    };
  }
}

function companionStartedMessage(run: LocalCompanionStatus, options: Pick<CompanionRunOptions, "headless" | "submit" | "testRun">) {
  const confirmedMode = run.lastRun?.headless ? " Headless mode was confirmed by the local companion." : "";
  if (options.testRun) {
    return `Local companion started a test run. It will fill Tumblr and stop before submitting.${confirmedMode}`;
  }
  if (!options.submit) {
    return `Live posting is not approved, so the local companion will prepare Tumblr without submitting.${confirmedMode}`;
  }
  if (options.headless) {
    return `Local companion started the runner headless. Watch this page for queue progress.${confirmedMode}`;
  }
  return "Local companion started the runner on this computer. You can leave this page open while it works.";
}
