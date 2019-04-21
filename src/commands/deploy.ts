import os from 'os'
import ora from 'ora'
import chalk from 'chalk'
import path from 'path'
import bytes from 'bytes'
import fs from 'fs-extra'
import request from 'request'
import inquirer from 'inquirer'
import retry from 'async-retry'
import archiver from 'archiver'
import ProgressBar from 'progress'
import {Command, flags} from '@oclif/command'
import axios, {AxiosRequestConfig} from 'axios'

import '../interceptors'
import Poller from '../utils/poller'
import getPort from '../utils/get-port'
import onInterupt from '../utils/on-intrupt'
import getFiles, {IMapItem} from '../utils/get-files'
import {API_BASE_URL, GLOBAL_CONF_PATH, DEV_MODE} from '../constants'
import validatePort from '../utils/validate-port'
import {createDebugLogger} from '../utils/output'
import detectPlatform from '../utils/detect-platform'
import eraseLines from '../utils/erase-lines';

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
  image?: string,
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

interface IBuildLogsResponse {
  release: { state: string },
  buildOutput: IBuildOutput[],
}

interface IBuildOutput {
  _id: string,
  line: string,
  stream: string,
  releaseID: string,
  createdAt: string,
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
    image: flags.string({char: 'i', description: 'docker image to deploy'}),
    debug: flags.boolean({char: 'd', description: 'show debug logs'}),
    'api-token': flags.string({description: 'your api token to use for authentication'}),
  }

  axiosConfig: AxiosRequestConfig = {
    ...axios.defaults,
    baseURL: API_BASE_URL,
  }

  spinner!: ora.Ora

  async run() {
    const {flags} = this.parse(Deploy)
    const config: IDeploymentConfig = this.getMergedConfig(flags)
    const debug = createDebugLogger(flags.debug)
    this.debug = debug
    this.spinner = ora()

    this.debug()

    this.dontDeployEmptyProjects(config.path)

    this.setAxiosToken(config)

    this.validateDeploymentConfig(config)

    let isPlatformDetected = false
    if (!config.image) {
      if (!config.platform) {
        try {
          config.platform = await detectPlatform(config.path)
          isPlatformDetected = true
        } catch (error) {
          return this.error(error.message)
        }
      }

      this.validatePlatform(config.platform, config.path)
    } else {
      config.platform = 'docker'
    }

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

    try {
      const response = await this.deploy(config)

      if (!response || !response.data) {
        return this.error(`deploy: ${JSON.stringify(response)}`)
      }

      await this.showBuildLogs(response.data.releaseID)

      this.log()
      this.log(chalk.green('Deployment finished successfully.'))
      this.log(chalk.white('Open up the url below in your browser:'))
      this.log()
      DEV_MODE
        ? this.log(`    ${chalk.cyan(`http://${config.project}.liara.localhost`)}`)
        : this.log(`    ${chalk.cyan(`https://${config.project}.liara.run`)}`)
      this.log()

      // TODO: OnReady: Show project logs
      // oclif.run('liara logs --project my-app')

    } catch (error) {
      this.log()
      this.spinner.stop()
      error.response && debug(JSON.stringify(error.response.data))

      if (error.message === 'TIMEOUT') {
        this.error('Build timed out. It took about 10 minutes.')
      }

      this.error(`Deployment failed.
Sorry for inconvenience. Please contact us.`)
    }
  }

  async deploy(config: IDeploymentConfig) {
    const body: {[k: string]: any} = {
      port: config.port,
      type: config.platform,
      mountPoint: config.volume,
    }

    if (config.image) {
      body.image = config.image
      this.log('Creating a new release...')
      return this.createRelease(config.project as string, body)
    }

    this.spinner.start('Collecting project files...')
    const {files, directories, mapHashesToFiles} = await getFiles(config.path, this.debug)
    this.spinner.stop()

    body.files = files
    body.directories = directories

    const retryOptions = {
      onRetry: (error: any) => {
        this.debug(`Retrying due to: ${error.message}`)
        if (error.response) {
          this.debug(JSON.stringify(error.response.data))
        } else {
          this.debug(error.stack)
        }
      },
    }
    return retry(async bail => {
      try {
        return await this.createRelease(config.project as string, body)

      } catch (error) {
        const {response} = error

        if (!response) throw error // Retry deployment

        if (response.status === 400 && response.data.message === 'frozen_project') {
          this.error(`Project is frozen (not enough balance).
  Please open up https://console.liara.ir/projects and unfreeze the project.`)
        }

        if (response.status === 400 && response.data.message === 'missing_files') {
          const {missingFiles} = response.data.data

          this.spinner.start(`Files to upload: ${missingFiles.length}`)

          await this.uploadMissingFiles(
            mapHashesToFiles,
            missingFiles,
          )

          throw error // Retry deployment
        }

        return bail(error)
      }
    }, retryOptions)
  }

  createRelease(project: string, body: {[k: string]: any}) {
    return axios.post<{ releaseID: string }>(`/v2/projects/${project}/releases`, body, this.axiosConfig)
  }

  async showBuildLogs(releaseID: string) {
    this.spinner.start('Building...')

    let isCanceled = false

    onInterupt(async () => {
      // Force close
      if (isCanceled) process.exit(3)

      this.spinner.start('\nCanceling the build...')
      isCanceled = true

      const retryOptions = {
        retries: 3,
        onRetry: (error: any, attempt: number) => {
          this.debug(error.stack)
          this.log(`${attempt}: Could not cancel, retrying...`)
        }
      }
      await retry(async () => {
        await axios.post(`/v2/releases/${releaseID}/cancel`, null, this.axiosConfig)
      }, retryOptions)

      this.spinner.warn('Build canceled.')
      process.exit(3)
    })

    return new Promise((resolve, reject) => {
      const poller = new Poller()

      let since: string
      let isDeploying = false

      poller.onPoll(async () => {
        try {
          const {data: {release, buildOutput}} = await axios.get<IBuildLogsResponse>(
            `/v2/releases/${releaseID}/build-logs`, {
              ...this.axiosConfig,
              params: {since},
            })

          for (const output of buildOutput) {
            this.spinner.clear().frame()

            if (output.stream === 'STDOUT') {
              process.stdout.write(output.line)
            } else {
              // tslint:disable-next-line: no-console
              console.error(output.line)
              return reject(new Error('Build failed.'))
            }
          }

          if (!buildOutput.length) {
            if (release.state === 'CANCELED') {
              return reject(new Error('Build canceled.'))
            }

            if (release.state === 'TIMEDOUT') {
              return reject(new Error('TIMEOUT'))
            }

            if (release.state === 'FAILED') {
              return reject(new Error('Release failed.'))
            }

            if (release.state === 'DEPLOYING' && !isDeploying) {
              isDeploying = true
              this.spinner.succeed('Image pushed.')
              this.spinner.start('Creating a new release...')
            }

            if (release.state === 'READY') {
              this.spinner.succeed('Release created.')
              return resolve()
            }
          }

          if (buildOutput.length) {
            const lastLine = buildOutput[buildOutput.length - 1]
            since = lastLine.createdAt

            if (lastLine.line.startsWith('Successfully tagged')) {
              this.spinner.succeed('Build finished.')
              this.spinner.start('Pushing the image...')
            }
          }

        } catch (error) {
          this.debug(error.stack)
        }

        !isCanceled && poller.poll()
      })

      !isCanceled && poller.poll()
    })
  }

  dontDeployEmptyProjects(projectPath: string) {
    if (fs.readdirSync(projectPath).length === 0) {
      this.error('Project is empty!')
    }
  }

  logKeyValue(key: string, value: string): void {
    this.spinner.clear().frame()
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
    this.spinner.start('Loading...')

    try {
      const {data: {projects}} = await axios.get<IGetProjectsResponse>('/v1/projects', this.axiosConfig)

      this.spinner.stop()

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

    } catch (error) {
      this.spinner.stop()
      throw error
    }
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

    try {
      content = JSON.parse(fs.readFileSync(GLOBAL_CONF_PATH).toString('utf-8')) || {}
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

  async uploadMissingFiles(mapHashesToFiles: Map<string, IMapItem>, missingFiles: string[]) {
    const archive = archiver('tar', {
      gzip: true,
      gzipOptions: {level: 9},
    })

    archive.on('error', (error: Error) => { throw error })

    for (const hash of missingFiles) {
      const mapItem = mapHashesToFiles.get(hash)
      mapItem && archive.append(mapItem.data, {name: hash})
    }

    archive.finalize()

    const tmpArchivePath = path.join(os.tmpdir(), `${Date.now()}.tar.gz`)

    const archiveSize: number = await new Promise((resolve, reject) => {
      archive.pipe(fs.createWriteStream(tmpArchivePath))
        .on('error', reject)
        .on('close', function () {
          const {size} = fs.statSync(tmpArchivePath)
          resolve(size)
        })
    })

    this.logKeyValue('Compressed size', bytes(archiveSize))

    const tmpArchiveStream = fs.createReadStream(tmpArchivePath)
    const bar = new ProgressBar('Uploading [:bar] :rate/bps :percent :etas', {total: archiveSize})

    return new Promise(resolve => {
      const req = request.post({
        url: '/v1/files/archive',
        baseUrl: this.axiosConfig.baseURL,
        body: tmpArchiveStream,
        headers: {
          'Content-Type': 'application/octet-stream',
          Authorization: this.axiosConfig.headers.Authorization,
        },
      }) as any

      tmpArchiveStream.pipe(req)

      const interval = setInterval(() => {
        bar.tick(req.req.connection._bytesDispatched - bar.curr)

        if (bar.complete) {
          this.spinner.succeed('Upload finished.')
          this.spinner.start('Extracting...')
          clearInterval(interval)
        }
      }, 250)

      tmpArchiveStream.pipe(req)
        .on('response', async () => {
          this.spinner.succeed('Extract finished.')
          fs.unlink(tmpArchivePath)
            .then(() => {})
            .catch(() => {})
          resolve()
        })
    })
  }
}
