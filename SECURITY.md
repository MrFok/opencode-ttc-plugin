# Security Policy

## Reporting a Vulnerability

If you discover a security issue, do not open a public issue.

Please report details privately to the maintainer via GitHub security advisory:

- Go to the repository `Security` tab
- Click `Report a vulnerability`

Include:

- Affected version(s)
- Reproduction steps
- Impact assessment
- Suggested remediation if available

## Response Targets

- Initial acknowledgement: within 7 days
- Triage decision: within 14 days
- Fix timeline: depends on severity and release impact

## Scope

This project is an OpenCode plugin and CLI installer helper. Reports should focus on:

- Secret exposure risks (API keys, prompt content)
- Unsafe network behavior
- Command/installer path safety
- Plugin hook behavior that could break OpenCode session safety
