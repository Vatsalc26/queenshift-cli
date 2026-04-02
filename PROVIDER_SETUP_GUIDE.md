# Provider Setup Guide

This guide helps you configure an AI provider (Gemini or OpenAI) for Queenshift CLI.

## What Is a Provider?

A **provider** is the AI service that powers Queenshift's coding assistance. Queenshift supports:

- **Gemini** (Google's AI) - via CLI OAuth, API key, access token, or ADC
- **OpenAI** - via API key

You need to set up at least one provider before Queenshift can run coding tasks.

## Prerequisites

Before setting up a provider, make sure you have:

1. Queenshift CLI installed or a checked-out repo
2. Node.js installed (for checked-out repo path)
3. An account with either:
   - Google Cloud (for Gemini), or
   - OpenAI

## Start Here: Quick Check

If you're not sure where to start, run this diagnostic command:

```powershell
npm.cmd run owner:provider:diagnose
```

**What this does:** Checks your current provider setup and tells you what's missing or ready.

**What to look for:** The output will show:
1. **Detected provider** - which AI service Queenshift found
2. **Auth mode** - how it's authenticating
3. **Transport** - the connection method
4. **Retry policy** - how failures are handled
5. **Next step** - what to do next

If the diagnostic shows a working provider, you're ready to use Queenshift. If not, follow the setup instructions below.

---

## Provider Setup Paths

Choose the path that matches your situation:

### Path 1: Gemini CLI OAuth (Easiest for Google Users)

If you have the Gemini CLI installed and authenticated, Queenshift can use it directly.

**How to verify it works:**
```powershell
npm.cmd run owner:provider:diagnose
```

If Gemini CLI OAuth is detected, you're done.

### Path 2: Gemini API Key

1. Get an API key from [Google AI Studio](https://aistudio.google.com/apikey)
2. Set it as an environment variable:
   ```powershell
   $env:GEMINI_API_KEY = "your-api-key-here"
   ```
3. Run the diagnostic to verify:
   ```powershell
   npm.cmd run owner:provider:diagnose
   ```

### Path 3: Gemini Access Token + Project

For users with Google Cloud project access:

1. Set your Google Cloud project:
   ```powershell
   $env:GOOGLE_CLOUD_PROJECT = "your-project-id"
   ```
2. Set your access token:
   ```powershell
   $env:GEMINI_ACCESS_TOKEN = "your-access-token"
   ```
3. Run the diagnostic to verify:
   ```powershell
   npm.cmd run owner:provider:diagnose
   ```

### Path 4: Gemini ADC (Application Default Credentials)

If you have Google Cloud ADC configured:

1. Make sure your ADC is set up (see [Google Cloud ADC docs](https://cloud.google.com/docs/authentication/provide-credentials-adc))
2. Set your project:
   ```powershell
   $env:GOOGLE_CLOUD_PROJECT = "your-project-id"
   ```
3. Run the diagnostic to verify:
   ```powershell
   npm.cmd run owner:provider:diagnose
   ```

### Path 5: OpenAI API Key

1. Get an API key from [OpenAI](https://platform.openai.com/api-keys)
2. Set it as an environment variable:
   ```powershell
   $env:OPENAI_API_KEY = "your-api-key-here"
   ```
3. Run the diagnostic to verify:
   ```powershell
   npm.cmd run owner:provider:diagnose
   ```

---

## Verification Commands

After setting up your provider, run these commands to verify everything works:

### Quick Checks (Run in Order)

1. **First diagnostic:**
   ```powershell
   npm.cmd run owner:provider:diagnose
   ```
   Shows what provider is detected and its status.

2. **Check defaults:**
   ```powershell
   npm.cmd run verify:owner:provider-defaults
   ```
   Verifies the fallback and default settings are correct.

3. **Smoke test:**
   ```powershell
   npm.cmd run verify:owner:smoke
   ```
   Runs a quick test to make sure the provider can respond.

4. **Resilience test:**
   ```powershell
   npm.cmd run verify:provider:resilience
   ```
   Tests how the provider handles failures.

### Recommended Order for Troubleshooting

1. Run `owner:provider:diagnose` first to see the current state
2. Check the retry policy in the output before changing credentials
3. Use `verify:owner:provider-defaults` if the fallback path looks wrong
4. Use `verify:owner:smoke` for a quick live test
5. Use `verify:provider:resilience` if failures seem transport-related

---

## Understanding the Output

### Detected Provider
Shows which AI service Queenshift will use. If blank or "none", no provider is configured.

### Auth Mode
How you're authenticating:
- **OAuth** - using a logged-in session (Gemini CLI)
- **API Key** - using a static key
- **ADC** - using Google Cloud credentials

### Transport
The method used to communicate with the provider. If this shows errors, check your network or credentials.

### Retry Policy
How Queenshift handles temporary failures. This should show bounded (limited) retries, not infinite loops.

---

## Fallback Policy

Queenshift has explicit rules about provider fallback:

1. **Provider fallback is always visible** in diagnostics and output
2. **Transport changes are shown** - you'll know if Queenshift switches between transport methods
3. **Retries are bounded and visible** - no infinite retry loops
4. **No silent provider switching** - Queenshift won't switch from Gemini to OpenAI without telling you
5. **If fallback looks wrong, stop** - run `verify:owner:provider-defaults` and `verify:provider:resilience` before assuming the problem is your code

---

## Safety Boundaries

Queenshift follows these fail-closed (safe by default) principles:

1. **No hidden credential storage** - credentials are read from environment variables or your existing auth setup
2. **Missing credentials are visible** - you'll see errors, not silent failures
3. **Live runs require explicit setup** - Queenshift won't start a live run until a provider is confirmed ready

---

## Common Issues

### "No provider detected"
- Make sure your environment variable is set correctly
- Run `echo $env:OPENAI_API_KEY` (PowerShell) or `echo $OPENAI_API_KEY` (bash) to verify
- For Gemini CLI OAuth, make sure you've run `gemini auth login` first

### "Transport error"
- Check your network connection
- Verify your API key hasn't expired
- Try running `verify:provider:resilience` to see detailed error messages

### "Wrong provider detected"
- Unset the environment variable for the provider you don't want to use
- Make sure only one provider's credentials are set

---

## Getting Help

If you're still stuck after following this guide:

1. Run `npm.cmd run owner:provider:diagnose` and save the output
2. Check the [docs/](./docs/) folder for additional documentation
3. Open an issue on GitHub with your diagnostic output (remove any sensitive values first)