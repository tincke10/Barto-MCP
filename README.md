# MCP Ralph Workflow

> MCP Server for iterative Generator-Discriminator workflows (Ralph Loop)

A Model Context Protocol (MCP) server that implements an iterative improvement loop where a Generator creates content and a Discriminator evaluates it against specified criteria until quality thresholds are met.

## Features

- **Iterative Refinement**: Automatic improvement loop with configurable thresholds
- **Multi-Provider Support**: Works with Anthropic (Claude) and OpenAI models
- **Async Execution**: Support for both synchronous and asynchronous workflow execution
- **Cost Control**: Built-in cost estimation and limits
- **Observability**: Structured logging, metrics, and tracing support
- **Security**: Input sanitization and prompt injection protection

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm
- Redis (for state management)
- PostgreSQL (for history, optional)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd mcp-ralph-workflow

# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env

# Edit .env with your API keys
# At minimum, set ANTHROPIC_API_KEY
```

### Development

```bash
# Run in development mode with hot reload
pnpm dev

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Type check
pnpm typecheck

# Lint
pnpm lint

# Format code
pnpm format
```

### Build

```bash
# Build for production
pnpm build

# Start production server
pnpm start
```

## MCP Tools

### `ping`

Test the server connection.

```json
{
  "name": "ping",
  "arguments": {
    "message": "optional message"
  }
}
```

### `run_workflow`

Execute an iterative generator-discriminator workflow.

```json
{
  "name": "run_workflow",
  "arguments": {
    "task": "Write a product description for a smartphone",
    "criteria": [
      "Clear and concise",
      "Highlights key features",
      "Professional tone",
      "Under 200 words"
    ],
    "maxIterations": 10,
    "scoreThreshold": 0.85,
    "mode": "sync"
  }
}
```

### `get_status`

Check the status of a workflow.

```json
{
  "name": "get_status",
  "arguments": {
    "workflowId": "uuid-here",
    "includeHistory": true
  }
}
```

### `cancel_workflow`

Cancel a running workflow.

```json
{
  "name": "cancel_workflow",
  "arguments": {
    "workflowId": "uuid-here",
    "reason": "No longer needed"
  }
}
```

### `list_workflows`

List workflows with filtering.

```json
{
  "name": "list_workflows",
  "arguments": {
    "status": "running",
    "limit": 20
  }
}
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key | Required |
| `OPENAI_API_KEY` | OpenAI API key | Optional |
| `DEFAULT_LLM_PROVIDER` | Default provider | `anthropic` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `DATABASE_URL` | PostgreSQL connection URL | Optional |
| `MAX_ITERATIONS_LIMIT` | Max iterations allowed | `50` |
| `DEFAULT_SCORE_THRESHOLD` | Default quality threshold | `0.85` |
| `MAX_COST_PER_WORKFLOW_USD` | Max cost per workflow | `1.00` |
| `LOG_LEVEL` | Logging level | `info` |

## MCP Inspector (Testing & Development)

Use the MCP Inspector to test the server connection and available tools:

```bash
# Build first (required)
npm run build

# Run with MCP Inspector
npm run inspector
```

This will open a web interface where you can:
- View all available tools (`ping`, `run_workflow`, `get_status`, etc.)
- Test tool calls interactively
- Inspect request/response payloads
- Debug connection issues

### Manual Inspector Usage

```bash
# Using npx directly
npx @modelcontextprotocol/inspector node dist/index.js

# With environment variables
ANTHROPIC_API_KEY=your-key npx @modelcontextprotocol/inspector node dist/index.js
```

## Claude Desktop Integration

Add to your Claude Desktop config:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ralph-workflow": {
      "command": "node",
      "args": ["/path/to/mcp-ralph-workflow/dist/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Verifying Connection

1. Restart Claude Desktop after updating the config
2. Look for the hammer icon (🔨) in the chat interface
3. Click it to see available tools from `ralph-workflow`
4. Test with: "Use the ping tool to test the connection"

## Project Structure

```
src/
├── index.ts              # Entry point
├── server.ts             # MCP server setup
├── tools/                # MCP tools
├── core/                 # Business logic
│   ├── orchestrator/     # Workflow orchestration
│   └── runners/          # Generator/Discriminator
├── infrastructure/       # External services
│   ├── llm/             # LLM providers
│   ├── persistence/     # Redis/PostgreSQL
│   └── queue/           # BullMQ
├── shared/              # Shared utilities
│   ├── errors/          # Error types
│   ├── types/           # Type definitions
│   └── utils/           # Utilities
├── schemas/             # Zod schemas
└── config/              # Configuration
```

## Testing

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test tests/unit/tools/ping.test.ts

# Run with coverage
pnpm test:coverage

# Watch mode
pnpm test -- --watch
```

## License

MIT
