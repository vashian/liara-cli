import {Command, flags} from '@oclif/command'

export default class Deploy extends Command {
  static description = 'deploys a project'

  static flags = {
    help: flags.help({char: 'h'}),
    project: flags.string({char: 'p', description: 'project name'}),
    port: flags.string({description: 'the port that your app listens to'}),
    path: flags.boolean({description: 'project path in your computer'}),
    api_token: flags.string({description: 'your api token to use for authentication'}),
  }

  async run() {
    const {flags} = this.parse(Deploy)
  }
}
