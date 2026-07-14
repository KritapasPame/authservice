import { seedSystemRoles } from '../modules/role/seed'

await seedSystemRoles()
console.log('seeded system roles')
process.exit(0)
