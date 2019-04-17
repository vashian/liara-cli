import cli from 'cli-ux'
import axios from 'axios'

axios.interceptors.response.use(response => response, error => {
  if (!error.response) {
    cli.error(`Could not connect to https://api.liara.ir .
Please check your network connection.`)
  }

  if (error.response.status === 401) {
    cli.error(`Authentication failed.
Please login via 'liara login' command.`)
  }

  return Promise.reject(error)
})
