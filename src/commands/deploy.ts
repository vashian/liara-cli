import {Command, flags} from '@oclif/command'
import * as fs from 'fs-extra'
import * as os from 'os'
import * as path from 'path'
import * as inquirer from 'inquirer'
import chalk from 'chalk'
import axios, {AxiosRequestConfig} from 'axios'

import detectPlatform from '../utils/detect-platform'
import {API_BASE_URL} from '../constants'
import getPort from '../utils/get-port'
import validatePort from '../utils/validate-port'

interface ILiaraJSON {
  project?: string,
  platform?: string,
  port?: number,
  volume?: string,
}

interface IGlobalLiaraConfig {
  'api-token'?: string,
}

interface IFlags {
  help?: boolean | void,
  path?: string,
  platform?: string,
  project?: string,
  port?: number,
  volume?: string,
  'api-token'?: string,
}

interface IDeploymentConfig extends IFlags {
  path: string,
}

interface IProject {
  project_id: string,
}

interface IGetProjectsResponse {
  projects: IProject[]
}

export default class Deploy extends Command {
  static description = 'deploys a project'

  static flags = {
    help: flags.help({char: 'h'}),
    path: flags.string({description: 'project path in your computer'}),
    platform: flags.string({description: 'the platform your project needs to run'}),
    project: flags.string({char: 'p', description: 'project name'}),
    port: flags.integer({description: 'the port that your app listens to'}),
    volume: flags.string({char: 'v', description: 'volume absolute path'}),
    debug: flags.boolean({description: 'show debug logs'}),
    'api-token': flags.string({description: 'your api token to use for authentication'}),
  }

  axiosConfig: AxiosRequestConfig = {
    ...axios.defaults,
    baseURL: API_BASE_URL,
  }

  async run() {
    const {flags} = this.parse(Deploy)
    const config: IDeploymentConfig = this.getMergedConfig(flags)

    this.dontDeployEmptyProjects(config.path)

    this.setAxiosToken(config)

    this.validateDeploymentConfig(config)

    let isPlatformDetected = false
    if (!config.platform) {
      config.platform = await detectPlatform(config.path)
      isPlatformDetected = true
    }

    // this.validatePlatform(config.platform, config.path)

    if (!config.project) {
      config.project = await this.promptProject()
    }

    if (!config.port) {
      config.port = getPort(config.platform) || await this.promptPort()
    }

    this.logKeyValue('Project', config.project)
    this.logKeyValue('Path', config.path)
    isPlatformDetected
      ? this.logKeyValue('Detected platform', config.platform)
      : this.logKeyValue('Platform', config.platform)
    this.logKeyValue('Port', String(config.port))

    // getFiles(config.path)
  }

  dontDeployEmptyProjects(projectPath: string) {
    if (fs.readdirSync(projectPath).length === 0) {
      this.error('Project is empty!')
    }
  }

  logKeyValue(key: string, value: string): void {
    this.log(`${chalk.gray(`${key}:`)} ${value}`)
  }

  setAxiosToken(config: IDeploymentConfig): void {
    if (!config['api-token']) {
      return
    }

    this.axiosConfig.headers.Authorization = `Bearer ${config['api-token']}`
  }

  validateDeploymentConfig(config: IDeploymentConfig) {
    if (config.volume && !path.isAbsolute(config.volume)) {
      this.error('Volume path must be absolute.')
    }
  }

  async promptProject(): Promise<string> {
    const {data: {projects}} = await axios.get<IGetProjectsResponse>('/v1/projects', this.axiosConfig)

    if (!projects.length) {
      this.warn('Please go to https://console.liara.ir/projects and create a project, first.')
      this.exit(1)
    }

    const {project} = await inquirer.prompt({
      name: 'project',
      type: 'list',
      message: 'Please select a project:',
      choices: [
        ...projects.map(project => project.project_id),
      ]
    })

    return project
  }

  async promptPort(): Promise<number> {
    const {port} = await inquirer.prompt({
      name: 'port',
      type: 'input',
      default: 3000,
      message: 'Enter the port your app listens to:',
      validate: validatePort,
    })

    return port
  }

  getMergedConfig(flags: IFlags): IDeploymentConfig {
    const defaults = {
      path: flags.path ? flags.path : process.cwd(),
      ...this.readGlobalConfig()
    }
    const projectConfig = this.readProjectConfig(defaults.path)
    return {
      ...defaults,
      ...projectConfig,
      ...flags,
    }
  }

  readGlobalConfig(): IGlobalLiaraConfig {
    let content
    const globalConfPath = path.join(os.homedir(), '.liara.json')

    try {
      content = JSON.parse(fs.readFileSync(globalConfPath).toString('utf-8')) || {}
    } catch {
      content = {}
    }

    // For backward compatibility with < 1.0.0 versions
    if (content.api_token) {
      content['api-token'] = content.api_token
      delete content.api_token
    }

    return content
  }

  readProjectConfig(projectPath: string): ILiaraJSON {
    let content
    const liaraJSONPath = path.join(projectPath, 'liara.json')
    const hasLiaraJSONFile = fs.existsSync(liaraJSONPath)
    if (hasLiaraJSONFile) {
      try {
        content = fs.readJSONSync(liaraJSONPath) || {}

      } catch {
        this.error('Syntax error in `liara.json`!')
      }
    }

    return content || {}
  }

  validatePlatform(platform: string, projectPath: string): void {
    if (platform === 'node') {
      const packageJSON = fs.readJSONSync(path.join(projectPath, 'package.json'))

      if (!packageJSON.scripts || !packageJSON.scripts.start) {
        this.error(`A NodeJS project must be runnable with 'npm start'.
You must add a 'start' command to your package.json scripts.`)
      }
    }
  }
}
