import { CopilotClient, CopilotSession, SessionEvent, ModelInfo, SessionMetadata } from "@github/copilot-sdk";
import { randomUUID } from "crypto";
import { homedir } from "os";
import { join } from "path";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

export interface ChatSession {
  sendMessage: (prompt: string) => Promise<void>;
  messages: Message[];
  isLoading: boolean;
  stop: () => Promise<void>;
  getSessionId: () => string | undefined;
}

export interface SavedChat {
  sessionId: string;
  name: string;
  summary?: string;
  startTime: Date;
  modifiedTime: Date;
}

// Re-export ModelInfo and SessionMetadata for use in UI
export type { ModelInfo, SessionMetadata };

let globalClient: CopilotClient | null = null;
let currentSessionId: string | null = null;

/**
 * Get extended PATH for finding copilot CLI
 */
function getExtendedPath(): string {
  return ["/opt/homebrew/bin", "/usr/local/bin", join(homedir(), ".local/bin"), process.env.PATH || ""].join(":");
}

let clientStarted = false;

import { mkdirSync } from "fs";

/**
 * Get or create a global Copilot client
 */
export async function getClient(): Promise<CopilotClient> {
  if (!globalClient) {
    // Set PATH in environment before creating client
    process.env.PATH = getExtendedPath();

    // Ensure custom session directory exists
    const sessionDir = join(homedir(), ".raycast-copilot-session");
    try {
      mkdirSync(sessionDir, { recursive: true });
    } catch (err) {
      console.error("Failed to create session directory:", err);
    }

    globalClient = new CopilotClient({
      // The SDK will find the copilot CLI in the extended PATH
      cwd: sessionDir,
    });
  }

  // Ensure client is started
  if (!clientStarted) {
    await globalClient.start();
    clientStarted = true;
  }

  return globalClient;
}

/**
 * Stop the global Copilot client
 */
export async function stopClient(): Promise<void> {
  if (globalClient) {
    await globalClient.stop();
    globalClient = null;
    currentSessionId = null;
    clientStarted = false;
  }
}

/**
 * Fetch available models from the Copilot CLI
 */
export async function fetchAvailableModels(): Promise<ModelInfo[]> {
  const client = await getClient();
  const models = await client.listModels();
  return models;
}

/**
 * List all saved sessions
 */
export async function listSavedSessions(): Promise<SessionMetadata[]> {
  const client = await getClient();
  const sessions = await client.listSessions();
  return sessions;
}

/**
 * Delete a saved session
 */
export async function deleteSavedSession(sessionId: string): Promise<void> {
  const client = await getClient();
  await client.deleteSession(sessionId);
}

/**
 * Get the last session ID
 */
export async function getLastSessionId(): Promise<string | undefined> {
  const client = await getClient();
  return client.getLastSessionId();
}

/**
 * Check if a model is premium based on billing info
 * Uses is_premium field if available, falls back to multiplier check
 */
export function isModelPremium(model: ModelInfo): boolean {
  // The API returns is_premium in the billing object
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const billing = model.billing as any;
  if (billing?.is_premium !== undefined) {
    return billing.is_premium === true;
  }
  // Fallback: multiplier > 0 usually means premium
  return (model.billing?.multiplier ?? 0) > 0;
}

/**
 * Get a human-readable description for a model
 */
export function getModelDescription(model: ModelInfo): string {
  const parts: string[] = [];

  if (model.capabilities.supports.vision) {
    parts.push("Vision");
  }

  const multiplier = model.billing?.multiplier ?? 1;
  if (multiplier === 1) {
    parts.push("Free tier");
  } else {
    parts.push(`${multiplier}x premium`);
  }

  if (model.policy?.state === "disabled") {
    parts.push("Disabled");
  }

  return parts.join(" • ");
}

/**
 * Set up event listeners on a session
 */
function setupSessionEventListeners(
  session: CopilotSession,
  sessionId: string,
  messages: Message[],
  onUpdate: (messages: Message[], isLoading: boolean) => void,
): { resetState: () => void } {
  let isLoading = false;
  let currentAssistantMessage: Message | null = null;
  let lastDeltaContent = "";
  let idleProcessed = false;

  session.on((event: SessionEvent) => {
    // Skip if session changed
    if (currentSessionId !== sessionId) return;

    if (event.type === "assistant.message_delta") {
      const deltaContent = event.data?.deltaContent || "";

      // Skip empty deltas
      if (!deltaContent) return;

      // Skip if this is the exact same delta we just processed (duplicate event)
      if (deltaContent === lastDeltaContent && currentAssistantMessage) {
        return;
      }

      lastDeltaContent = deltaContent;

      if (!currentAssistantMessage) {
        currentAssistantMessage = {
          id: randomUUID(),
          role: "assistant",
          content: "",
          timestamp: new Date(),
          isStreaming: true,
        };
        messages.push(currentAssistantMessage);
      }

      currentAssistantMessage.content += deltaContent;
      onUpdate([...messages], isLoading);
    }

    if (event.type === "session.idle") {
      // Only process idle once per response
      if (idleProcessed) return;
      idleProcessed = true;

      if (currentAssistantMessage) {
        currentAssistantMessage.isStreaming = false;
        currentAssistantMessage = null;
      }
      isLoading = false;
      lastDeltaContent = "";
      onUpdate([...messages], isLoading);
    }
  });

  return {
    resetState: () => {
      currentAssistantMessage = null;
      lastDeltaContent = "";
      idleProcessed = false;
      isLoading = true;
    },
  };
}

/**
 * Create a new chat session with streaming support
 */
export async function createChatSession(
  onUpdate: (messages: Message[], isLoading: boolean) => void,
  model: string = "gpt-4o-mini",
): Promise<ChatSession> {
  const client = await getClient();

  // Create a unique session ID for deduplication
  const sessionId = randomUUID();
  currentSessionId = sessionId;

  const session = await client.createSession({
    model,
    streaming: true,
  });

  const messages: Message[] = [];
  let isLoading = false;

  const { resetState } = setupSessionEventListeners(session, sessionId, messages, onUpdate);

  // Get the actual session ID from the SDK
  const sdkSessionId = session.sessionId;

  return {
    messages,
    isLoading,
    getSessionId: () => sdkSessionId,
    async sendMessage(prompt: string) {
      // Add user message
      const userMessage: Message = {
        id: randomUUID(),
        role: "user",
        content: prompt,
        timestamp: new Date(),
      };
      messages.push(userMessage);
      isLoading = true;
      resetState();
      onUpdate([...messages], isLoading);

      // Send to Copilot
      await session.sendAndWait({ prompt });
    },
    async stop() {
      await stopClient();
    },
  };
}

/**
 * Resume an existing chat session
 */
export async function resumeChatSession(
  sessionId: string,
  onUpdate: (messages: Message[], isLoading: boolean) => void,
): Promise<ChatSession> {
  const client = await getClient();

  // Set up tracking
  const internalId = randomUUID();
  currentSessionId = internalId;

  const session = await client.resumeSession(sessionId);

  const messages: Message[] = [];
  let isLoading = false;

  const { resetState } = setupSessionEventListeners(session, internalId, messages, onUpdate);

  return {
    messages,
    isLoading,
    getSessionId: () => sessionId,
    async sendMessage(prompt: string) {
      // Add user message
      const userMessage: Message = {
        id: randomUUID(),
        role: "user",
        content: prompt,
        timestamp: new Date(),
      };
      messages.push(userMessage);
      isLoading = true;
      resetState();
      onUpdate([...messages], isLoading);

      // Send to Copilot
      await session.sendAndWait({ prompt });
    },
    async stop() {
      await stopClient();
    },
  };
}
