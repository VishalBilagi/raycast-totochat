import {
  Action,
  ActionPanel,
  Detail,
  Form,
  Icon,
  List,
  LocalStorage,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  createChatSession,
  fetchAvailableModels,
  getModelDescription,
  isModelPremium,
  Message,
  ChatSession,
  ModelInfo,
} from "./utils/copilot-client";

const STORAGE_KEY_MODEL = "toto-selected-model";

// Multiline Message Composer
function MultilineComposer({ onSubmit, draft = "" }: { onSubmit: (message: string) => void; draft?: string }) {
  const [message, setMessage] = useState(draft);
  const { pop } = useNavigation();

  const handleSubmit = useCallback(() => {
    if (message.trim()) {
      onSubmit(message.trim());
      pop();
    }
  }, [message, onSubmit, pop]);

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Send Message" icon={Icon.ArrowRight} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="message"
        title="Message"
        placeholder="Write your message here... (supports multiple lines)"
        value={message}
        onChange={setMessage}
        autoFocus
        enableMarkdown
      />
      <Form.Description text="💡 Press ⌘+Enter to send" />
    </Form>
  );
}

// Main Chat View with Split Panel
function ChatView() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>("gpt-4o-mini");
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [isInitializing, setIsInitializing] = useState(true);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [searchText, setSearchText] = useState("");
  const sessionRef = useRef<ChatSession | null>(null);

  // Fallback models in case dynamic loading fails
  const FALLBACK_MODELS: ModelInfo[] = [
    {
      id: "gpt-4o-mini",
      name: "GPT-4o Mini",
      capabilities: { supports: { vision: false }, limits: { max_context_window_tokens: 128000 } },
      billing: { multiplier: 1 },
    },
    {
      id: "gpt-4.1",
      name: "GPT-4.1",
      capabilities: { supports: { vision: false }, limits: { max_context_window_tokens: 128000 } },
      billing: { multiplier: 10 },
    },
  ] as ModelInfo[];

  // Load available models
  useEffect(() => {
    const loadModels = async () => {
      try {
        const models = await fetchAvailableModels();
        const enabledModels = models.filter((m) => m.policy?.state !== "disabled");

        if (enabledModels.length > 0) {
          setAvailableModels(enabledModels);
        } else {
          setAvailableModels(FALLBACK_MODELS);
        }
        setModelsLoaded(true);

        const finalModels = enabledModels.length > 0 ? enabledModels : FALLBACK_MODELS;
        const savedModel = await LocalStorage.getItem<string>(STORAGE_KEY_MODEL);
        if (savedModel && finalModels.some((m) => m.id === savedModel)) {
          setSelectedModel(savedModel);
        } else {
          const freeModel = finalModels.find((m) => !isModelPremium(m));
          const defaultModel = freeModel || finalModels[0];
          if (defaultModel) {
            setSelectedModel(defaultModel.id);
          }
        }
      } catch (err) {
        console.error("Failed to load models:", err);
        setAvailableModels(FALLBACK_MODELS);
        setModelsLoaded(true);
        showToast({
          style: Toast.Style.Animated,
          title: "Using default models",
          message: "Could not fetch available models",
        });
      }
    };

    loadModels();
  }, []);

  // Initialize chat session when model changes
  useEffect(() => {
    if (!modelsLoaded) return;

    let mounted = true;

    const initSession = async () => {
      setIsInitializing(true);
      if (sessionRef.current) {
        await sessionRef.current.stop();
      }

      try {
        const chatSession = await createChatSession((msgs, loading) => {
          if (mounted) {
            setMessages(msgs);
            setIsLoading(loading);
          }
        }, selectedModel);
        if (mounted) {
          setSession(chatSession);
          sessionRef.current = chatSession;
          setMessages([]);
          setIsInitializing(false);
        }
      } catch (err) {
        if (mounted) {
          const errorMessage = err instanceof Error ? err.message : "Failed to initialize chat session";
          setError(errorMessage);
          setIsInitializing(false);
          showToast({
            style: Toast.Style.Failure,
            title: "Error",
            message: errorMessage,
          });
        }
      }
    };

    initSession();

    return () => {
      mounted = false;
    };
  }, [selectedModel, modelsLoaded]);

  const handleModelChange = useCallback(
    async (modelId: string) => {
      await LocalStorage.setItem(STORAGE_KEY_MODEL, modelId);
      setSelectedModel(modelId);
      const modelName = availableModels.find((m) => m.id === modelId)?.name || modelId;
      showToast({
        style: Toast.Style.Success,
        title: "Model Changed",
        message: `Now using ${modelName}`,
      });
    },
    [availableModels],
  );

  const handleSendMessage = useCallback(
    async (message: string) => {
      if (!session || !message.trim()) {
        return;
      }

      setSearchText("");

      try {
        await session.sendMessage(message.trim());
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to send message";
        showToast({
          style: Toast.Style.Failure,
          title: "Error",
          message: errorMessage,
        });
      }
    },
    [session],
  );

  if (error) {
    return (
      <Detail
        markdown={`# ❌ Error\n\n${error}\n\nPlease try again or check your Copilot CLI installation.`}
        actions={
          <ActionPanel>
            <Action
              title="Retry"
              icon={Icon.RotateClockwise}
              onAction={() => {
                setError(null);
                setMessages([]);
              }}
            />
          </ActionPanel>
        }
      />
    );
  }

  const currentModelInfo = availableModels.find((m) => m.id === selectedModel);
  const freeModels = availableModels.filter((m) => !isModelPremium(m));
  const premiumModels = availableModels.filter((m) => isModelPremium(m));

  // Convert messages to pairs (user question -> assistant response)
  const messagePairs: { user: Message; assistant?: Message }[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "user") {
      const nextMsg = messages[i + 1];
      messagePairs.push({
        user: msg,
        assistant: nextMsg?.role === "assistant" ? nextMsg : undefined,
      });
      if (nextMsg?.role === "assistant") i++; // Skip the assistant message
    }
  }

  const hasMessages = messagePairs.length > 0;

  // Get the latest message ID for auto-selection
  const latestMessageId = hasMessages ? messagePairs[messagePairs.length - 1].user.id : undefined;

  // Action Panel for messages
  const ChatActionPanel = ({ pair }: { pair?: { user: Message; assistant?: Message } }) => (
    <ActionPanel>
      <ActionPanel.Section title="Send Message">
        <Action
          title="Send Message"
          icon={Icon.ArrowRight}
          onAction={() => {
            if (searchText.trim()) {
              handleSendMessage(searchText.trim());
            }
          }}
        />
        <Action.Push
          title="Compose Message"
          icon={Icon.Document}
          target={<MultilineComposer onSubmit={handleSendMessage} draft={searchText} />}
          shortcut={{ modifiers: ["cmd", "shift"], key: "m" }}
        />
      </ActionPanel.Section>
      {pair && (
        <ActionPanel.Section title="Message">
          <Action.CopyToClipboard
            title="Copy Response"
            content={pair.assistant?.content || ""}
            shortcut={{ modifiers: ["cmd"], key: "c" }}
          />
          <Action.CopyToClipboard
            title="Copy Question"
            content={pair.user.content}
            shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
          />
        </ActionPanel.Section>
      )}
    </ActionPanel>
  );

  return (
    <List
      isLoading={isInitializing || !modelsLoaded || isLoading}
      isShowingDetail={hasMessages}
      selectedItemId={latestMessageId}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Type message & press Enter..."
      searchBarAccessory={
        availableModels.length > 0 ? (
          <List.Dropdown tooltip="Select Model" value={selectedModel} onChange={(value) => handleModelChange(value)}>
            {freeModels.length > 0 && (
              <List.Dropdown.Section title="Free Tier">
                {freeModels.map((model) => (
                  <List.Dropdown.Item
                    key={model.id}
                    title={model.name}
                    value={model.id}
                    icon={model.capabilities.supports.vision ? Icon.Eye : undefined}
                  />
                ))}
              </List.Dropdown.Section>
            )}
            {premiumModels.length > 0 && (
              <List.Dropdown.Section title="Premium">
                {premiumModels.map((model) => (
                  <List.Dropdown.Item
                    key={model.id}
                    title={`${model.name} (${model.billing?.multiplier}x)`}
                    value={model.id}
                    icon={model.capabilities.supports.vision ? Icon.Eye : undefined}
                  />
                ))}
              </List.Dropdown.Section>
            )}
          </List.Dropdown>
        ) : undefined
      }
    >
      {!hasMessages ? (
        <List.EmptyView
          icon={Icon.Message}
          title="Start a Conversation"
          description={`Using ${currentModelInfo?.name || selectedModel}\n${currentModelInfo ? getModelDescription(currentModelInfo) : ""}\n\nType above & press Enter, or ⌘⇧M for multiline`}
          actions={<ChatActionPanel />}
        />
      ) : (
        messagePairs.map((pair, index) => (
          <List.Item
            key={pair.user.id}
            id={pair.user.id}
            icon={Icon.Person}
            title={pair.user.content.length > 60 ? pair.user.content.substring(0, 60) + "..." : pair.user.content}
            subtitle={pair.user.timestamp.toLocaleTimeString()}
            accessories={
              pair.assistant?.isStreaming
                ? [{ icon: Icon.CircleProgress, text: "typing..." }]
                : [{ text: `#${index + 1}` }]
            }
            detail={
              <List.Item.Detail
                markdown={
                  pair.assistant
                    ? pair.assistant.content || (pair.assistant.isStreaming ? "..." : "")
                    : "*Waiting for response...*"
                }
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label title="Model" text={currentModelInfo?.name || selectedModel} />
                    <List.Item.Detail.Metadata.Label title="Time" text={pair.user.timestamp.toLocaleString()} />
                    {pair.assistant && !pair.assistant.isStreaming && (
                      <List.Item.Detail.Metadata.Label
                        title="Response Length"
                        text={`${pair.assistant.content.length} chars`}
                      />
                    )}
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={<ChatActionPanel pair={pair} />}
          />
        ))
      )}
    </List>
  );
}

// Main Command Entry Point
// Go straight to ChatView - it handles loading and errors internally
// This gives a faster perceived startup since the List shows immediately with a loading spinner
export default function Command() {
  return <ChatView />;
}
