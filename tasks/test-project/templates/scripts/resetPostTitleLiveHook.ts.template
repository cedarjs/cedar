import { Pool } from 'pg'

export default async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const result = await pool.query(
    "UPDATE \"Post\" SET title = 'Welcome to the blog!' " +
    'WHERE id = 1 RETURNING title',
  )
  console.log('Reset post:', result.rows[0].title)
  await pool.end()
}
