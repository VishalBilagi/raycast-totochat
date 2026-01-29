import { exec } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const execAsync = promisify(exec);

export interface CopilotStatus {
  isInstalled: boolean;
  isLoggedIn: boolean;
  version?: string;
  error?: string;
}

// Common paths where copilot CLI might be installed
const COPILOT_PATHS = [
  "/opt/homebrew/bin/copilot", // Apple Silicon Homebrew
  "/usr/local/bin/copilot", // Intel Homebrew
  join(homedir(), ".local/bin/copilot"), // Local bin
];

// Common paths for gh CLI
const GH_PATHS = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", join(homedir(), ".local/bin/gh")];

/**
 * Find the first existing executable path
 */
function findExecutable(paths: string[]): string | null {
  for (const p of paths) {
    if (existsSync(p)) {
      return p;
    }
  }
  return null;
}

/**
 * Get the copilot executable path
 */
export function getCopilotPath(): string | null {
  return findExecutable(COPILOT_PATHS);
}

/**
 * Get the gh executable path
 */
export function getGhPath(): string | null {
  return findExecutable(GH_PATHS);
}

/**
 * Get extended PATH for command execution
 */
function getExtendedPath(): string {
  return ["/opt/homebrew/bin", "/usr/local/bin", join(homedir(), ".local/bin"), process.env.PATH || ""].join(":");
}

/**
 * Execute a command with extended PATH
 */
async function execWithPath(command: string): Promise<{ stdout: string; stderr: string }> {
  return execAsync(command, {
    env: {
      ...process.env,
      PATH: getExtendedPath(),
    },
  });
}

/**
 * Check if Copilot CLI is installed by running `copilot --version`
 */
export async function isCopilotCliInstalled(): Promise<{ installed: boolean; version?: string; error?: string }> {
  const copilotPath = getCopilotPath();

  if (!copilotPath) {
    return {
      installed: false,
      error: "Copilot CLI not found in common locations",
    };
  }

  try {
    const { stdout } = await execWithPath(`"${copilotPath}" --version`);
    const version = stdout.trim();
    return { installed: true, version };
  } catch (error) {
    return {
      installed: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Check if user is logged into GitHub via gh CLI
 * The Copilot CLI uses gh auth for authentication
 */
export async function isCopilotLoggedIn(): Promise<{ loggedIn: boolean; error?: string }> {
  const ghPath = getGhPath();

  if (!ghPath) {
    // If gh CLI is not found, check if copilot config exists as fallback
    const copilotConfigPath = join(homedir(), ".copilot", "config.json");
    if (existsSync(copilotConfigPath)) {
      return { loggedIn: true };
    }
    return {
      loggedIn: false,
      error: "GitHub CLI (gh) not found",
    };
  }

  try {
    // Check gh auth status
    const { stdout, stderr } = await execWithPath(`"${ghPath}" auth status`);
    const output = stdout + stderr;

    // Check for logged in indicators
    if (output.includes("Logged in") || output.includes("✓")) {
      return { loggedIn: true };
    }

    // If no clear indicator, but command succeeded, likely logged in
    return { loggedIn: true };
  } catch (error) {
    // gh auth status returns non-zero if not logged in
    return {
      loggedIn: false,
      error: error instanceof Error ? error.message : "Not logged in to GitHub",
    };
  }
}

/**
 * Get full Copilot CLI status
 */
export async function getCopilotStatus(): Promise<CopilotStatus> {
  const installStatus = await isCopilotCliInstalled();

  if (!installStatus.installed) {
    return {
      isInstalled: false,
      isLoggedIn: false,
      error: installStatus.error,
    };
  }

  const loginStatus = await isCopilotLoggedIn();

  return {
    isInstalled: true,
    isLoggedIn: loginStatus.loggedIn,
    version: installStatus.version,
    error: loginStatus.error,
  };
}

/**
 * Open Copilot CLI installation guide
 */
export function getCopilotInstallUrl(): string {
  return "https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli";
}

/**
 * Get command to login to Copilot CLI
 */
export function getCopilotLoginCommand(): string {
  return "gh auth login";
}
