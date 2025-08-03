# Chatbot Configuration

The chatbot can be configured using environment variables or the config file. Environment variables take precedence over config file settings.

## Environment Variables

Set these environment variables to configure the chatbot:

```bash
# OpenAI API Configuration
export OPENAI_API_KEY="your_openai_api_key_here"
export LLM_API_URL="https://api.openai.com/v1/chat/completions"
export LLM_MODEL="gpt-3.5-turbo"

# Application Configuration
export BASE_URL="http://localhost:3000"
```

## Configuration Priority

The chatbot uses the following priority order for configuration:

1. **Environment Variables** (highest priority)
2. **Config File** (`config/default.yml`)
3. **Default Values** (lowest priority)

## System Prompt

The chatbot uses the system prompt from `config/default.yml` as a base and enhances it with advanced capabilities:

- **Base Prompt**: Uses `application.chatBot.systemPrompt` from config
- **Enhanced Features**: Adds database schema, SQL queries, Linux commands, etc.
- **Customizable**: You can modify the base prompt in the config file

## Example Configuration

### Development
```bash
export OPENAI_API_KEY="sk-your-key-here"
export BASE_URL="http://localhost:3000"
```

### Production
```bash
export OPENAI_API_KEY="sk-your-key-here"
export BASE_URL="https://your-domain.com"
export LLM_MODEL="gpt-4"
```

## Available Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | Your OpenAI API key | Empty (required) |
| `LLM_API_URL` | OpenAI API endpoint | `https://api.openai.com/v1/chat/completions` |
| `LLM_MODEL` | OpenAI model to use | `gpt-3.5-turbo` |
| `BASE_URL` | Application base URL | `http://localhost:3000` |

## Config File Alternative

You can also configure these settings in `config/default.yml`:

```yaml
server:
  baseUrl: 'https://your-domain.com'

application:
  chatBot:
    llmApiKey: 'your_openai_api_key_here'
    llmApiUrl: 'https://api.openai.com/v1/chat/completions'
    llmModel: 'gpt-3.5-turbo'
    systemPrompt: |
      You are NetRunner, a helpful neural interface assistant for the Night City Cyber Store.
      # ... your custom system prompt here
```

**Note**: For security reasons, it's recommended to use environment variables for sensitive information like API keys. 