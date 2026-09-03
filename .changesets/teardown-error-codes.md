- fix(testing): Detect foreign-key violations in scenario teardown from the driver error

Scenario teardown empties every table after a test file runs. When a
constraint stops a table from being emptied yet, teardown moves that table
later in the order and retries, which is how it settles on an order the
schema allows.

Recognising those violations read the database's own error code out of the
message text and compared it against a list of numbers. Prisma 7 talks to
every database through a driver adapter, and adapters report the code
symbolically, so SQLite's `SQLITE_CONSTRAINT_TRIGGER` never matched the
`1811` the list held for it, and teardown failed with a raw
`FOREIGN KEY constraint failed` error instead of reordering.

Adapters also report a `kind` from a vocabulary they all share, which says
what the error was without any parsing, so teardown now recognises the two
kinds it can recover from: `ForeignKeyConstraintViolation` and
`RestrictViolation`. That covers every database Prisma supports rather than
the codes anyone happened to add.

Deferring is also bounded now. A table that no ordering can empty was
appended to the order being walked and retried forever, hanging the test run
with no error to show for it. One full pass that empties nothing now raises
the driver's error instead.

Both the error check and the ordering live in their own module, so they have
unit tests.
