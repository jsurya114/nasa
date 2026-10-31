<!--
Title: use the commit header format, at most 72 characters, for example
fix(journeys): use the driver's local date for new journeys

Target develop. Only develop opens pull requests into main.
AI assistants never open a pull request into main unless a team member
tells them to in the current conversation (AGENTS.md).

Merge with "Create a merge commit". Delete the feature branch after merging.
This repository is public: no secrets, real data or exploit steps here.
-->

## What

<!-- What changed, one bullet per notable change. -->

-

## Why

<!-- The problem or requirement. -->

Refs: <!-- #issue, or "none" -->

## Type of change

- [ ] Refactor only: no change to pay amounts, API responses, URLs or the database
- [ ] Bug fix
- [ ] New feature
- [ ] Docs or tooling only

## Target

- [ ] This pull request targets `develop`
- [ ] Release only: `develop` into `main`, requested by (name):

## How tested

<!-- Steps you ran and what happened: normal case, bad input, wrong role. Add a screenshot for UI changes. Say what you did not test. -->

-

## Regression checklist

<!-- CONTRIBUTING.md §6. Tick what you ran. Mark the rest "n/a" and say why. -->

- [ ] Login and logout: super admin, city admin, driver
- [ ] Driver journey start and finish
- [ ] Daily SpeedX upload
- [ ] Weekly GOFO upload
- [ ] Dashboard and payment totals match the previous result
- [ ] Mark as paid affects only the selected city

## Money and data impact

<!-- Before and after totals for any change to pay, rates, deductions or Excel imports. -->

- [ ] No effect on money or stored data
- [ ] Database change: migration steps, backup and rollback are written below
- [ ] New environment variable: name and purpose are written below

## AI-assisted

<!-- You have read every line and can explain it. -->

- [ ] Yes (tool: )
- [ ] No

## Limitations and follow-ups

<!-- Known gaps, or "None". -->

-
