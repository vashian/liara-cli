import os from 'os'
import path from 'path'

const dev = process.env.CLI_DEV_MODE === 'true'

// tslint:disable-next-line:no-http-string
export const API_BASE_URL = dev ? 'http://localhost:3000' : 'https://api.liara.ir'

export const GLOBAL_CONF_PATH = path.join(os.homedir(), '.liara.json')
