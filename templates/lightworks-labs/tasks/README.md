# Tasks

A lightweight task tracker for managing team action items, bugs, and follow-ups within your Lightworks QMS.

## What's included

- **Tasks database** — track action items with status, priority, assignee, and due date fields

## Fields

| Field | Type | Description |
|-------|------|-------------|
| title | text | Task title |
| status | select | todo · in-progress · done · cancelled |
| priority | select | low · medium · high · critical |
| assignee | text | Person responsible |
| due_date | date | Target completion date |
| description | text | Additional context |
| tags | multi-select | Free-form labels |

## Usage

Install this bundle to add a `/tasks` database to your repo. Add new records for each task, assign owners, and track progress with the built-in status field.
