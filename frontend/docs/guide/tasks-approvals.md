# Tasks & approvals

Tasks are work items a workflow assigns to people. Use the inbox to act on items routed to you and to track requests you submitted.

## Task types

| Type | What you do |
| --- | --- |
| **Approval** | Approve, reject, or request changes |
| **Submit** | Fill an inline form, then submit |
| **Review** | Forward (no changes) or send back (changes required) |

## Step 1 — Open the inbox

1. How you navigate here depends on your role:
   - **Leaders (CEO, VP, Manager, HR):** Click **Approvals** in the left sidebar.
   - **Employees:** Tap **My Requests** in the bottom tab bar (or sidebar, depending on your device).
   - **Administrators:** Use **Open approval queue** on the dashboard.

   ![Tasks inbox](/screenshots/guide/tasks-inbox.png)

2. Choose a scope (if available for your role):
   - **Assigned to me** — your action queue (default for leaders/approvers).
   - **Submitted by me** — things you submitted (the My requests view).
   - **Team approvals** — team items within your access scope (see [My team](/guide/team)).

3. Optional filters: All · Pending · SLA breached · Approved · Rejected. Sort and group as needed.

**You should see:** cards or rows with SLA color (green → orange under 6h → red breached).

## Step 2 — Open a task

1. Open an item from the inbox. Completed items use **View details**.

   ![Completed request detail with private values masked](/screenshots/guide/tasks-detail.png)

   *This capture is a completed request. Available actions depend on the task's current state and your access.*

2. Read:
   - Request / form details
   - **Approval chain** (stages, current stage, who decided)
   - **History** of actions

**You should see:** enough context to decide, plus action buttons for your role on this stage.

## Step 3 — Act on an approval task

1. On the detail page (or quick buttons on the inbox card):

   *Approve/Reject controls appear only when you can act on the current task. The account used for these screenshots could view the pending task but could not act on it; an authorized approver capture is pending.*

2. Choose one:
   - **Approve** — comment optional; e-signature if the node requires it.
   - **Reject** — **comment required**.
   - **Request changes** — **comment required**; stays pending for edits.

3. If asked for an **e-signature**, type your name or upload an image, then confirm.

**You should see:** status update; the workflow continues or stops based on the graph (e.g. Condition nodes).

## Step 4 — Act on a submit task

1. Open the task.
2. Fill the inline form (conditional fields may show/hide).
3. Add an optional comment.
4. Click **Submit**.

**You should see:** the workflow advances to the next node.

## Step 5 — Act on a review task

1. Open the task.
2. Choose:
   - **Forward (no changes)** — continues; comment optional.
   - **Changes required** — comment **required**; usually returns to a submit step.

## Committee (multi-approval) tasks

1. Open a committee task.

   *A current screenshot requires an accessible committee task. No task was created or voted on for documentation.*

2. Cast **your** approve or reject (one vote per person).
3. Watch the progress bar (**N of M** approved).

**Rules to remember:**

- Stage **passes** when approvals reach N.
- Stage **fails** only when too many reject for N to still be possible (one reject alone may not fail it).

## Manage your own requests

From **My requests**:

1. Open a request still **pending** or **escalated**.
2. **Cancel request** — if the workflow allows it; open tasks close and assignees are notified.
3. For a **finished** request (completed / failed / cancelled), use **Delete request** to remove it and related records permanently.

## Status meanings

| Status | Meaning |
| --- | --- |
| **Pending** | Waiting on assignee |
| **Approved** / **Rejected** | Final decision for that stage |
| **Escalated** | SLA breached; routed higher |
| **Completed** | Submit/review step finished |
| **Cancelled** | Request cancelled |

