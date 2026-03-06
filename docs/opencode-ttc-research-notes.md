# OpenCode + TTC Research Notes

## TTC API

- Endpoint: `POST https://api.thetokencompany.com/v1/compress`
- Request: `model`, `input`, `compression_settings.aggressiveness`
- Response: `output`, token counters
- Gzip request compression supported

## OpenCode Hooks

- `experimental.chat.messages.transform` is the right interception point for outbound text compression.
- Provider/auth resolution occurs after transform hooks.

## Key Caveat

- Plugin hook failures can bubble unless handled by plugin code.
- Plugin must catch and fail open.

## Local Reuse

- Reuse safe heuristics and retry/timeout patterns adapted from prior proxy logic.
- Keep transport bridge plugin available for edge cases.
