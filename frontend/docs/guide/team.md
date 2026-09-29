# My team

**Who:** Admin, CEO, VP, Manager, HR — anyone who answers for other people. Employees
and Viewers do not see this page.

**My Team** answers one question: *who on my side is blocked?* It is not the
Users page — there is nothing to edit here. Creating accounts, changing roles and
setting reporting lines all belong to the Admin on
[Users](/admin/org-admin).

## Open your team

1. Open **My Team** from the sidebar when available, or open `/team` with an authorized account.

   ![My team in an Administrator session; member identities masked](/screenshots/guide/team.png)

2. Each row is one person, with three live numbers:

   | Column | Meaning |
   | --- | --- |
   | **Pending approvals** | Requests currently sitting with them for a decision |
   | **Overdue** | How many of those have passed their due date |
   | **Open requests** | Requests they submitted that are still moving |

3. Use the **All workload** and **All availability** filters, or search by name, role, or department.
4. Click **Open approvals** (top right), then choose **Team approvals** in the inbox.

**You should see:** the people who report to you — nobody from another team.

## Who counts as "your team"

Reach follows the org chart, not the job title:

| Your role | Who you see |
| --- | --- |
| Manager, HR, VP | Everyone below you on the reporting chain — including your managers' reports — plus anyone who names you as their HR partner |
| CEO, Admin | Everyone in the workspace |

So a VP sees their managers *and* those managers' teams; a Manager sees only
their own branch. If the page is empty, nobody has been pointed at you yet — an
admin sets **Reports to** and **HR partner** when creating or editing a user.

## Out of office

A person covering for someone else shows an **Out of office** chip. Their work
still routes to their delegate, so the count next to their name is what they will
come back to.

## Where this reach also applies

The same boundary governs the rest of your shell, so the numbers agree wherever
you look:

- **Approvals → My team** lists what your people raised or are sitting on.
- Opening or acting on someone else's request works for your team and is refused
  (403) outside it.
- **Analytics** reports on your team by default and says so under the title. The
  department filter narrows further; it can never widen past your reach.

## Related

- [Dashboard](/guide/dashboard)
- [Tasks & approvals](/guide/tasks-approvals)
- [Analytics](/guide/analytics)
- [Roles & permissions](/reference/roles-permissions)
