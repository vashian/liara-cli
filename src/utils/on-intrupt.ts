export default function onInterupt(listener: () => any) {
  if (process.platform === 'win32') {
    const rl = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    })

    rl.on('SIGINT', listener)
  }

  process.on('SIGINT', listener)
}
