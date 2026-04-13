import { useLiveQuery } from '@cedarjs/gqlorm/react/useLiveQuery'

const LiveTodos = () => {
  const { data, loading, error } = useLiveQuery((db) => db.todo.findMany())

  if (loading) {
    return <div>Loading...</div>
  }

  if (error) {
    return <div style={{ color: 'red' }}>Error: {error.message}</div>
  }

  if (!data || data.length === 0) {
    return <div>No todos yet</div>
  }

  return (
    <div className="divide-y divide-gray-200">
      {data.map((todo) => (
        <article key={todo.id} className="py-4" data-testid="todo-item">
          <header>
            <h2 className="text-xl font-semibold">{todo.title}</h2>
          </header>
          {todo.body && (
            <div className="mt-2 font-light text-gray-900" data-testid="todo-body">
              {todo.body}
            </div>
          )}
          <div className="mt-1 flex items-center gap-2">
            <span
              data-testid="todo-done"
              className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                todo.done
                  ? 'bg-green-100 text-green-800'
                  : 'bg-yellow-100 text-yellow-800'
              }`}
            >
              {todo.done ? 'Done' : 'Pending'}
            </span>
            <time
              data-testid="todo-created-at"
              className="text-sm text-gray-500"
            >
              {todo.createdAt}
            </time>
          </div>
        </article>
      ))}
    </div>
  )
}

export default LiveTodos
