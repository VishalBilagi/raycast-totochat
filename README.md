# Toto - Chat with GitHub Copilot

A Raycast extension that brings GitHub Copilot's powerful AI capabilities directly to your fingertips through the Copilot CLI.

![Extension Icon](assets/extension-icon.png)

## Features

- 💬 **Chat with Copilot**: Have natural conversations with GitHub Copilot's AI
- 🧠 **Model Selection**: Switch between available models
- ⚡️ **Instant Streaming**: See responses as they're generated
- 📂 **Sandboxed Sessions**: All session data is stored securely in `~/.raycast-copilot-session`

## Prerequisites

Before using Toto, you need:

1. **GitHub CLI** (`gh`) installed
2. **GitHub Copilot CLI extension** installed and authenticated
3. **Active GitHub Copilot subscription** (Free tier works with limited usage)

### Installation Steps

1. **Install GitHub CLI**:
   ```bash
   brew install gh
   ```

2. **Authenticate with GitHub**:
   ```bash
   gh auth login
   ```

3. **Install Copilot CLI extension**:
   ```bash
   gh extension install github/gh-copilot
   ```

4. **Verify installation**:
   ```bash
   copilot --version
   ```

## Usage

1. Open Raycast (⌘ + Space)
2. Search for "Toto Chat"
3. Press Enter to start chatting

### Chat Interface

- **Type & Enter**: Send a quick message from the search bar
- **Right Panel**: Shows the AI's full response in markdown
- **Left Panel**: Shows your message history (timestamps, model used)

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message (from search bar) |
| `⌘` `⇧` `M` | Open **Multiline Composer** for long prompts |
| `⌘` `C` | Copy the AI response |
| `⌘` `⇧` `C` | Copy your question |
| `⌘` `K` | View all available actions |

## Troubleshooting

### "Copilot CLI Not Found"
Make sure you have installed both GitHub CLI and the Copilot extension:
```bash
brew install gh
gh extension install github/gh-copilot
```

### "Please Log In to Copilot CLI"
Run the login command in your terminal. You may also need to re-authenticate `gh`:
```bash
gh auth login
gh copilot auth
```

## Development

```bash
# Install dependencies
npm install

# Start development mode
npm run dev

# Build for production
npm run build

# Lint code
npm run lint
```

## License

MIT