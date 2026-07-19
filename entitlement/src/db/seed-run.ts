import { seedBase } from './seed'
import { seedSystemRoles } from '../modules/role/seed'

await seedBase()
await seedSystemRoles()
console.log('seeded')
process.exit(0)
