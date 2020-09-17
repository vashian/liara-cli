import os from 'os'
import path from 'path'

export const DEV_MODE = process.argv.includes('--dev')

// tslint:disable-next-line:no-http-string
export const DEFAULT_REGION = DEV_MODE ? 'http://localhost:3000' : 'https://api.liara.ir'

export const GLOBAL_CONF_PATH = path.join(os.homedir(), '.liara.json')

export const REGIONS_API_URL = {
  Iran: "http://localhost:3000",
  Germany: "https://api.liara.ir",
};
