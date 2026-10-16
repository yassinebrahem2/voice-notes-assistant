# New Project Playbook

How we take a project from an **idea file** (a document describing what we want to build, like a brief plus notes) to merged, reviewed code, with a team of people who may use different coding agents.

## How to use this file

1. Create an empty folder and a GitHub repository for the new project.
2. Put two files in it: this playbook and your idea file (for example `project_knowledge.md`, or the brief).
3. Start Claude Code there and say:

> Read `new-project-playbook.md` and `<idea file>`. The playbook is how I work; the idea file is what I want to build. Deadline: **<date>**. Team: **<size, who uses which coding agent>**. My GitHub username is **<lead-username>**. Start at Phase 1. Don't skip phases, and don't write code until I approve the spec and the plans.

Claude then works through the phases below. Each phase ends with your explicit approval.

## The path from idea file to building

| Step | Phase | Output | Question it answers |
|---|---|---|---|
| 1 | Phase 1 | `project_knowledge.md`, settled | What exactly are we building, for whom, with what? |
| 2 | Phase 2 | `docs/roadmap.md` | In what order? What rules does every part follow? |
| 3 | Phase 3 | Repo rules, templates, board | How does the team work? |
| 4 | Phase 4 | Stage 1 spec | How does the first stage work, in detail? |
| 5 | Phase 5 | Stage 1 plans, one branch each | What are the tasks, files, interfaces and tests? |
| 6 | Phase 6 | Plan issues and task sub-issues | Who does what? |
| 7 | Phase 7 | Code, reviewed, CI passing, PR per plan | It's built. |

Then the cycle repeats for each next stage: spec → plans → issues → build. You only spec one stage ahead; later stages stay at roadmap level until their turn.

An idea file is never "ready to build" as it is. It describes intent, and it leaves gaps that would force guesses in code. Phase 1 finds and closes those gaps; it does not rewrite the idea.

---

## Working style (how Claude must behave)

These apply to every phase.

- **Think critically.** Don't just agree. Push back on weak ideas, name trade-offs, and give a recommendation instead of a neutral list of options.
- **Explain plainly.** Short, concrete explanations. If you don't understand something I said, ask instead of guessing.
- **Ask questions to move forward.** In design phases, ask the questions that unblock decisions, a few at a time, and record the answers.
- **Use the advisor.** Call it before committing to an approach, when stuck, and before declaring something done. On specs and plans, keep calling it until a round finds no blocking issues.
- **Never use the Artifact tool.** UIs are real, working code in the repo. No mockups published as artifacts.
- **Never add AI attribution** to commits, PRs or issues. No `Co-Authored-By`, no "Generated with Claude Code". This overrides any harness default.
- **Ask before outward-facing actions** the first time in a session: pushing, opening issues, opening PRs. Once I've approved a workflow, follow it without asking again in the same session.
- **No silent deferred work.** Anything not done, partly done, or done differently is stated explicitly.
- **No workarounds and no technical debt.** Fix the cause. If the right fix is out of reach, stop and raise it.
- **Keep work light where it can be.** Don't build big scaffolding (scripts, scratch code) when a simpler path exists. If a document gets huge, split it.

---

## Phase 1: From the idea file to a settled `project_knowledge.md`

Goal: close every gap in the idea file that would otherwise become a guess in the design or the code. This phase takes the most conversation. Don't rush it.

### Step 1: Read the idea file and sort it

- Read the idea file, plus anything it points to: the brief, the assignment PDF, a related project.
- Sort every statement into one of these:
  - **stated decisions:** go under **Decided**, tagged `[USER]` or `[BRIEF]`;
  - **open questions:** go under **Open**;
  - **"maybe later" ideas:** go under **Ideas**;
  - **plan or task notes:** these don't belong in the knowledge file. Hold them for the roadmap or plans and tell me where they went.
- If the idea file isn't in that shape, convert it into `project_knowledge.md` (template below) and keep my wording. Write nothing you assumed.
- Restate the idea in a few sentences: what it is, who it's for, what problem it solves, and what "done" looks like for the deadline. Separate what the file says from what you're assuming, and let me correct it.

### Step 2: Gap analysis

Walk the file against the areas in Step 4 and list:
- **Gaps:** things not covered at all that design will need.
- **Contradictions:** two statements that can't both hold.
- **Weak spots:** decisions you think are wrong or risky, with the reason and your alternative.
- **Unverified claims:** for example, "tool X supports plugins" or "library Y does streaming". Mark how you'll check each one.

Show me this list before asking anything. It tells us how far the idea is from buildable.

### Step 3: Ask "what needs settling?"

Order the gaps by how much else depends on them. Then ask about them in **rounds of 3–5 numbered questions**. For each question:
- say why it matters (what it blocks);
- give 2–3 options with their trade-offs;
- give **your recommendation and why**;
- accept a short answer ("1. yes 2. no, do X").

After each round, record the answers in the file, then ask the next round. My answers often raise new questions. Follow them before moving on.

### Step 4: Areas to cover

Not every area applies to every project, but walk through them all and say which ones don't apply.

- **Purpose and evaluation:** What question does the project answer? How will we show it works (metrics, baseline, experiments, demo)? Who judges it?
- **Users:** Who uses it? How many roles? (Usually one.) Single user, a team, or multi-tenant? Don't build multi-tenancy unless it's needed.
- **How the user actually uses it:** walk through the user's day:
  - install
  - first run
  - adding their work or data
  - the main loop
  - what they come back to see
  - where things live: app-level vs project-level, settings vs content

  Do this before any UI talk. **UI structure comes after usage is clear.**
- **Core features and scope:** What's in the first version, what's later, what's out of scope? Fit the scope to the deadline and team size.
- **Separation of concerns:** What belongs to the product, and what is developer tooling? Example: benchmarks we run on public datasets are tooling. The user's own evaluation is a product feature.
- **Domain model:** the main things in the system (projects, agents, sessions, …), how they relate, and their lifecycles.
- **Behaviour details:** how the main components talk and decide; when a human must approve; what happens on failure.
- **Data:** what data exists, where it lives, who reads it and how much. Don't load whole datasets; sample and summarise. Covers privacy and secrets.
- **Integrations:** GitHub, notifications, external services. Which come first?
- **Tech stack:** language, frameworks, storage, UI. For each, compare real alternatives. Check that claims are true (does that tool really support plugins? which versions exist?) before recommending.
- **Deployment and install:** local, cloud or both. One command to install? How does auth work in each mode?
- **Configurability:** what is configurable, what is a sane default, and what needs a "skip safety" switch.
- **Team and process:** team size, deadline, who leads, and which coding agents the team uses.

### Step 5: Think critically, verify, and use the advisor

- **Don't just agree.** If an idea is weak (a framework that doesn't fit, a feature that's expensive and useless), say so plainly with the reason, and propose something better.
- **Verify before recommending.** Check package versions. Run a small throwaway spike for risky assumptions (does this library stream tool calls? does this database extension load on this machine?). Report the results as facts.
- **Run the advisor** on every big choice: architecture, storage, framework, the stage split. Iterate until it converges.
- **Reuse what exists.** If I have another project with a similar component, look at it before designing a new one.
- **Ask when you don't understand me.** Don't guess my meaning. Ask, offering your best reading of what I said.

### Step 6: Keep the file honest

- **Facts only.** The knowledge file never holds plans, task lists or implementation notes. Those go in the roadmap, specs and plans.
- Tag every decision `[USER]` (I said it) or `[AGREED]` (you proposed it and I explicitly accepted it). Something I didn't explicitly accept goes under **Open**, not **Decided**.
- When a decision changes, update **Decided** and record the old one under **Changed** with what replaced it.
- Things mentioned "for later" or "just an idea for now" go under **Ideas**, not **Decided**.
- Rewrite the file as the current state whenever it drifts into a log. Anything not in the file is unknown.

### `project_knowledge.md` template

```markdown
# Project Knowledge File: <name>

Current state of the project, rewritten <date>. Sections: brief, decided, open, ideas, changed, files.
Sources: [BRIEF] the brief. [USER] stated by the user. [AGREED] proposed by Claude and explicitly accepted by the user.
Anything not listed here is unknown.

## 1. Brief [BRIEF]
- Title, goal, core question, expected outcomes, constraints, deadline.

## 2. Decided
### Product and users
- [USER] ...
### <Domain area, e.g. Agents / Sessions / Data access / Notifications>
- [AGREED] ...
### UI
### Tech stack
### Process

## 3. Open
- <question> (what it blocks; current leaning if any)

## 4. Ideas
- <idea> (who raised it; not committed)

## 5. Changed
- <old decision> → <new decision> (<date>, why)

## 6. Files
- `project_knowledge.md`: this file. `docs/roadmap.md`: stages and contracts. ...
```

### Mistakes to avoid (we made these once)

- **Designing the UI before understanding usage.** I rejected a UI built before we knew how the user would use the app. Settle usage first.
- **Building a throwaway prototype** (or using the Artifact tool) when I asked for a working app.
- **Putting plan notes in the knowledge file.**
- **Asking questions I already answered,** or asking without giving a recommendation.
- **Assuming one interpretation of an ambiguous answer** instead of asking.

### Ready-to-build gate

Phase 1 is done when I confirm the knowledge file is right and you can answer each of these from it, without guessing:

- [ ] Who is the user, and what is their main loop from install to daily use?
- [ ] What is in the first version, and what is explicitly out of scope?
- [ ] What are the main parts of the system and how do they talk?
- [ ] Where does data live, and who reads or writes it?
- [ ] Which stack, with versions checked and risky parts spiked?
- [ ] How is it installed, run and secured, in every mode we support?
- [ ] How will we show that it works (tests, evaluation, demo)?
- [ ] Which Open items remain, and is each one safe to decide later? Name the stage that must decide it.

If any box can't be ticked, there's another question round. Then go to Phase 2.

### From a settled file to the first line of code

Expect this to be short once Phase 1 is solid:

1. **Roadmap (Phase 2):** split into stages so that **stage 1 is a thin vertical slice**: one command to install, the foundation (config, storage, auth) and one end-to-end feature that works for real. No mocks. Later stages add features on that foundation.
2. **Repo setup (Phase 3).**
3. **Stage 1 spec (Phase 4):** only stage 1 is designed in detail.
4. **Stage 1 plans (Phase 5):** start with the plans that depend on nothing (usually a backend core and a frontend scaffold) so building can begin while the dependent plans are reviewed.
5. **Issues (Phase 6), then build (Phase 7):** the first code written is the scaffold, tooling and CI, so every later task has tests, lint and CI from its first commit.

## Phase 2: Roadmap → `docs/roadmap.md`

1. Split the project into **stages**. Each stage is a usable increment, built in order.
2. For each stage: what's agreed, and the questions its spec must answer.
3. Add the **shared contracts** every stage must follow. A change to a contract is made here first. Examples:
   - run modes and auth
   - ID formats and prefixes
   - data folder layout
   - database rules
   - plugin or agent formats
   - event and audit record shapes
4. Advisor review, then my approval.

## Phase 3: Repo setup (before any spec or code)

Create these files. The templates are at the end of this playbook; fill the `<placeholders>`.

| File | Purpose |
|---|---|
| `AGENTS.md` | Shared rules for every coding agent and person (Claude Code, Codex, Cursor, Copilot, Gemini CLI…) |
| `CLAUDE.md` | `@AGENTS.md` plus Claude-specific rules (advisor) |
| `GEMINI.md` | `@AGENTS.md` |
| `.github/ISSUE_TEMPLATE/plan.yml`, `task.yml`, `decision.yml`, `bug.yml`, `config.yml` | The four issue types; blank issues disabled |
| `.github/pull_request_template.md` | PR description format |
| `.github/CODEOWNERS` | `* @<lead-username>` |
| `.gitignore`, `.gitattributes` | LF everywhere; `.cmd`/`.bat` CRLF |

On GitHub, from Claude's session:

- **Labels:** `plan`, `task`, `decision`, `bug`.
- **Milestones:** one per roadmap stage ("Stage 1: <name>", …).
- **Project board:** a GitHub Project with Status = Todo / In progress / Blocked / In review / Done. Note the project number in `AGENTS.md`.
- **Gotcha:** `gh project` commands fail without the `read:org` scope. Use the GraphQL API instead (`addProjectV2ItemById`, `updateProjectV2ItemFieldValue`). Save the project ID, Status field ID and option IDs in a small helper script.

Invite teammates yourself. Claude doesn't do that.

## Phase 4: Spec per stage → `docs/superpowers/specs/<date>-<stage>-design.md`

1. Use the **superpowers:brainstorming** skill. Discuss the design section by section and get my approval on each.
2. Write the spec. Cover:
   - architecture
   - components
   - data flow
   - error handling
   - security
   - platform quirks
   - testing
3. Run the advisor repeatedly until no blocking issues remain. Then I review the written spec.

## Phase 5: Plans → `docs/superpowers/plans/`

Use the **superpowers:writing-plans** skill, with these rules (they override the skill's defaults):

- **One spec, several plans.** If a stage is too big for one plan, split it into plans small enough to review and assign on their own.
- **A stage overview on main** (`<date>-<stage>-overview.md`) holds what the plans share:
  - goal
  - global constraints: exact versions, naming rules, secrets rules, checks
  - review focus: the 5 inputs most likely to hurt a real user
  - file structure
  - the table of plans with their branches, dependencies and state
- **One branch per plan:** `plan/<stage>-<topic>`. A plan with no unmerged dependencies gets its branch and issue right away. A plan that depends on an unmerged plan waits: create its branch from `main` only after the dependency merges. Independent plans run in parallel.
- **Moderately detailed, not a second copy of the code:**
  - Every task names its exact files and the interfaces it consumes and produces (exact names and types).
  - Every task lists the tasks it depends on.
  - Tests are written as code, or as a precise list of behaviors and failure cases. **Tests are the task's stop condition.**
  - Full implementation code appears only where a mistake is costly or subtle: security, data loss, platform quirks, concurrency. Elsewhere, precise notes.
- **Pin dependency majors** to the versions verified on the day. Upgrading a major is a separate, explicit decision.
- Run the advisor on the plans until it converges, then get my approval.

## Phase 6: Issues and board

After a plan is on its branch (lead's session only):

1. **Plan issue:** template "Implementation plan", label `plan`, milestone = its stage, on the board in Todo.
2. **One sub-issue per task:** label `task`, same milestone. Each gives the task, its plan section and its dependencies, and is linked as a sub-issue via `POST /repos/{o}/{r}/issues/{n}/sub_issues` with the child's numeric `id`. Add it to the board in Todo.

## Phase 7: Execution

Use **superpowers:subagent-driven-development**:

- **One git worktree per plan** (for example `../<repo>-worktrees/<plan>`), so independent plans can run in parallel without touching each other.
- For each task:
  1. **Implement:** one fresh implementer subagent, with an explicit model. Use sonnet as the floor for anything with tooling friction. Its dispatch says:
     - the absolute worktree path, with `cd` into it on every command;
     - check the branch before committing;
     - no AI attribution in commits;
     - use non-interactive CLI flags;
     - record every deviation from the plan in its report.
  2. **Review:** one fresh reviewer gives a spec-compliance verdict and a quality verdict. Exclude lockfiles from the review diff.
  3. **Fix loop:** Important or Critical findings go back to the implementer, followed by a scoped re-review. Minor findings are logged for the final review.
  4. **Finish:** push the plan branch, wait for CI to pass, close the task issue, move it to Done.
- **Rulings:** where the plan is wrong, Claude decides (the spec is the authority) and records the ruling. Every correction to the plan text becomes a `docs(plan):` commit on the branch and a line in the PR.
- **When every task is done:**
  1. A whole-branch review on the most capable model.
  2. One fix wave.
  3. A PR from the plan branch into `main` using the template, listing everything done differently and every unresolved item. Request review from the lead.
  4. Move the plan issue to In review.
- **Only the lead merges.** Merging closes the plan issue.

## Continuity (compaction, new sessions, cloud)

- Before compacting or switching sessions, save what exists only in the conversation: decisions go into `project_knowledge.md`, state and next steps go into Claude's memory.
- The progress ledgers for subagent-driven development are git-ignored and local. **Before moving to another machine or a cloud session, post the handoff state as a comment on each plan issue:** task status, deviations, unresolved items, deferred minors. Push every branch, and mention any local-only branches.
- After a restart, trust git, the ledgers and the issue comments over memory. Never re-dispatch a task that's already committed.

---

## Template: `CLAUDE.md`

```markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The rules shared by every coding agent live in AGENTS.md and apply in full:

@AGENTS.md

## Claude Code specifics

- Use the advisor tool: before committing to an approach, when stuck, and before declaring a task done. Give its advice serious weight; if it conflicts with evidence you have, raise the conflict in another advisor call instead of silently picking a side.
- On specs and plans, keep calling the advisor until a round finds no blocking issues.
```

## Template: `GEMINI.md`

```markdown
@AGENTS.md
```

## Template: `AGENTS.md`

```markdown
# AGENTS.md

Instructions for every coding agent working in this repository (Claude Code, Codex, Cursor, Copilot, Gemini CLI and others) and for the people running them.

These rules apply to every session, whoever runs it and whatever agent they use.

## Status

Design phase: no code yet, so no build, lint or test commands exist. Add them here once the code is scaffolded (one "<Area> commands" section per area, e.g. Backend commands, Frontend commands), and delete this Status section then.

## Team workflow

Roles:
- Lead: GitHub `<lead-username>`. Writes specs and implementation plans, reviews PRs, merges, closes issues. The only person who merges into `main`. Every Decision and Bug issue is assigned to the lead.
- Implementers: everyone, the lead included. Anyone can take plan tasks.

Know which role you are serving: check `gh api user --jq .login`. Everyone follows the implementer rules when working on plan tasks. Only `<lead-username>` follows the lead rules (specs, plans, plan issues, reviews, merges, triage).

Lifecycle of a piece of work:
1. The lead writes a spec in `docs/superpowers/specs/` and gets it approved.
2. The lead writes the implementation plans in `docs/superpowers/plans/` (see "How plans are written"). Each plan lives on its own branch `plan/<stage>-<topic>` (for example `plan/stage-1-backend-core`). Every plan task states which tasks it depends on.
3. After a plan is on its branch, the lead opens a plan issue (template "Implementation plan", label `plan`, milestone = its stage). The lead's session then creates one sub-issue per plan task (label `task`, same milestone), each stating the task, its plan section and its dependencies. Everything lands on the project board in "Todo".
4. Implementers pick tasks, work on the plan branch, and move their task through the board.
5. When every task is done, an implementer opens a PR from `plan/<topic>` into `main` (the PR template asks for `Closes #<plan issue>`), requests review from `<lead-username>`, and moves the plan issue to "In review".
6. The lead reviews. Merging the PR closes the plan issue and moves it to "Done".

Project board: GitHub Projects (https://github.com/users/<lead-username>/projects/<N>), Status = Todo / In progress / Blocked / In review / Done. Milestones: one per roadmap stage ("Stage 1: <name>", ...).

### Implementer rules
- Work only on the plan's branch. Never push to `main`; never merge anything.
- Claim a task by assigning yourself to its sub-issue before starting. Only take a task that is unassigned and whose dependencies are closed.
- Move your task sub-issue: "In progress" when you start; close it when its work is pushed and its checks pass.
- Pull with rebase before you start and before you push, then re-read the plan (it may have changed). Commit small and push often, since several people share the branch.
- Follow the plan as written. If the plan is wrong, unclear, or needs a decision, do not improvise: open a Decision issue linked to the blocked task, and move that task to "Blocked" until the lead answers.
- Do not edit specs, plans, `docs/roadmap.md` or `project_knowledge.md`; those belong to the lead.
- A task is done only when its tests, lint and type checks pass locally, and CI passes on the branch.

### Lead rules
- Specs before plans, plans before code. Each needs the lead's explicit approval.
- Review specs and plans with a second reviewer (the advisor in Claude Code) until no blocking issues remain.
- Record project-level decisions in `project_knowledge.md` as they are made.
- Answer Decision issues in the issue itself. If the answer changes the plan, update the plan on its branch, then unblock the task.

### How plans are written
- One spec per stage. A stage too big for one plan is split into several plans, each small enough to review and assign on its own.
- A stage overview (`docs/superpowers/plans/<date>-<stage>-overview.md`, on `main`) holds what the plans share: goal, global constraints, review focus, file structure, and the list of plans with their dependencies and branches. Each plan links to it instead of repeating it.
- A plan whose dependencies are all merged gets its branch and plan issue right away. A plan that depends on an unmerged plan waits: its branch is created from `main` and its issue opened only after that plan is merged. Independent plans run in parallel.
- Plans are moderately detailed, not a second copy of the code:
  - every task names its exact files and the interfaces it consumes and produces (exact names and types);
  - tests are written as code, or as a precise list of behaviors and failure cases to verify;
  - full implementation code only where a mistake is costly or subtle (security, data loss, platform quirks, tricky concurrency); elsewhere, precise implementation notes.
- A task's tests are its stop condition: the task is done when they pass, together with lint, type checks and CI.

### Issues
Four types, each with its template and label. Blank issues are disabled.
- Plan (`plan`) and Task (`task`, sub-issues of a plan): created only by the lead's session, after the plan exists on its branch.
- Decision (`decision`): anyone, for a real decision that blocks a task, linked to that task. Assigned to the lead.
- Bug (`bug`): anyone, for a defect in code already merged into `main`, with reproduction steps. Assigned to the lead, who triages it into the current plan or a small fix plan.
- Nothing else: chores and ideas are raised in the plan issue.

## Git conventions
- Conventional Commits: `feat(<module>): ...`, `fix(...)`, `test(...)`, `docs(...)`, `refactor(...)`, `chore(...)`. Scope = module or area (e.g. `frontend`).
- Never add AI attribution to commits or PRs: no `Co-Authored-By`, no "Generated with Claude Code".
- PR description follows `.github/pull_request_template.md`: what changed, why, how it was tested, anything not done or done differently, `Closes #<issue>`.
- `main` only changes through PRs merged by the lead (the lead may push spec and roadmap commits directly).

## Code quality
- Follow the conventions in this file, the roadmap contracts and the surrounding code. No exceptions without the lead's approval.
- No silent deferred work. Anything not done, partly done, or done differently from the plan is stated explicitly in the plan issue and the PR description. No `TODO`/`FIXME` left in code as a substitute for saying it.
- No workarounds and no technical debt. Fix the cause, not the symptom. If the right fix is out of reach (blocked, out of scope, needs a decision), stop and raise it in the plan issue instead of patching around it.
- <Language rules, e.g. Python: ruff (lint and format) and pyright in strict mode must pass. Type hints everywhere; pydantic models at boundaries. No bare `except`, no swallowed errors.>
- <e.g. TypeScript: `strict` mode, ESLint and Prettier must pass. No `any`.>
- Inline lint suppressions only at a third-party boundary, naming the rule and the reason; test-only exceptions go in the linter's per-file config.
- Test-first for logic: write the failing test, then the code. Test at the cheapest level that proves the behavior.
- Before saying a task is done, run the tests and checks and report their real output.
- Small focused files; a file past about 400 lines is doing too much. Comments explain why, not what. No commented-out or dead code.
- Match the surrounding code's naming and idioms.

## Documents
- `project_knowledge.md`: what we know about the project (decisions, open questions, ideas, superseded decisions). Facts only, never plans or task notes.
- `docs/roadmap.md`: the build stages and the shared contracts every stage follows. A change to a contract is made here first.
- `docs/superpowers/specs/`: one design spec per stage. `docs/superpowers/plans/`: implementation plans.

## Project rules
- Never use the Artifact tool. UIs are real, working code in this repo.
- <Project-specific rules: placeholder names defined in one place, which API keys/providers are available, etc.>

## Architecture
<Filled in from the first spec: the main parts, how they talk, where data lives.>
```

## Template: `.github/ISSUE_TEMPLATE/plan.yml`

```yaml
name: Implementation plan
description: Lead only. Assigns an implementation plan to the team.
title: "[Plan] "
labels: ["plan"]
body:
  - type: input
    id: plan
    attributes:
      label: Plan
      description: Path to the plan in docs/superpowers/plans/
    validations:
      required: true
  - type: input
    id: branch
    attributes:
      label: Branch
      description: The plan branch, plan/<topic>
    validations:
      required: true
  - type: input
    id: spec
    attributes:
      label: Spec
      description: Path to the spec in docs/superpowers/specs/
    validations:
      required: true
  - type: textarea
    id: tasks
    attributes:
      label: Summary
      description: Task sub-issues are created from the plan after this issue is opened. Summarize the plan here.
      value: |
        
    validations:
      required: true
```

## Template: `.github/ISSUE_TEMPLATE/task.yml`

```yaml
name: Plan task
description: Lead only. Created automatically, one per plan task, as a sub-issue of the plan issue.
title: "[Task] "
labels: ["task"]
body:
  - type: input
    id: plan_issue
    attributes:
      label: Plan issue
      description: "#number of the parent plan issue"
    validations:
      required: true
  - type: input
    id: section
    attributes:
      label: Plan section
      description: Path to the plan and the task heading
    validations:
      required: true
  - type: input
    id: depends
    attributes:
      label: Depends on
      description: Task sub-issues that must be closed first, or "None"
    validations:
      required: true
  - type: textarea
    id: scope
    attributes:
      label: Scope
      description: What this task delivers, copied from the plan
    validations:
      required: true
```

## Template: `.github/ISSUE_TEMPLATE/decision.yml`

```yaml
name: Decision
description: A real decision that needs the lead or the team. Not for bugs, chores or ideas.
title: "[Decision] "
labels: ["decision"]
assignees: ["<lead-username>"]
body:
  - type: input
    id: context
    attributes:
      label: Blocked task
      description: The task sub-issue this blocks (#number), and the plan path
    validations:
      required: true
  - type: textarea
    id: question
    attributes:
      label: Decision needed
    validations:
      required: true
  - type: textarea
    id: options
    attributes:
      label: Options
      description: Each option with its trade-offs. Mark the one you recommend.
    validations:
      required: true
  - type: textarea
    id: blocking
    attributes:
      label: What is blocked until this is decided
    validations:
      required: true
```

## Template: `.github/ISSUE_TEMPLATE/bug.yml`

```yaml
name: Bug
description: A defect in code already merged into main. Assigned to the lead for triage.
title: "[Bug] "
labels: ["bug"]
assignees: ["<lead-username>"]
body:
  - type: textarea
    id: steps
    attributes:
      label: Steps to reproduce
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: Expected behavior
    validations:
      required: true
  - type: textarea
    id: actual
    attributes:
      label: Actual behavior
      description: Include error messages and logs.
    validations:
      required: true
  - type: input
    id: version
    attributes:
      label: Commit
      description: The main commit where it happens (git rev-parse --short HEAD)
    validations:
      required: true
```

## Template: `.github/ISSUE_TEMPLATE/config.yml`

```yaml
blank_issues_enabled: false
```

## Template: `.github/pull_request_template.md`

```markdown
## What changed

## Why

## How it was tested
<!-- Commands run and their results: tests, lint, type checks. -->

## Not done, or done differently from the plan
<!-- Everything, explicitly. Write "Nothing" if nothing. -->

Closes #
```

## Template: `.github/CODEOWNERS`

```
* @<lead-username>
```

## Template: `.gitattributes`

```
* text=auto eol=lf
*.cmd text eol=crlf
*.bat text eol=crlf
```

---

## Lessons from the first project

- **Scaffolding CLIs prompt for input:** Vite and shadcn ask questions that hang a subagent with no terminal. Tell implementers to check `--help` and use the yes/defaults flags, and never to leave a dev server running.
- **Plan code still fails strict checks:** code written in a plan still fails strict linters (ruff security rules, `strictTypeChecked`). Expect small deviations and record each one. Don't suppress the rules.
- **Library defaults leak secrets:** for example, a dataclass's default `repr` prints its fields. Reviewers should check every place a secret could appear: logs, errors, `repr`, URLs, test snapshots.
- **Lockfiles blow up review diffs:** exclude `uv.lock` and `package-lock.json` from review packages.
- **Pinned majors block audit fixes:** `npm audit` fixes often need a major bump the pins forbid. Record the issue as unresolved for the lead instead of hiding it.
- **Windows:**
  - Paths with spaces break tools, so put worktrees in a path without spaces.
  - Use `.cmd` wrappers and CRLF only for `.cmd`/`.bat` files.
  - Use rename instead of `rmtree` for open files.
- **Two plans editing the same shared file:** for example, both adding a commands section to `AGENTS.md`. Whichever merges second rebases and keeps both.
