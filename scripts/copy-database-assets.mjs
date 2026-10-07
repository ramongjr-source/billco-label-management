import { cpSync } from 'node:fs'

cpSync('database/migrations', 'dist-server/database/migrations', { recursive: true })
