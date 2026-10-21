import Cell from './index.js'

;<Cell id={1} />
// @ts-expect-error Required query variables are input props.
;<Cell />
// @ts-expect-error Query variables retain their declared types.
;<Cell id="wrong" />
// @ts-expect-error Query results are supplied by the cell, not its caller.
;<Cell id={1} user={{ id: 1, name: 'Ada' }} />
