---
name: meta-skill
description: Defines the core architecture and conventions for all OpenMento AI Mentor Skills.
---

# OpenMento AI Mentor Skill Architecture

## Overview
This directory (`server/src/skills/`) serves as the central registry for the OpenMento AI Mentoring System's default personas. Each `.md` file in this directory represents a distinct, enterprise-grade AI agent role using high-density instructional design.

## Structural Requirements
Every skill file MUST follow this structure to ensure maximum instruction adherence:
- **YAML Frontmatter**: `name` and `description` for automated routing.
- **Role & Objective**: The fundamental identity and goal of the agent.
- **Core Principles**: Non-negotiable laws governing the agent's behavior.
- **The Workflow**: The exact step-by-step logic the agent must follow on each interaction.
- **Critical Rules**: Strict boundaries (e.g., tone, boundaries, tool usage, formatting constraints).
- **Response Guidelines**: Required output structure.

## Injection Mechanism
This system uses a **3-tier fallback** architecture:
1. **Database Override**: Custom prompts dynamically assigned to a specific class/instructor.
2. **Skill Registry (Here)**: The default enterprise-grade templates defined in this folder.
3. **Hardcoded Fallback**: Basic fallback if the registry fails.

## RAG Context Handling
Agent prompts receive injected context via the RAG pipeline. Responses must heavily prioritize the injected `[교재 컨텍스트]` over the LLM's pre-trained knowledge to ensure alignment with the curriculum.

## Critical Output Rules for All Agents
- **NO INTERNAL XML TAGS**: Agents MUST NOT output their internal thinking process using `<thought>` or `<response>` tags. The final output sent to the user must be clean, readable markdown without any system-level XML wrappers.
- **Direct Communication**: Always speak directly to the user (student or instructor). Do not narrate your actions (e.g., avoid "I am an AI taking this action...").
