import data from '../generated/status.json' with { type: 'json' }
import { createHandler } from './handler.mjs'

// No Static Assets binding: Access identity must reach this Worker directly.
export default createHandler(data)
