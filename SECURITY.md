# Security Policy

Aph repackages stock Firefox and injects scripts into browser chrome, so
we treat vulnerability reports as high priority.

## Reporting a vulnerability

- **GitHub:** use
  [private vulnerability reporting](https://github.com/aph-browser/aph/security)
  on the `aph-browser/aph` repository (preferred).
- **Mirror users:** file reports on GitHub, never on the read-only GitLab
  mirror.

Please include: Aph version, Firefox base version (`about:support` or
`build/firefox/application.ini`), OS, and steps to reproduce.

## What to expect

We aim to acknowledge reports within 72 hours. Verified fixes ship with
the next release and are credited in the release notes unless you ask
otherwise. Please do not disclose issues publicly until a fix is out.

## Scope

In scope: `scripts/` (fetch, rebrand, patcher), `branding/` injected
scripts, `config/` defaults, `packaging/`, CI workflows. Upstream Firefox
vulnerabilities belong to Mozilla (Bugzilla); bundled-Firefox issues in an
Aph release still belong here so we can rebase and ship.
