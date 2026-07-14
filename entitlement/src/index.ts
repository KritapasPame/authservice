import { createApp } from './http/app'
import { env } from './config/env'

createApp().listen(env.PORT)
console.log(`entitlement on :${env.PORT}`)
