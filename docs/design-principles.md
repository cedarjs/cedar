# Design Principles

This document collects design principles that apply across CedarJS, distilled
from real usage rather than stated up front. They exist so that new framework
features are measured against the same reasoning instead of re-deriving it
each time. Implementation plans under
[`docs/implementation-plans/`](implementation-plans/) should state which of
these principles they apply, and can be cross-referenced from here as
exemplars.

This is a living document — add a principle here when a plan or a real
incident distills one, not preemptively.

## Ambient context, but fail closed

Rails' `CurrentAttributes` and Cedar's `AsyncLocalStorage`-backed `context`
are the same mechanism: both let request-handling code read `currentUser` /
`currentOrg` without threading it through every function argument. Cedar
keeps that ergonomic — a service method like `db.booking.findMany()` reading
an ambient `currentOrg` is exactly the terseness that makes Rails pleasant to
write, and Cedar does not give it up.

The divergence from Rails is what happens when the ambient value is missing.
Rails fails _open_: `Booking.find(id)` and `org.bookings.find(id)` are both
valid calls that look nearly identical, and background jobs — which have no
`Current` — make unscoped queries that look completely normal. That is
exactly where real bugs live: sync jobs whose caches bleed across tenants,
"first active record" lookups that quietly ignore scope, because the
convention that holds in controllers has nothing enforcing it in a job.
Cedar's tenancy support (see
[the multi-tenancy plan](implementation-plans/2026-08-26-multi-tenancy.md))
fails _closed_ instead: a query on a tenant-owned model with no organization
in scope throws, rather than silently running unscoped.

Rails' `Time.use_zone` is the same shape in a second domain — ambient
timezone scoping per request, silently absent in jobs unless each job wraps
itself by hand. Wherever Cedar grows a new form of ambient context, the
missing-context behavior is a deliberate design decision, and the default is
to refuse, not to guess.

Four things make fail-closed ambient context work in practice, all present
in the tenancy design:

1. **Escape hatches get names.** `db.$forOrg(id)` and `db.$withoutTenant()`
   make every intentional exception to the default greppable. Auditing
   "where does this run unscoped?" becomes one grep instead of a review of
   every call site. Any fail-closed default should follow the same rule: the
   override is an explicit, searchable token, never a silent omission.
2. **Enforcement lives at a choke point, not at call sites.** The tenancy
   Prisma client extension scopes every query in one place. A convention
   applied at N call sites (the Rails model) degrades under exactly the
   conditions where the stakes are highest — background jobs, webhooks,
   scripts — because there is no single place left to check it.
3. **The framework owns what conventions cannot hold.** Rails core has
   consistently declined to own multi-tenancy, leaving per-call-site
   discipline as the only answer, and that discipline demonstrably fails in
   real apps. When a convention's failure mode is silent data leakage, it is
   framework territory, not app territory.
4. **A refusal is a fork, not a wall.** See below.

## The two-gate test for ambient/extension magic

Ambient behavior is not free: it makes code do something the reader cannot
see at the call site. That cost is worth paying only when both of the
following hold:

1. **Omission would fail silently and catastrophically.** Forgetting a
   tenant scope is a silent cross-tenant data leak — invisible until an
   incident. Forgetting an explicit `storeFile()` call produces a missing
   file, visible the first time anyone exercises the feature.
2. **The automated behavior is pure and transactional with respect to the
   query.** Injecting a `where` clause or a data field is the same query, in
   the same transaction, and can throw loudly the moment scope is missing.
   Performing external I/O — writing a file, calling a third-party API — as
   a side effect of a database call is a different failure mode entirely:
   non-transactional, capable of leaving orphaned state, invisible to
   someone reading the service code in a debugger.

CedarJS's tenancy support and uploads support land on opposite sides of this
test for one shared reason, not two unrelated ones:

- **Tenancy passes both gates.** A missing scope is a silent leak, and
  where-clause injection is pure query rewriting in the same transaction.
  The tenancy Prisma extension is the framework's answer.
- **Storage lifecycle fails both gates.** A forgotten `storeFile()` call is
  a visible bug, not a silent one, and file I/O triggered from a Prisma
  hook is non-transactional external work with its own failure modes
  (orphaned files, dangling references). The
  [uploads & storage plan](implementation-plans/uploads-storage-implementation-plan.md)
  requires developers to call storage operations explicitly in their
  services rather than hooking them into the ORM layer.

The test also resolves cases neither plan covers on its own. Audit logging
is a side effect of a write, and omitting it is silent and consequential —
but only a same-transaction audit row passes gate 2; shipping an audit event
to an external service does not, and must stay an explicit call. Rails
illustrates the same split from the other side: ambient scoping merely fails
open, but ActiveStorage's attachment lifecycle living in model callbacks is
the framework's most-cited source of orphaned blobs and side effects firing
from unexpected save paths — callback magic applied to work that fails the
second gate.

## A refusal is a fork, not a wall

A fail-closed design multiplies refusals by construction — that is the
point of failing closed — which makes the refusal message the feature's
highest-traffic UI during every adoption or migration. Every refusal should
name its sanctioned alternatives and the criterion for choosing between
them, not just state that the default was refused.

The tenancy extension's `TenantScopeError` is the model to follow:

> "Customer" is tenant-owned, and this code is running outside a request, so
> there is no organization in scope. Use `db.$forOrg(organizationId)` when
> the organization is known (a job or a webhook), or `db.$withoutTenant()`
> when the code works across organizations on purpose (a seed, a data
> migration, an admin task).

During an adoption of tenancy against a real app, this error fired
repeatedly in one day — scenario seeds, jobs, scripts, public services, each
category in turn as the extension went in — and every occurrence was
self-contained: read the message, pick the door it names, move on. A bare
"not allowed" would have produced one support question per occurrence
instead. Wording a refusal well pays for itself once for every place the
refusal fires, and a fail-closed design guarantees there will be many.

## Applying these principles

Implementation plans should call out which of these principles shape their
design, the way the multi-tenancy and uploads plans do above. When a plan's
review surfaces a new principle or sharpens an existing one, add it here
rather than leaving it implicit in a single plan.
