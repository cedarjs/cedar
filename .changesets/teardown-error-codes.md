- fix(testing): Recognise the SQLite driver's foreign-key error codes in
  scenario teardown

Scenario teardown empties every table after a test file runs. When a foreign key
stops a table from being emptied yet, teardown moves that table later in the
order and retries, which is how it settles on an order the schema allows.

Recognising those violations now covers the symbolic codes the SQLite driver
adapter reports (`SQLITE_CONSTRAINT_FOREIGNKEY` and `SQLITE_CONSTRAINT_TRIGGER`)
alongside the numeric ones MySQL, PostgreSQL and older SQLite drivers use. A
SQLite project whose models need a teardown order different from their schema
order would otherwise fail with a raw `FOREIGN KEY constraint failed` error from
the first test file that seeded a scenario.

The check lives in its own module now, so it has unit tests.
