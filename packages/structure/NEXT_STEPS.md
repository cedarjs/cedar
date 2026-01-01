✦ If I had to recommend one change with the biggest impact on the Structure package, it would be replacing `ts-morph` with a high-performance AST parser like
[`oxc-parser`](https://github.com/oxc-project/oxc) or [`swc`](https://swc.rs/).

Why this would have the biggest impact:

1.  Performance & Memory: ts-morph is extremely heavy because it wraps the entire TypeScript compiler API. For a CLI tool that runs diagnostics, the
    overhead of initializing a full TypeScript "Project" context is the primary bottleneck. Rust-based parsers like oxc are orders of magnitude faster and
    use significantly less memory.
2.  Structural vs. Semantic Analysis: Most of the diagnostics in this package (checking if a file exports QUERY, verifying Router tags, or matching names)
    are structural. You don't need the heavy-duty type-checking capabilities of the full TypeScript compiler to perform these checks—you just need a fast
    way to traverse the AST.
3.  Modernization: The JavaScript ecosystem is rapidly moving toward native-speed tooling (like Biome, Rolldown, and Oxc). Transitioning the core engine of
    Cedar's project analysis to these tools would make the cedar check and cedar dev commands feel near-instant, even on very large projects.
4.  Incremental Readiness: The current structure logic effectively requires recreating the entire project graph when a file changes because ts-morph is
    difficult to use in a surgical, incremental way without massive memory bloat. A lighter AST approach would make it much easier to implement a truly
    reactive, incremental diagnostic system.

While the inheritance-based OOP model (BaseNode / FileNode) is also a bit dated, it's the underlying engine (`ts-morph`) that is currently holding back the
package's potential for speed.

> What would you suggest instead of the inheritance-based OOP model?

✦ Instead of the deep inheritance hierarchy (BaseNode -> FileNode -> RWProject), I would recommend a functional, data-driven architecture centered around
Pure Data Structures and Specialized Analyzers.

The Suggesed Model: "Analyzers & Projections"

In this model, you separate the state of the project from the logic used to inspect it:

1.  Plain Data Interfaces: Instead of class instances with methods, a Route or a Page becomes a simple, serializable interface (e.g., type Route = { path:
    string, name: string, isPrivate: boolean }).
2.  Stateless Extractors: You write small, focused functions that take a source file AST and return that plain data. For example: extractRoutes(ast):
    Route[]. These are incredibly easy to unit test because they don't require a "Project" or "Host" to run—just a string of code.
3.  Query Engine: Instead of nodes knowing who their "parent" is, you use a centralized query engine (similar to how react-query or even a simple
    Redux-like store works). If you need the routes for a project, you call project.getRoutes(). The engine handles the caching and orchestrates the
    extractors.

Why this is better than inheritance:

- Testability: You can test the "Route discovery" logic in isolation without spinning up a whole project graph or mocking a complex BaseNode.
- Concurrency: Pure functions are "thread-safe." You could easily run multiple extractors in parallel across different files using worker threads, which
  is much harder to do when everything is a stateful class instance.
- Separation of Concerns: The logic for "how to find a cell" stays in one file, and the logic for "how to cache results" stays in another. Right now,
  every class has to manage its own caching via @memo and @lazy, which litters the domain logic.
- Serializability: Because the project graph is just plain data, you could easily send it to a UI (like a Cedar dashboard) or a background process without
  worrying about losing class methods or prototype chains.

This approach is essentially how most modern compilers and high-performance tools (like ESLint or rust-analyzer) are built today. It trades "magical
getters" for a transparent, predictable data flow.

✦ To take full advantage of a move to a high-performance parser like oxc, you should eventually update the interface, though you could keep the current one
as a temporary compatibility layer.

Here is the breakdown of why keeping the current interface would actually limit the benefits of the rewrite:

1. The "Compatibility Layer" Tax
   The current interface is built on ts-morph, which provides a very high-level, human-friendly API (e.g., sourceFile.getVariableDeclaration('QUERY')).

- The Problem: oxc (and most high-performance parsers) returns a raw, flat AST.
- The Consequence: If you keep the current interface, you have to write a massive "compatibility layer" that mimics ts-morph's API using the raw AST. This
  layer would likely be written in JavaScript, adding back some of the overhead you were trying to remove.

2. From "Pull" to "Push" (Performance)

- Current (Pull): The inheritance/lazy-getter model is a "Pull" system. You ask for project.cells, and it triggers a chain of getters that eventually call
  ts-morph.
- Optimal (Push): High-performance tools work better as "Push" systems. You run a fast Rust-based scanner over the whole project in one pass, which
  "pushes" a plain data object representing the whole structure.
- If you keep the current interface, you are forcing a high-speed stream of data into a slow, stateful object container.

3. Serializability and Concurrency
   One of the biggest hidden benefits of oxc is that because it’s so fast and the data it produces is simple, you can easily move the work to Worker Threads.

- The Limitation: You cannot send class instances (like RWProject) across worker boundaries easily.
- The Win: If you update the interface to use Plain Old JavaScript Objects (POJOs), the Structure package could parse 50 files in parallel on 50 threads
  and return a single JSON-like object. Other packages would then "query" this data rather than interacting with live class instances.

4. What a "Modern" Interface would look like
   Instead of other packages doing this:

1 const project = getProject(path)
2 const routes = project.router.routes // Deep getter chain

They would do this:
1 // The structure package returns a frozen snapshot of the project
2 const projectData = await scanProject(path)
3 const routes = findRoutes(projectData) // Fast lookup in a data structure

Recommendation
If you want to move to oxc, I would recommend a Two-Phase Approach:

1.  Phase 1 (Internal): Rewrite the internals to use oxc but keep the RWProject classes as "wrappers" so you don't break the CLI or Telemetry immediately.
2.  Phase 2 (Public API): Introduce a new functional API (scanProject) and slowly migrate the CLI to use it. Once the CLI is migrated, you can delete the
    inheritance-based classes entirely.
