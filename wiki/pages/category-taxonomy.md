---
title: Category Taxonomy
category: meta
tags: [categories, taxonomy, structure, bootstrapping, content-guidelines]
summary: Canonical category definitions with descriptions and content guidelines for each, used by agents and the add-page skill to classify and structure wiki pages.
last-modified-by: user
---

## Overview

Every wiki page belongs to exactly one category. Categories reflect the shape of the system, not the shape of the code. When creating or populating pages — whether manually, via the add-page skill, or during batch bootstrapping — each piece of information should be examined through the lens of these categories and placed into the one where it best fits.

This page is the canonical reference. It should be linked from the sidebar under a "Meta" section and consulted by any agent or skill that creates pages.

## Categories

### architecture

**What belongs here:** System structure, component relationships, high-level design decisions, module boundaries, data flow between subsystems.

**Pages should contain:**
- What the component/system does and why it exists
- How it relates to other components (with `[[wikilinks]]`)
- Key interfaces and boundaries
- Design constraints and trade-offs
- Diagrams or ASCII art where helpful

### pipeline

**What belongs here:** Data flow and processing — how information moves through the system, transformation steps, event chains, message passing.

**Pages should contain:**
- Input → processing → output description
- Trigger conditions (what starts the pipeline)
- Error handling and retry behaviour
- Performance characteristics
- Dependencies on other pipelines or systems

### data-model

**What belongs here:** Schemas, types, storage formats, frontmatter structure, file formats, database schemas, API request/response shapes.

**Pages should contain:**
- Type definitions (TypeScript interfaces, JSON schemas)
- Field descriptions and valid values
- Relationships between types
- Serialisation format (how it's stored on disk or sent over the wire)
- Migration notes if the format has changed

### rendering

**What belongs here:** Display and presentation — how content is rendered, markdown processing, UI component behaviour, styling.

**Pages should contain:**
- What the renderer/component does
- Input format and expected output
- Custom syntax or extensions (e.g. wikilinks)
- Browser/platform considerations
- Screenshots or mockups where helpful

### testing

**What belongs here:** Test strategy, test infrastructure, coverage, testing patterns, test data management.

**Pages should contain:**
- What is tested and how
- Test commands and expected output
- Mocking strategy
- Coverage gaps and known limitations
- Test data setup/teardown

### observability

**What belongs here:** Logging, monitoring, debugging, error tracking, performance measurement.

**Pages should contain:**
- What is logged and where
- How to debug common issues
- Error codes and their meanings
- Health check endpoints
- Performance baselines

### decisions

**What belongs here:** Architectural decision records (ADRs) — why we chose X over Y, trade-offs considered, context at the time of the decision.

**Pages should contain:**
- The decision and its date
- Context — what prompted the decision
- Options considered with pros/cons
- The chosen option and rationale
- Consequences and follow-up actions

### meta

**What belongs here:** Wiki-about-the-wiki — how the wiki itself works, its structure, conventions, this taxonomy page.

**Pages should contain:**
- How things are organised
- Conventions and guidelines
- Tool usage (skills, agents, bootstrapping)
- Links to related meta pages

### ui

**What belongs here:** User interface design — layouts, components, interactions, visual design, navigation.

**Pages should contain:**
- What the UI element does
- Visual structure (ASCII mockups or descriptions)
- Interaction behaviour (click, hover, keyboard)
- States (loading, error, empty, populated)
- Relationship to API endpoints

### algorithms

**What belongs here:** Computational approaches, strategies, and heuristics used by the system — map-reduce patterns, scoring/ranking logic, conflict resolution strategies, deduplication approaches.

**Pages should contain:**
- What problem the algorithm solves
- The approach taken (with pseudocode or step descriptions)
- Inputs and outputs
- Key parameters and thresholds
- Trade-offs and alternatives considered

### functionality

**What belongs here:** Features and capabilities — what the system can do, how features work end-to-end, user-facing behaviour.

**Pages should contain:**
- What the feature does from the user's perspective
- How to use it (steps or commands)
- How it works internally (brief, link to [[architecture]] pages for depth)
- Current limitations
- Related features (with `[[wikilinks]]`)

## Usage

This taxonomy is consulted by:

- [[bootstrapping]] — to classify source files into wiki pages during batch population
- [[skills]] — the `/octowiki:add-page` skill reads this page to pick the right category

See [[content-guidelines]] for rules on avoiding content duplication across pages.
