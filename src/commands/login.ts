import chalk from 'chalk'
import axios from 'axios'
import fs from 'fs-extra'
import retry from 'async-retry'
import {prompt} from 'inquirer'
import promptEmail from 'email-prompt'
import {Command, flags} from '@oclif/command'
import {validate as validateEmail} from 'email-validator'

import eraseLines from '../utils/erase-lines'
import {createDebugLogger} from '../utils/output'
import {API_BASE_URL, GLOBAL_CONF_PATH} from '../constants'

export default class Login extends Command {
  static description = 'logins to your account'

  static flags = {
    help: flags.help({char: 'h'}),
    email: flags.string({char: 'e', description: 'your email'}),
    password: flags.string({char: 'p', description: 'your password'}),
    debug: flags.boolean({char: 'd', description: 'show debug logs'}),
  }

  async run() {
    const {flags} = this.parse(Login)
    const debug = createDebugLogger(flags.debug)

    const body = {email: flags.email, password: flags.password}

    if (!flags.email) {
      let emailIsValid = false

      do {
        body.email = await this.promptEmail()

        emailIsValid = validateEmail(body.email)
        if (!emailIsValid) {
          // let's erase the `> Enter email [...]`
          // we can't use `console.log()` because it appends a `\n`
          // we need this check because `email-prompt` doesn't print
          // anything if there's no TTY
          process.stdout.write(eraseLines(1))
        }
      } while (!emailIsValid)
    }

    if (!flags.password) {
      this.log()
      body.password = await this.promptPassword()
    }

    try {
      const {api_token} = await retry(async bail => {
        try {
          const {data} = await axios.post('/v1/login', body, {
            baseURL: API_BASE_URL,
          })
          return data
        } catch (err) {
          if ((err.response && err.response.status === 401) || err.oclif.exit === 2) {
            return bail(err)
          }
          debug('retrying...')
          throw err
        }
      }, {})

      fs.writeFileSync(GLOBAL_CONF_PATH, JSON.stringify({
        api_token,
      }))

      this.log(`> Auth credentials saved in ${chalk.bold(GLOBAL_CONF_PATH)}`)
      this.log(chalk.green('You have logged in successfully.'))

    } catch (err) {
      if (err.response && err.response.status === 401) {
        this.error('Authentication failed. Please try again.')
      }
      throw err
    }
  }

  async promptEmail(): Promise<string> {
    try {
      return await promptEmail({start: `${chalk.green('?')} ${chalk.bold('Enter your email:')} `})
    } catch (err) {
      this.log() // \n

      if (err.message === 'User abort') {
        process.stdout.write(eraseLines(2))
        // tslint:disable-next-line: no-console
        console.log(`${chalk.red('> Aborted!')} No changes made.`)
        process.exit(0)
      }

      if (err.message === 'stdin lacks setRawMode support') {
        this.error(
          `Interactive mode not supported – please run ${chalk.green(
            'liara login --email you@domain.com --password your_password'
          )}`
        )
      }

      throw err
    }
  }

  async promptPassword(): Promise<string> {
    const {password} = await prompt({
      name: 'password',
      type: 'password',
      message: 'Enter your password:',
      validate(input) {
        if (input.length === 0) {
          return false
        }
        return true
      }
    })

    return password
  }
}
