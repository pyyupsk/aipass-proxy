# Security Policy

## Supported Versions

Only the latest release is supported. Update to the newest binary via the [install script](../README.md#updating) before reporting an issue.

## Reporting a Vulnerability

Do not open a public issue for security vulnerabilities.

Report privately via [GitHub Security Advisories](https://github.com/pyyupsk/aipass-proxy/security/advisories/new) or email <contact@fasu.dev>. Include steps to reproduce and affected version. You should get a response within a few days.

Given this project handles AIPass session tokens, treat any issue involving token storage, transmission, or exposure (e.g. `~/.config/aipass-proxy/.env` permissions, logging, or upstream request handling) as high priority.
